import type { ClutchMessage } from '@clutch/protocol';
import {
  createMessage,
  generateTaskId,
  ToolCallPayload,
  ToolResultPayload,
} from '@clutch/protocol';
import { BaseAdapter } from '../base.js';

/**
 * MCP (Model Context Protocol) Tool Call
 *
 * Based on the MCP specification for tool invocations.
 */
export interface MCPToolCall {
  jsonrpc: '2.0';
  id: string | number;
  method: 'tools/call';
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}

/**
 * MCP Tool Result
 */
export interface MCPToolResult {
  jsonrpc: '2.0';
  id: string | number;
  result?: {
    content: Array<{
      type: 'text' | 'image' | 'resource';
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    isError?: boolean;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  id: string;           // e.g., 'mcp:browser', 'mcp:files'
  url: string;          // Server URL
  transport: 'stdio' | 'http' | 'websocket';
  capabilities?: string[];
}

/**
 * MCP Adapter
 *
 * Translates between ClutchMessage tool.* types and MCP protocol.
 */
export class MCPAdapter extends BaseAdapter {
  name = 'mcp';

  private servers: Map<string, MCPServerConfig> = new Map();
  private pendingCalls: Map<string, {
    message: ClutchMessage;
    resolve: (result: ClutchMessage) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(servers: MCPServerConfig[] = []) {
    super();
    for (const server of servers) {
      this.servers.set(server.id, server);
    }
  }

  /**
   * Register an MCP server
   */
  registerServer(config: MCPServerConfig): void {
    this.servers.set(config.id, config);
  }

  /**
   * Unregister an MCP server
   */
  unregisterServer(id: string): void {
    this.servers.delete(id);
  }

  /**
   * Get registered server IDs
   */
  getServerIds(): string[] {
    return Array.from(this.servers.keys());
  }

  canHandle(msg: ClutchMessage): boolean {
    if (!this.matchesType(msg, ['tool.call', 'tool.result', 'tool.error'])) {
      return false;
    }

    const toolId = this.getToolId(msg);
    if (!toolId) return false;

    // Check if tool is from an MCP server
    return toolId.startsWith('mcp:') || this.servers.has(toolId);
  }

  /**
   * Transform inbound MCP message to ClutchMessage
   */
  async inbound(raw: unknown): Promise<ClutchMessage[]> {
    const mcpResult = raw as MCPToolResult;

    // Find the pending call
    const callId = String(mcpResult.id);
    const pending = this.pendingCalls.get(callId);

    if (!pending) {
      // No pending call, create a standalone result message
      return [this.createResultMessage(mcpResult, undefined)];
    }

    // Remove from pending
    this.pendingCalls.delete(callId);

    // Create result message linked to the original call
    const resultMsg = this.createResultMessage(mcpResult, pending.message);

    // Resolve the pending promise
    pending.resolve(resultMsg);

    return [resultMsg];
  }

  /**
   * Transform outbound ClutchMessage to MCP format
   */
  async outbound(msg: ClutchMessage): Promise<MCPToolCall> {
    if (msg.type !== 'tool.call') {
      throw new Error(`MCPAdapter only handles tool.call, got ${msg.type}`);
    }

    const payload = msg.payload as ToolCallPayload;
    const toolId = payload.tool;

    // Extract server and method from tool ID
    // Format: mcp:server/method or mcp:server
    const parts = toolId.replace('mcp:', '').split('/');
    const serverName = parts[0];
    const method = parts[1] ?? payload.method ?? 'call';

    if (!serverName) {
      throw new Error(`Invalid MCP tool ID: ${toolId}`);
    }

    const mcpCall: MCPToolCall = {
      jsonrpc: '2.0',
      id: msg.id,
      method: 'tools/call',
      params: {
        name: method,
        arguments: payload.args,
      },
    };

    return mcpCall;
  }

  /**
   * Call an MCP tool and wait for result
   */
  async callTool(msg: ClutchMessage): Promise<ClutchMessage> {
    return new Promise((resolve, reject) => {
      this.pendingCalls.set(msg.id, { message: msg, resolve, reject });

      // Set timeout
      setTimeout(() => {
        if (this.pendingCalls.has(msg.id)) {
          this.pendingCalls.delete(msg.id);
          reject(new Error(`MCP call timeout: ${msg.id}`));
        }
      }, 30000);
    });
  }

  private createResultMessage(mcpResult: MCPToolResult, originalMsg?: ClutchMessage): ClutchMessage {
    const isError = mcpResult.error !== undefined || mcpResult.result?.isError;

    // Extract result content
    let resultContent: unknown;
    if (mcpResult.result?.content) {
      if (mcpResult.result.content.length === 1 && mcpResult.result.content[0]?.type === 'text') {
        resultContent = mcpResult.result.content[0].text;
      } else {
        resultContent = mcpResult.result.content;
      }
    }

    const payload: ToolResultPayload = {
      tool: originalMsg ? (originalMsg.payload as ToolCallPayload).tool : 'mcp:unknown',
      success: !isError,
      result: resultContent,
      error: mcpResult.error?.message,
    };

    return createMessage({
      thread_id: originalMsg?.thread_id ?? `thr_${Date.now()}`,
      run_id: originalMsg?.run_id ?? `run_${Date.now()}`,
      task_id: originalMsg?.task_id ?? generateTaskId(),
      parent_task_id: originalMsg?.parent_task_id ?? null,
      from: { agent_id: 'agent:mcp' },
      to: originalMsg ? [originalMsg.from] : [{ agent_id: 'agent:unknown' }],
      type: isError ? 'tool.error' : 'tool.result',
      payload,
    });
  }
}

/**
 * Create an MCP adapter instance
 */
export function createMCPAdapter(servers?: MCPServerConfig[]): MCPAdapter {
  return new MCPAdapter(servers);
}
