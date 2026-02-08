import { DeveloperAgent } from '../agents/developer.js';
import { MarketingAgent } from '../agents/marketing.js';
import { PMAgent } from '../agents/pm.js';
import { ResearchAgent } from '../agents/research.js';
import type { BaseAgent } from '../executor/base-agent.js';

import { HttpRuntime } from './http.js';
import { InProcessRuntime } from './in-process.js';
import { SubprocessRuntime } from './subprocess.js';
import type { AgentRuntime, RuntimeConfig } from './types.js';

/**
 * Map of agent name → in-process BaseAgent constructor.
 *
 * When the runtime config is `{ type: 'in-process' }`, the factory
 * instantiates the matching class from this map.
 */
const IN_PROCESS_AGENTS: Record<string, (agentId: string) => BaseAgent> = {
  pm: (id) => new PMAgent(id),
  research: (id) => new ResearchAgent(id),
  marketing: (id) => new MarketingAgent(id),
  developer: (id) =>
    new DeveloperAgent(id, {
      workspaceRoot: process.env.WORKSPACE_ROOT || process.cwd(),
      allowShell: process.env.ALLOW_SHELL === 'true',
      allowGit: process.env.ALLOW_GIT === 'true',
    }),
};

/**
 * Create an AgentRuntime from a RuntimeConfig.
 *
 * @param agentName  - The agent's short name (e.g. "pm", "research")
 * @param config     - Runtime configuration (defaults to in-process)
 */
export function createRuntime(agentName: string, config: RuntimeConfig): AgentRuntime {
  switch (config.type) {
    case 'in-process': {
      const factory = IN_PROCESS_AGENTS[agentName];
      if (!factory) {
        throw new Error(
          `No in-process agent implementation for "${agentName}". ` +
          `Known agents: ${Object.keys(IN_PROCESS_AGENTS).join(', ')}`,
        );
      }
      const agent = factory(`agent:${agentName}`);
      return new InProcessRuntime(agentName, agent);
    }

    case 'http':
      return new HttpRuntime(agentName, config);

    case 'subprocess':
      return new SubprocessRuntime(agentName, config);

    default:
      throw new Error(`Unknown runtime type: ${(config as { type: string }).type}`);
  }
}
