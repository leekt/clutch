import type { ClutchMessage, MessageType } from '@clutch/protocol';
import {
  createMessage,
  generateThreadId,
  generateRunId,
  generateTaskId,
  safeValidateMessage,
} from '@clutch/protocol';
import { BaseAdapter } from '../base.js';

/**
 * HTTP Webhook Request
 */
export interface HTTPWebhookRequest {
  method: 'POST';
  headers: Record<string, string>;
  body: unknown;
  path?: string;
}

/**
 * HTTP Webhook Response
 */
export interface HTTPWebhookResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * HTTP Webhook Configuration
 */
export interface HTTPWebhookConfig {
  id: string;
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  auth?: {
    type: 'bearer' | 'api_key' | 'basic';
    token?: string;
    username?: string;
    password?: string;
    header?: string;
  };
}

/**
 * HTTP Webhook Adapter
 *
 * Generic HTTP adapter for webhook-based integrations.
 */
export class HTTPAdapter extends BaseAdapter {
  name = 'http';

  private webhooks: Map<string, HTTPWebhookConfig> = new Map();

  constructor(webhooks: HTTPWebhookConfig[] = []) {
    super();
    for (const webhook of webhooks) {
      this.webhooks.set(webhook.id, webhook);
    }
  }

  /**
   * Register a webhook endpoint
   */
  registerWebhook(config: HTTPWebhookConfig): void {
    this.webhooks.set(config.id, config);
  }

  /**
   * Unregister a webhook
   */
  unregisterWebhook(id: string): void {
    this.webhooks.delete(id);
  }

  canHandle(msg: ClutchMessage): boolean {
    // Check if message should be delivered via HTTP
    const meta = msg.meta as { delivery?: string; webhook_id?: string } | undefined;
    if (meta?.delivery === 'http' || meta?.webhook_id) {
      return true;
    }

    // Check if any recipient has an HTTP endpoint
    for (const recipient of msg.to) {
      if (this.webhooks.has(recipient.agent_id)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Transform inbound HTTP request to ClutchMessage
   */
  async inbound(raw: unknown): Promise<ClutchMessage[]> {
    const request = raw as HTTPWebhookRequest;
    const body = request.body;

    // Check if body is already a valid ClutchMessage
    const validation = safeValidateMessage(body);
    if (validation.success) {
      return [validation.data];
    }

    // Try to construct a ClutchMessage from the body
    const data = body as Record<string, unknown>;

    // Determine message type, defaulting to chat.message
    const rawType = data.type as string | undefined;
    const messageType: MessageType = this.isValidMessageType(rawType) ? rawType : 'chat.message';

    const message = createMessage({
      thread_id: (data.thread_id as string) ?? generateThreadId(),
      run_id: (data.run_id as string) ?? generateRunId(),
      task_id: (data.task_id as string) ?? generateTaskId(),
      parent_task_id: (data.parent_task_id as string) ?? null,
      from: (data.from as { agent_id: string }) ?? { agent_id: 'agent:http' },
      to: (data.to as Array<{ agent_id: string }>) ?? [{ agent_id: 'agent:unknown' }],
      type: messageType,
      payload: data.payload ?? data,
      meta: {
        source: 'http',
        path: request.path,
        ...(data.meta as Record<string, unknown> ?? {}),
      },
    });

    return [message];
  }

  /**
   * Check if a string is a valid MessageType
   */
  private isValidMessageType(type: string | undefined): type is MessageType {
    if (!type) return false;
    const validTypes = [
      'task.request', 'task.accept', 'task.progress', 'task.result', 'task.error', 'task.cancel', 'task.timeout',
      'chat.message', 'chat.system',
      'tool.call', 'tool.result', 'tool.error',
      'agent.register', 'agent.heartbeat', 'agent.update',
      'routing.decision', 'routing.failure',
    ];
    return validTypes.includes(type);
  }

  /**
   * Transform outbound ClutchMessage to HTTP request
   */
  async outbound(msg: ClutchMessage): Promise<HTTPWebhookRequest> {
    // Find webhook config
    const meta = msg.meta as { webhook_id?: string } | undefined;
    const webhookId = meta?.webhook_id ?? msg.to[0]?.agent_id;

    const config = webhookId ? this.webhooks.get(webhookId) : undefined;

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config?.headers,
    };

    // Add auth header if configured
    if (config?.auth) {
      switch (config.auth.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${config.auth.token}`;
          break;
        case 'api_key':
          headers[config.auth.header ?? 'X-API-Key'] = config.auth.token ?? '';
          break;
        case 'basic':
          const credentials = Buffer.from(`${config.auth.username}:${config.auth.password}`).toString('base64');
          headers['Authorization'] = `Basic ${credentials}`;
          break;
      }
    }

    return {
      method: 'POST',
      headers,
      body: msg,
      path: config?.url,
    };
  }

  /**
   * Build an HTTP response from a ClutchMessage
   */
  buildResponse(msg: ClutchMessage): HTTPWebhookResponse {
    const isError = msg.type.endsWith('.error');

    return {
      status: isError ? 500 : 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Clutch-Message-Id': msg.id,
        'X-Clutch-Message-Type': msg.type,
      },
      body: msg,
    };
  }
}

/**
 * Create an HTTP adapter instance
 */
export function createHTTPAdapter(webhooks?: HTTPWebhookConfig[]): HTTPAdapter {
  return new HTTPAdapter(webhooks);
}
