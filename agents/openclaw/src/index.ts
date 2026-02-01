import { z } from 'zod';
import Docker from 'dockerode';

// Agent configuration schema
export const AgentConfigSchema = z.object({
  name: z.string(),
  role: z.enum(['pm', 'research', 'marketing', 'developer', 'qa']),
  image: z.string(),
  permissions: z.object({
    file: z.boolean().default(false),
    shell: z.boolean().default(false),
    git: z.boolean().default(false),
    browser: z.boolean().default(false),
  }),
  budget: z.object({
    maxTokens: z.number().optional(),
    maxCost: z.number().optional(),
    maxRuntime: z.number().optional(), // seconds
  }),
  secrets: z.array(z.string()).default([]),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// Message types
export const MessageTypeSchema = z.enum([
  'PLAN',
  'PROPOSAL',
  'EXEC_REPORT',
  'REVIEW',
  'BLOCKER',
]);

export const MessageSchema = z.object({
  type: MessageTypeSchema,
  summary: z.string(),
  body: z.string(),
  artifacts: z.array(
    z.object({
      path: z.string(),
      hash: z.string(),
    })
  ),
  citations: z.array(z.string()),
  metadata: z.object({
    cost: z.number(),
    runtime: z.number(),
    tokens: z.number(),
  }),
});

export type Message = z.infer<typeof MessageSchema>;

// Agent runtime interface
export interface AgentRuntime {
  start(config: AgentConfig): Promise<string>; // returns container ID
  stop(containerId: string): Promise<void>;
  dispatch(containerId: string, task: unknown): Promise<Message>;
  getStatus(containerId: string): Promise<'running' | 'stopped' | 'error'>;
}

// Docker-based agent runtime
export class DockerAgentRuntime implements AgentRuntime {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  async start(config: AgentConfig): Promise<string> {
    const container = await this.docker.createContainer({
      Image: config.image,
      name: `clutch-agent-${config.name}`,
      Env: [
        `AGENT_NAME=${config.name}`,
        `AGENT_ROLE=${config.role}`,
        `PERMISSIONS=${JSON.stringify(config.permissions)}`,
      ],
      HostConfig: {
        AutoRemove: true,
        NetworkMode: 'clutch-network',
      },
    });

    await container.start();
    return container.id;
  }

  async stop(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.stop();
  }

  async dispatch(_containerId: string, _task: unknown): Promise<Message> {
    // TODO: Implement actual dispatch logic
    // This will involve sending the task to the agent container
    // and receiving the structured response
    throw new Error('Not implemented');
  }

  async getStatus(containerId: string): Promise<'running' | 'stopped' | 'error'> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      return info.State.Running ? 'running' : 'stopped';
    } catch {
      return 'error';
    }
  }
}

export { Docker };
