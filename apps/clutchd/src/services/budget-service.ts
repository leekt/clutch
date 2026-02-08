import type { Agent } from '../db/schema.js';
import { logger } from '../logger.js';
import { agentRepository, auditRepository } from '../repositories/index.js';

export interface UsageRecord {
  agentId: string;
  cost: number;
  tokens: number;
  runtime: number;
  taskId?: string;
  action?: string;
  timestamp: Date;
}

export interface BudgetCheck {
  allowed: boolean;
  currentUsage: {
    cost: number;
    tokens: number;
    runtime: number;
  };
  limits: {
    maxCost?: number;
    maxTokens?: number;
    maxRuntime?: number;
  };
  violations: string[];
}

export class BudgetService {
  // In-memory usage tracking (reset periodically or on-demand)
  private usageByAgent: Map<string, { cost: number; tokens: number; runtime: number }> = new Map();

  async getUsage(agentId: string): Promise<{ cost: number; tokens: number; runtime: number }> {
    return this.usageByAgent.get(agentId) || { cost: 0, tokens: 0, runtime: 0 };
  }

  async recordUsage(record: UsageRecord): Promise<void> {
    const current = await this.getUsage(record.agentId);

    this.usageByAgent.set(record.agentId, {
      cost: current.cost + record.cost,
      tokens: current.tokens + record.tokens,
      runtime: current.runtime + record.runtime,
    });

    // Also log to audit
    await auditRepository.logAction('budget.usage_recorded', 'agent', record.agentId, {
      agentId: record.agentId,
      cost: String(record.cost),
      tokens: record.tokens,
      runtime: record.runtime,
      details: {
        taskId: record.taskId,
        action: record.action,
        totalCost: current.cost + record.cost,
        totalTokens: current.tokens + record.tokens,
        totalRuntime: current.runtime + record.runtime,
      },
    });

    logger.debug({
      agentId: record.agentId,
      cost: record.cost,
      tokens: record.tokens,
      runtime: record.runtime,
    }, 'Usage recorded');
  }

  async checkBudget(agentId: string, estimatedCost: number, estimatedTokens: number, estimatedRuntime: number): Promise<BudgetCheck> {
    const agent = await agentRepository.findById(agentId);
    if (!agent) {
      return {
        allowed: false,
        currentUsage: { cost: 0, tokens: 0, runtime: 0 },
        limits: {},
        violations: ['Agent not found'],
      };
    }

    const usage = await this.getUsage(agentId);
    const violations: string[] = [];

    // Check cost limit
    if (agent.budget.maxCost !== undefined) {
      const projectedCost = usage.cost + estimatedCost;
      if (projectedCost > agent.budget.maxCost) {
        violations.push(
          `Cost budget exceeded: ${projectedCost.toFixed(4)} / ${agent.budget.maxCost} (adding ${estimatedCost.toFixed(4)})`
        );
      }
    }

    // Check token limit
    if (agent.budget.maxTokens !== undefined) {
      const projectedTokens = usage.tokens + estimatedTokens;
      if (projectedTokens > agent.budget.maxTokens) {
        violations.push(
          `Token budget exceeded: ${projectedTokens} / ${agent.budget.maxTokens} (adding ${estimatedTokens})`
        );
      }
    }

    // Check runtime limit
    if (agent.budget.maxRuntime !== undefined) {
      const projectedRuntime = usage.runtime + estimatedRuntime;
      if (projectedRuntime > agent.budget.maxRuntime) {
        violations.push(
          `Runtime budget exceeded: ${projectedRuntime}ms / ${agent.budget.maxRuntime}ms (adding ${estimatedRuntime}ms)`
        );
      }
    }

    return {
      allowed: violations.length === 0,
      currentUsage: usage,
      limits: agent.budget,
      violations,
    };
  }

  async resetAgentUsage(agentId: string): Promise<void> {
    this.usageByAgent.delete(agentId);

    await auditRepository.logAction('budget.reset', 'agent', agentId, {
      agentId,
    });

    logger.info({ agentId }, 'Agent budget usage reset');
  }

  async resetAllUsage(): Promise<void> {
    this.usageByAgent.clear();
    logger.info('All agent budget usage reset');
  }

  async getAgentBudgetStatus(agentId: string): Promise<{
    agent: Agent;
    usage: { cost: number; tokens: number; runtime: number };
    remaining: { cost?: number; tokens?: number; runtime?: number };
    percentUsed: { cost?: number; tokens?: number; runtime?: number };
  } | null> {
    const agent = await agentRepository.findById(agentId);
    if (!agent) {
      return null;
    }

    const usage = await this.getUsage(agentId);

    const remaining: { cost?: number; tokens?: number; runtime?: number } = {};
    const percentUsed: { cost?: number; tokens?: number; runtime?: number } = {};

    if (agent.budget.maxCost !== undefined) {
      remaining.cost = Math.max(0, agent.budget.maxCost - usage.cost);
      percentUsed.cost = (usage.cost / agent.budget.maxCost) * 100;
    }

    if (agent.budget.maxTokens !== undefined) {
      remaining.tokens = Math.max(0, agent.budget.maxTokens - usage.tokens);
      percentUsed.tokens = (usage.tokens / agent.budget.maxTokens) * 100;
    }

    if (agent.budget.maxRuntime !== undefined) {
      remaining.runtime = Math.max(0, agent.budget.maxRuntime - usage.runtime);
      percentUsed.runtime = (usage.runtime / agent.budget.maxRuntime) * 100;
    }

    return {
      agent,
      usage,
      remaining,
      percentUsed,
    };
  }
}

export const budgetService = new BudgetService();
