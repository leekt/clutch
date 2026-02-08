import { spawn, type ChildProcess } from 'child_process';

import pino from 'pino';

import type { AgentContext, ProgressUpdate } from '../executor/base-agent.js';
import type { TaskDispatch, TaskResult } from '../types.js';
import type { AgentRuntime, SubprocessRuntimeConfig, ToolCallEvent } from './types.js';

const logger = pino({ name: 'subprocess-runtime' });

/**
 * SubprocessRuntime spawns a child process for each task.
 *
 * Two protocols:
 *   - stdio: write JSON to stdin, read JSON from stdout
 *   - http:  spawn process with PORT env, wait for health, POST like HttpRuntime, kill after
 */
export class SubprocessRuntime implements AgentRuntime {
  readonly type = 'subprocess';
  private progressCallbacks: Array<(update: ProgressUpdate) => void> = [];
  private toolCallCallbacks: Array<(call: ToolCallEvent) => void> = [];
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd?: string;
  private readonly env: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly protocol: 'stdio' | 'http';

  constructor(
    private readonly agentName: string,
    config: SubprocessRuntimeConfig,
  ) {
    this.command = config.command;
    this.args = config.args ?? [];
    this.cwd = config.cwd;
    this.env = config.env ?? {};
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.protocol = config.protocol ?? 'stdio';
  }

  async initialize(): Promise<void> {
    logger.info({ agentName: this.agentName, protocol: this.protocol }, 'Subprocess runtime initialized');
  }

  async execute(dispatch: TaskDispatch, context: Partial<AgentContext>): Promise<TaskResult> {
    if (this.protocol === 'http') {
      return this.executeHttp(dispatch, context);
    }
    return this.executeStdio(dispatch, context);
  }

  private async executeStdio(dispatch: TaskDispatch, context: Partial<AgentContext>): Promise<TaskResult> {
    return new Promise((resolve) => {
      const child = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, this.timeoutMs);

      child.stdout!.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr!.on('data', (data: Buffer) => {
        stderr += data.toString();
        logger.debug({ agentName: this.agentName, stderr: data.toString().trim() }, 'Subprocess stderr');
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (timedOut) {
          resolve({
            taskId: dispatch.taskId,
            success: false,
            error: { code: 'TIMEOUT', message: `Subprocess timed out after ${this.timeoutMs}ms`, retryable: true },
            usage: { cost: 0, runtime: this.timeoutMs, tokens: 0 },
          });
          return;
        }

        if (code !== 0) {
          if (stdout.trim()) {
            try {
              const result = JSON.parse(stdout) as TaskResult;
              resolve(result);
              return;
            } catch {
              // fall through to error
            }
          }
          resolve({
            taskId: dispatch.taskId,
            success: false,
            error: { code: 'SUBPROCESS_ERROR', message: `Process exited with code ${code}: ${stderr.slice(0, 500)}`, retryable: true },
            usage: { cost: 0, runtime: 0, tokens: 0 },
          });
          return;
        }

        try {
          const result = JSON.parse(stdout) as TaskResult;
          resolve(result);
        } catch {
          resolve({
            taskId: dispatch.taskId,
            success: false,
            error: { code: 'PARSE_ERROR', message: `Failed to parse subprocess output: ${stdout.slice(0, 200)}`, retryable: false },
            usage: { cost: 0, runtime: 0, tokens: 0 },
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          taskId: dispatch.taskId,
          success: false,
          error: { code: 'SPAWN_ERROR', message: err.message, retryable: false },
          usage: { cost: 0, runtime: 0, tokens: 0 },
        });
      });

      // Write the dispatch + context as JSON to stdin and close it
      const payload = JSON.stringify({ dispatch, context });
      child.stdin!.write(payload);
      child.stdin!.end();
    });
  }

  private async executeHttp(dispatch: TaskDispatch, context: Partial<AgentContext>): Promise<TaskResult> {
    // Pick a random port
    const port = 10000 + Math.floor(Math.random() * 50000);
    const baseUrl = `http://127.0.0.1:${port}`;

    let child: ChildProcess | undefined;

    try {
      child = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stderr!.on('data', (data: Buffer) => {
        logger.debug({ agentName: this.agentName, stderr: data.toString().trim() }, 'Subprocess stderr');
      });

      // Wait for the subprocess to become healthy
      await this.waitForHealth(baseUrl, 30_000);

      // POST the task
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${baseUrl}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dispatch, context }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => 'unknown');
          return {
            taskId: dispatch.taskId,
            success: false,
            error: { code: 'HTTP_ERROR', message: `Subprocess agent returned ${response.status}: ${body}`, retryable: response.status >= 500 },
            usage: { cost: 0, runtime: 0, tokens: 0 },
          };
        }

        return (await response.json()) as TaskResult;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return {
        taskId: dispatch.taskId,
        success: false,
        error: { code: 'SUBPROCESS_HTTP_ERROR', message: (error as Error).message, retryable: true },
        usage: { cost: 0, runtime: 0, tokens: 0 },
      };
    } finally {
      if (child) {
        child.kill('SIGTERM');
        setTimeout(() => child?.kill('SIGKILL'), 5000);
      }
    }
  }

  private async waitForHealth(baseUrl: string, maxWaitMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const res = await fetch(`${baseUrl}/health`);
        if (res.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Subprocess did not become healthy within ${maxWaitMs}ms`);
  }

  async getHealth(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    // Subprocess agents are ephemeral — health is always "ready to spawn"
    return { healthy: true, details: { command: this.command, protocol: this.protocol } };
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
}
