// Base adapter
export { AdapterRegistry, BaseAdapter, createAdapterRegistry } from './base.js';
export type { Adapter } from './base.js';

// MCP adapter
export { MCPAdapter, createMCPAdapter } from './mcp/index.js';
export type { MCPToolCall, MCPToolResult, MCPServerConfig } from './mcp/index.js';

// A2A adapter (stub)
export { A2AAdapter, createA2AAdapter } from './a2a/index.js';
export type { A2AMessage } from './a2a/index.js';

// HTTP adapter
export { HTTPAdapter, createHTTPAdapter } from './http/index.js';
export type { HTTPWebhookRequest, HTTPWebhookResponse, HTTPWebhookConfig } from './http/index.js';
