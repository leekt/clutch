import type { ClutchMessage } from '@clutch/protocol';

/**
 * Adapter Interface
 *
 * Adapters translate between external protocols and ClutchMessage format.
 * They handle both inbound (external → Clutch) and outbound (Clutch → external) transformations.
 */
export interface Adapter {
  /**
   * Adapter name (e.g., 'mcp', 'a2a', 'http')
   */
  name: string;

  /**
   * Check if this adapter can handle a message
   */
  canHandle(msg: ClutchMessage): boolean;

  /**
   * Transform inbound messages from external format to ClutchMessage
   */
  inbound(raw: unknown): Promise<ClutchMessage[]>;

  /**
   * Transform outbound messages from ClutchMessage to external format
   */
  outbound(msg: ClutchMessage): Promise<unknown>;
}

/**
 * Adapter registry for managing multiple adapters
 */
export class AdapterRegistry {
  private adapters: Map<string, Adapter> = new Map();

  /**
   * Register an adapter
   */
  register(adapter: Adapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  /**
   * Unregister an adapter
   */
  unregister(name: string): void {
    this.adapters.delete(name);
  }

  /**
   * Get an adapter by name
   */
  get(name: string): Adapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * Find an adapter that can handle a message
   */
  findHandler(msg: ClutchMessage): Adapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.canHandle(msg)) {
        return adapter;
      }
    }
    return undefined;
  }

  /**
   * List all registered adapters
   */
  list(): Adapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Process inbound message with appropriate adapter
   */
  async processInbound(adapterName: string, raw: unknown): Promise<ClutchMessage[]> {
    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      throw new Error(`Adapter not found: ${adapterName}`);
    }
    return adapter.inbound(raw);
  }

  /**
   * Process outbound message with appropriate adapter
   */
  async processOutbound(msg: ClutchMessage): Promise<{ adapter: string; result: unknown } | null> {
    const adapter = this.findHandler(msg);
    if (!adapter) {
      return null;
    }
    const result = await adapter.outbound(msg);
    return { adapter: adapter.name, result };
  }
}

/**
 * Base adapter class with common functionality
 */
export abstract class BaseAdapter implements Adapter {
  abstract name: string;

  abstract canHandle(msg: ClutchMessage): boolean;

  abstract inbound(raw: unknown): Promise<ClutchMessage[]>;

  abstract outbound(msg: ClutchMessage): Promise<unknown>;

  /**
   * Helper to check if message type matches a pattern
   */
  protected matchesType(msg: ClutchMessage, pattern: string | string[]): boolean {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    return patterns.some(p => {
      if (p.endsWith('.*')) {
        const prefix = p.slice(0, -2);
        return msg.type.startsWith(prefix + '.');
      }
      return msg.type === p;
    });
  }

  /**
   * Helper to extract tool ID from message
   */
  protected getToolId(msg: ClutchMessage): string | undefined {
    if (msg.type !== 'tool.call' && msg.type !== 'tool.result' && msg.type !== 'tool.error') {
      return undefined;
    }
    const payload = msg.payload as { tool?: string };
    return payload?.tool;
  }
}

/**
 * Create an adapter registry with default adapters
 */
export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry();
}
