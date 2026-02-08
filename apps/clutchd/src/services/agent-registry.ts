import type { Agent } from '../db/schema.js';
import { logger } from '../logger.js';
import { pubsub } from '../queue/index.js';
import { agentRepository } from '../repositories/index.js';

export type AgentStatus = 'available' | 'busy' | 'offline';

export interface AgentCapability {
  role: Agent['role'];
  permissions: Agent['permissions'];
  hasCapability(action: string): boolean;
}

export class AgentRegistry {
  private statusCache: Map<string, AgentStatus> = new Map();
  private busyUntil: Map<string, Date> = new Map();

  async loadAll(): Promise<Agent[]> {
    const agents = await agentRepository.findAll();
    for (const agent of agents) {
      this.statusCache.set(agent.id, agent.status as AgentStatus);
    }
    logger.info({ count: agents.length }, 'Agent registry loaded');
    return agents;
  }

  async getAgent(id: string): Promise<Agent | undefined> {
    return agentRepository.findById(id);
  }

  async getAgentByName(name: string): Promise<Agent | undefined> {
    return agentRepository.findByName(name);
  }

  async setStatus(agentId: string, status: AgentStatus): Promise<void> {
    this.statusCache.set(agentId, status);
    await agentRepository.updateStatus(agentId, status);
    await pubsub.publishAgentStatus(agentId, status);
    logger.info({ agentId, status }, 'Agent status updated');
  }

  getStatus(agentId: string): AgentStatus {
    return this.statusCache.get(agentId) || 'offline';
  }

  async markBusy(agentId: string, estimatedDuration?: number): Promise<void> {
    await this.setStatus(agentId, 'busy');
    if (estimatedDuration) {
      this.busyUntil.set(agentId, new Date(Date.now() + estimatedDuration));
    }
  }

  async markAvailable(agentId: string): Promise<void> {
    this.busyUntil.delete(agentId);
    await this.setStatus(agentId, 'available');
  }

  async markOffline(agentId: string): Promise<void> {
    this.busyUntil.delete(agentId);
    await this.setStatus(agentId, 'offline');
  }

  async findAvailableAgents(): Promise<Agent[]> {
    const agents = await agentRepository.findAll();
    return agents.filter((agent) => this.getStatus(agent.id) === 'available');
  }

  async findAgentsByRole(role: Agent['role']): Promise<Agent[]> {
    const agents = await agentRepository.findAll();
    return agents.filter((agent) => agent.role === role);
  }

  async findAvailableAgentForRole(role: Agent['role']): Promise<Agent | undefined> {
    const agents = await this.findAgentsByRole(role);
    return agents.find((agent) => this.getStatus(agent.id) === 'available');
  }

  async findAgentWithCapabilities(
    requiredPermissions: Partial<Agent['permissions']>
  ): Promise<Agent | undefined> {
    const agents = await this.findAvailableAgents();
    return agents.find((agent) => {
      for (const [key, required] of Object.entries(requiredPermissions)) {
        if (required && !agent.permissions[key as keyof Agent['permissions']]) {
          return false;
        }
      }
      return true;
    });
  }

  async matchAgentForTask(taskRequirements: {
    role?: Agent['role'];
    permissions?: Partial<Agent['permissions']>;
    preferredAgentId?: string;
  }): Promise<Agent | undefined> {
    // If preferred agent is specified and available, use it
    if (taskRequirements.preferredAgentId) {
      const preferred = await this.getAgent(taskRequirements.preferredAgentId);
      if (preferred && this.getStatus(preferred.id) === 'available') {
        return preferred;
      }
    }

    // Find by role first
    if (taskRequirements.role) {
      const byRole = await this.findAvailableAgentForRole(taskRequirements.role);
      if (byRole) {
        // Check permissions if specified
        if (taskRequirements.permissions) {
          const hasPermissions = Object.entries(taskRequirements.permissions).every(
            ([key, required]) => !required || byRole.permissions[key as keyof Agent['permissions']]
          );
          if (hasPermissions) {
            return byRole;
          }
        } else {
          return byRole;
        }
      }
    }

    // Fall back to capability matching
    if (taskRequirements.permissions) {
      return this.findAgentWithCapabilities(taskRequirements.permissions);
    }

    // No specific requirements, return any available agent
    const available = await this.findAvailableAgents();
    return available[0];
  }

  hasPermission(agent: Agent, permission: keyof Agent['permissions']): boolean {
    return agent.permissions[permission] === true;
  }

  checkBudget(agent: Agent, cost: number, tokens: number, runtime: number): {
    withinBudget: boolean;
    violations: string[];
  } {
    const violations: string[] = [];

    if (agent.budget.maxCost !== undefined && cost > agent.budget.maxCost) {
      violations.push(`Cost ${cost} exceeds budget limit ${agent.budget.maxCost}`);
    }

    if (agent.budget.maxTokens !== undefined && tokens > agent.budget.maxTokens) {
      violations.push(`Tokens ${tokens} exceeds budget limit ${agent.budget.maxTokens}`);
    }

    if (agent.budget.maxRuntime !== undefined && runtime > agent.budget.maxRuntime) {
      violations.push(`Runtime ${runtime}ms exceeds budget limit ${agent.budget.maxRuntime}ms`);
    }

    return {
      withinBudget: violations.length === 0,
      violations,
    };
  }
}

export const agentRegistry = new AgentRegistry();
