// Base adapter
export {
  Adapter,
  AdapterRegistry,
  BaseAdapter,
  createAdapterRegistry,
} from './base.js';

// MCP adapter
export {
  MCPAdapter,
  MCPToolCall,
  MCPToolResult,
  MCPServerConfig,
  createMCPAdapter,
} from './mcp/index.js';

// A2A adapter (stub)
export {
  A2AAdapter,
  A2AMessage,
  createA2AAdapter,
} from './a2a/index.js';

// HTTP adapter
export {
  HTTPAdapter,
  HTTPWebhookRequest,
  HTTPWebhookResponse,
  HTTPWebhookConfig,
  createHTTPAdapter,
} from './http/index.js';
