/**
 * Daily Standup Service
 *
 * Automates the daily standup process for the AI organization:
 * 1. Wakes each agent at scheduled time
 * 2. Collects standup updates (completed, planned, blockers)
 * 3. Generates team summary
 * 4. Stores in daily logs
 * 5. Escalates blockers to PM
 *
 * Based on Organization OS principles.
 */

import { EventEmitter } from 'events';

import { nanoid } from 'nanoid';

import type { Agent } from '../db/index.js';
import { logger } from '../logger.js';
import { agentRepository } from '../repositories/agents.js';

import { agentMemoryService } from './agent-memory.js';

export interface StandupEntry {
  agentId: string;
  agentName: string;
  completed: string[];
  planned: string[];
  blockers: string[];
  status: 'collected' | 'skipped' | 'timeout';
}

export interface TeamStandup {
  standupId: string;
  date: string;
  startedAt: string;
  completedAt?: string;
  entries: StandupEntry[];
  summary?: string;
  escalations: string[];
}

export interface DailyStandupOptions {
  // Standup time in 24h format (e.g., "09:00")
  standupTime?: string;
  // Timeout for each agent's standup response (ms)
  agentTimeoutMs?: number;
  // PM agent ID for escalations
  pmAgentId?: string;
  // Whether to auto-schedule
  autoSchedule?: boolean;
}

class DailyStandupService extends EventEmitter {
  private options: Required<DailyStandupOptions>;
  private scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  private currentStandup: TeamStandup | null = null;

  constructor(options: DailyStandupOptions = {}) {
    super();
    this.options = {
      standupTime: options.standupTime ?? '09:00',
      agentTimeoutMs: options.agentTimeoutMs ?? 5 * 60 * 1000, // 5 minutes
      pmAgentId: options.pmAgentId ?? 'agent:pm',
      autoSchedule: options.autoSchedule ?? false,
    };

    if (this.options.autoSchedule) {
      this.scheduleNextStandup();
    }
  }

  /**
   * Schedule the next standup
   */
  scheduleNextStandup(): void {
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
    }

    const now = new Date();
    const parts = this.options.standupTime.split(':').map(Number);
    const hours = parts[0] ?? 9;
    const minutes = parts[1] ?? 0;

    const nextStandup = new Date(now);
    nextStandup.setHours(hours, minutes, 0, 0);

    // If we've passed today's standup time, schedule for tomorrow
    if (nextStandup <= now) {
      nextStandup.setDate(nextStandup.getDate() + 1);
    }

    const msUntilStandup = nextStandup.getTime() - now.getTime();

    logger.info(
      { nextStandup: nextStandup.toISOString(), msUntilStandup },
      'Scheduled next standup'
    );

    this.scheduledTimer = setTimeout(() => {
      this.runStandup();
      // Schedule the next one
      this.scheduleNextStandup();
    }, msUntilStandup);
  }

  /**
   * Run the daily standup
   */
  async runStandup(agentIds?: string[]): Promise<TeamStandup> {
    const log = logger.child({ component: 'standup' });
    const standupId = `standup_${nanoid()}`;
    const date = new Date().toISOString().split('T')[0]!;

    log.info({ standupId, date }, 'Starting daily standup');

    // Initialize standup record
    const standup: TeamStandup = {
      standupId,
      date,
      startedAt: new Date().toISOString(),
      entries: [],
      escalations: [],
    };
    this.currentStandup = standup;

    // Get agents to include in standup
    let agents: Agent[];
    if (agentIds) {
      agents = await Promise.all(
        agentIds.map(id => agentRepository.findByAgentId(id))
      ).then(results => results.filter((a): a is Agent => a !== undefined));
    } else {
      // Get all agents except PM (PM receives the standup, doesn't give one)
      agents = (await agentRepository.findAll())
        .filter(a => a.agentId !== this.options.pmAgentId);
    }

    log.info({ agentCount: agents.length }, 'Collecting standup from agents');

    // Collect standup from each agent
    for (const agent of agents) {
      try {
        const entry = await this.collectAgentStandup(agent);
        standup.entries.push(entry);

        // Collect any blockers for escalation
        if (entry.blockers.length > 0) {
          standup.escalations.push(
            ...entry.blockers.map(b => `[${agent.name}] ${b}`)
          );
        }
      } catch (error) {
        log.error({ agentId: agent.agentId, error }, 'Failed to collect standup');
        standup.entries.push({
          agentId: agent.agentId,
          agentName: agent.name,
          completed: [],
          planned: [],
          blockers: [],
          status: 'timeout',
        });
      }
    }

    // Generate team summary
    standup.summary = this.generateSummary(standup);
    standup.completedAt = new Date().toISOString();

    log.info(
      {
        standupId,
        entries: standup.entries.length,
        escalations: standup.escalations.length,
      },
      'Daily standup completed'
    );

    // Emit event
    this.emit('standup_complete', standup);

    // Escalate blockers to PM if any
    if (standup.escalations.length > 0) {
      await this.escalateBlockers(standup);
    }

    this.currentStandup = null;

    return standup;
  }

  /**
   * Collect standup from a single agent
   */
  private async collectAgentStandup(agent: Agent): Promise<StandupEntry> {
    const log = logger.child({ agentId: agent.agentId });

    // Get yesterday's and today's daily logs
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    const [yesterdayLog, todayLog] = await Promise.all([
      agentMemoryService.getDailyLog(agent.agentId, yesterdayStr),
      agentMemoryService.getDailyLog(agent.agentId, todayStr),
    ]);

    // Extract completed tasks from yesterday
    const completed = yesterdayLog?.completedTasks.map(t => t.title) || [];

    // Extract in-progress tasks as planned
    const planned = todayLog?.inProgressTasks.map(t => t.title) || [];

    // Get blockers
    const blockers = [...(yesterdayLog?.blockers || []), ...(todayLog?.blockers || [])];

    // Generate standup summary for this agent
    const summary = this.formatAgentStandupSummary({
      completed,
      planned,
      blockers,
    });

    // Store in agent's daily log
    await agentMemoryService.setStandupSummary(agent.agentId, summary);

    log.info({ completed: completed.length, planned: planned.length, blockers: blockers.length }, 'Collected standup');

    return {
      agentId: agent.agentId,
      agentName: agent.name,
      completed,
      planned,
      blockers,
      status: 'collected',
    };
  }

  /**
   * Format standup summary for a single agent
   */
  private formatAgentStandupSummary(data: {
    completed: string[];
    planned: string[];
    blockers: string[];
  }): string {
    const parts: string[] = [];

    if (data.completed.length > 0) {
      parts.push(`Completed: ${data.completed.join(', ')}`);
    }

    if (data.planned.length > 0) {
      parts.push(`Today: ${data.planned.join(', ')}`);
    }

    if (data.blockers.length > 0) {
      parts.push(`Blockers: ${data.blockers.join(', ')}`);
    }

    return parts.join('. ') || 'No updates.';
  }

  /**
   * Generate team standup summary
   */
  private generateSummary(standup: TeamStandup): string {
    const lines: string[] = [`# Daily Standup - ${standup.date}`, ''];

    for (const entry of standup.entries) {
      lines.push(`## ${entry.agentName} (${entry.agentId})`);

      if (entry.status === 'timeout') {
        lines.push('- *(No response)*');
        lines.push('');
        continue;
      }

      if (entry.completed.length > 0) {
        lines.push('- Completed: ' + entry.completed.join(', '));
      } else {
        lines.push('- Completed: None');
      }

      if (entry.planned.length > 0) {
        lines.push('- Today: ' + entry.planned.join(', '));
      } else {
        lines.push('- Today: No specific plans');
      }

      if (entry.blockers.length > 0) {
        lines.push('- **Blockers**: ' + entry.blockers.join(', '));
      } else {
        lines.push('- Blockers: None');
      }

      lines.push('');
    }

    if (standup.escalations.length > 0) {
      lines.push('## Escalations');
      lines.push('');
      for (const escalation of standup.escalations) {
        lines.push(`- ${escalation}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Escalate blockers to PM
   */
  private async escalateBlockers(standup: TeamStandup): Promise<void> {
    const log = logger.child({ standupId: standup.standupId });

    log.info(
      { blockers: standup.escalations.length },
      'Escalating blockers to PM'
    );

    // In a real implementation, this would create a task for the PM
    // or send a notification through the message bus

    // For now, just store in PM's memory
    for (const blocker of standup.escalations) {
      await agentMemoryService.addToDailyLog(this.options.pmAgentId, {
        taskId: 'escalation',
        title: `[ESCALATION] ${blocker}`,
        status: 'in_progress',
      });
    }

    this.emit('blockers_escalated', {
      standupId: standup.standupId,
      blockers: standup.escalations,
    });
  }

  /**
   * Get current standup status
   */
  getCurrentStandup(): TeamStandup | null {
    return this.currentStandup;
  }

  /**
   * Get scheduled standup time
   */
  getScheduledTime(): string {
    return this.options.standupTime;
  }

  /**
   * Update standup time
   */
  setStandupTime(time: string): void {
    this.options.standupTime = time;
    if (this.options.autoSchedule) {
      this.scheduleNextStandup();
    }
  }

  /**
   * Cancel scheduled standup
   */
  cancelScheduled(): void {
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
  }

  /**
   * Get standup statistics
   */
  async getStats(): Promise<{
    scheduledTime: string;
    nextStandup: Date | null;
    lastStandupDate: string | null;
  }> {
    const parts = this.options.standupTime.split(':').map(Number);
    const hours = parts[0] ?? 9;
    const minutes = parts[1] ?? 0;
    const now = new Date();
    const nextStandup = new Date(now);
    nextStandup.setHours(hours, minutes, 0, 0);

    if (nextStandup <= now) {
      nextStandup.setDate(nextStandup.getDate() + 1);
    }

    return {
      scheduledTime: this.options.standupTime,
      nextStandup: this.scheduledTimer ? nextStandup : null,
      lastStandupDate: null, // Would need to track this in DB
    };
  }
}

// Singleton instance
export const dailyStandupService = new DailyStandupService();

// Export class for testing
export { DailyStandupService };
