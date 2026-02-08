import pino from 'pino';

import type { AgentContext, ProgressUpdate } from '../executor/base-agent.js';
import type { TaskDispatch, TaskResult } from '../types.js';
import type { AgentRuntime, HttpRuntimeConfig, ToolCallEvent } from './types.js';

const logger = pino({ name: 'http-runtime' });

/**
 * HttpRuntime delegates execution to a remote agent over HTTP.
 *
 * - POST {url}/execute  – send task dispatch + context, receive TaskResult
 * - GET  {url}/health   – health check
 */
export class HttpRuntime implements AgentRuntime {
  readonly type = 'http';
  private progressCallbacks: Array<(update: ProgressUpdate) => void> = [];
  private toolCallCallbacks: Array<(call: ToolCallEvent) => void> = [];
  private readonly url: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;
  private readonly healthPath: string;

  constructor(
    private readonly agentName: string,
    config: HttpRuntimeConfig,
  ) {
    // Strip trailing slash
    this.url = config.url.replace(/\/$/, '');
    this.authToken = config.authToken;
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.healthPath = config.healthPath ?? '/health';
  }

  async initialize(): Promise<void> {
    // Verify the remote agent is reachable
    try {
      const health = await this.getHealth();
      logger.info({ agentName: this.agentName, healthy: health.healthy }, 'HTTP runtime initialized');
    } catch (error) {
      logger.warn({ agentName: this.agentName, error }, 'HTTP runtime health check failed during init (agent may not be running yet)');
    }
  }

  async execute(dispatch: TaskDispatch, context: Partial<AgentContext>): Promise<TaskResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.url}/execute`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ dispatch, context }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => 'unknown');
        return {
          taskId: dispatch.taskId,
          success: false,
          error: {
            code: 'HTTP_ERROR',
            message: `Remote agent returned ${response.status}: ${body}`,
            retryable: response.status >= 500,
          },
          usage: { cost: 0, runtime: 0, tokens: 0 },
        };
      }

      const result = (await response.json()) as TaskResult;
      return result;
    } catch (error) {
      const isTimeout = (error as Error).name === 'AbortError';
      return {
        taskId: dispatch.taskId,
        success: false,
        error: {
          code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { cost: 0, runtime: 0, tokens: 0 },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async getHealth(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    try {
      const response = await fetch(`${this.url}${this.healthPath}`, {
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        return { healthy: false, details: { status: response.status } };
      }

      const body = await response.json().catch(() => ({}));
      return { healthy: true, details: body as Record<string, unknown> };
    } catch {
      return { healthy: false, details: { error: 'unreachable' } };
    }
  }

  async shutdown(): Promise<void> {
    this.progressCallbacks = [];
    this.toolCallCallbacks = [];
  }

  onProgress(cb: (update: ProgressUpdate) => void): void {
    this.progressCallbacks.push(cb);
  }

  onToolCall(cb: (call: ToolCallEvent) => void): void {
    this.toolCallCallbacks.push(cb);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }
}
