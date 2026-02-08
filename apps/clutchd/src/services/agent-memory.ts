/**
 * Agent Memory Service
 *
 * Manages the structured memory model for agents:
 * - WORKING.md: Current task context (session-scoped)
 * - daily/YYYY-MM-DD.md: Daily activity logs
 * - MEMORY.md: Long-term knowledge base
 *
 * Directory structure:
 * workspace/<agent-id>/memory/
 * ├── WORKING.md
 * ├── daily/
 * │   ├── 2026-02-01.md
 * │   └── 2026-02-02.md
 * └── MEMORY.md
 */

import { promises as fs } from 'fs';
import path from 'path';

import { logger } from '../logger.js';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './workspace';

export interface WorkingMemory {
  taskId: string;
  title: string;
  startedAt: string;
  context: string;
  progress: string[];
  notes: string;
}

export interface DailyLogEntry {
  taskId: string;
  title: string;
  status: 'completed' | 'in_progress' | 'blocked';
  duration?: string;
  artifacts?: string[];
  cost?: number;
}

export interface DailyLog {
  date: string;
  agentId: string;
  completedTasks: DailyLogEntry[];
  inProgressTasks: DailyLogEntry[];
  blockers: string[];
  standupSummary?: string;
}

export interface LongTermMemory {
  agentId: string;
  lastUpdated: string;
  domainKnowledge: Record<string, string>;
  lessonsLearned: string[];
}

class AgentMemoryService {
  /**
   * Get the memory directory path for an agent
   */
  private getMemoryPath(agentId: string): string {
    // Remove 'agent:' prefix if present
    const agentName = agentId.replace(/^agent:/, '');
    return path.join(WORKSPACE_ROOT, agentName, 'memory');
  }

  /**
   * Ensure memory directory exists
   */
  private async ensureMemoryDir(agentId: string): Promise<string> {
    const memoryPath = this.getMemoryPath(agentId);
    const dailyPath = path.join(memoryPath, 'daily');

    await fs.mkdir(memoryPath, { recursive: true });
    await fs.mkdir(dailyPath, { recursive: true });

    return memoryPath;
  }

  // =========================================================================
  // WORKING.md - Session-scoped current task context
  // =========================================================================

  /**
   * Create or update WORKING.md for a task
   */
  async initializeWorkingMemory(
    agentId: string,
    taskId: string,
    title: string,
    context: string
  ): Promise<void> {
    const memoryPath = await this.ensureMemoryDir(agentId);
    const workingPath = path.join(memoryPath, 'WORKING.md');

    const content = this.formatWorkingMemory({
      taskId,
      title,
      startedAt: new Date().toISOString(),
      context,
      progress: [],
      notes: '',
    });

    await fs.writeFile(workingPath, content, 'utf-8');
    logger.info({ agentId, taskId }, 'Initialized WORKING.md');
  }

  /**
   * Get current WORKING.md content
   */
  async getWorkingMemory(agentId: string): Promise<WorkingMemory | null> {
    const memoryPath = this.getMemoryPath(agentId);
    const workingPath = path.join(memoryPath, 'WORKING.md');

    try {
      const content = await fs.readFile(workingPath, 'utf-8');
      return this.parseWorkingMemory(content);
    } catch {
      return null;
    }
  }

  /**
   * Add a progress item to WORKING.md
   */
  async addProgress(agentId: string, progressItem: string): Promise<void> {
    const memory = await this.getWorkingMemory(agentId);
    if (!memory) {
      logger.warn({ agentId }, 'No WORKING.md to update');
      return;
    }

    memory.progress.push(progressItem);

    const memoryPath = this.getMemoryPath(agentId);
    const workingPath = path.join(memoryPath, 'WORKING.md');
    await fs.writeFile(workingPath, this.formatWorkingMemory(memory), 'utf-8');
  }

  /**
   * Add notes to WORKING.md
   */
  async addNotes(agentId: string, notes: string): Promise<void> {
    const memory = await this.getWorkingMemory(agentId);
    if (!memory) {
      logger.warn({ agentId }, 'No WORKING.md to update');
      return;
    }

    memory.notes = memory.notes ? `${memory.notes}\n\n${notes}` : notes;

    const memoryPath = this.getMemoryPath(agentId);
    const workingPath = path.join(memoryPath, 'WORKING.md');
    await fs.writeFile(workingPath, this.formatWorkingMemory(memory), 'utf-8');
  }

  /**
   * Archive WORKING.md on task completion
   */
  async archiveWorkingMemory(agentId: string): Promise<void> {
    const memoryPath = this.getMemoryPath(agentId);
    const workingPath = path.join(memoryPath, 'WORKING.md');

    try {
      const content = await fs.readFile(workingPath, 'utf-8');
      const memory = this.parseWorkingMemory(content);

      if (memory) {
        // Add to today's daily log
        await this.addToDailyLog(agentId, {
          taskId: memory.taskId,
          title: memory.title,
          status: 'completed',
          artifacts: [],
        });

        // Archive the WORKING.md to a backup
        const archivePath = path.join(
          memoryPath,
          'archive',
          `WORKING_${memory.taskId}_${Date.now()}.md`
        );
        await fs.mkdir(path.dirname(archivePath), { recursive: true });
        await fs.rename(workingPath, archivePath);

        logger.info({ agentId, taskId: memory.taskId }, 'Archived WORKING.md');
      }
    } catch (error) {
      logger.error({ agentId, error }, 'Failed to archive WORKING.md');
    }
  }

  /**
   * Clear WORKING.md (for new session)
   */
  async clearWorkingMemory(agentId: string): Promise<void> {
    const memoryPath = this.getMemoryPath(agentId);
    const workingPath = path.join(memoryPath, 'WORKING.md');

    try {
      await fs.unlink(workingPath);
      logger.info({ agentId }, 'Cleared WORKING.md');
    } catch {
      // File might not exist, that's fine
    }
  }

  private formatWorkingMemory(memory: WorkingMemory): string {
    const progressItems = memory.progress.length > 0
      ? memory.progress.map(p => `- [x] ${p}`).join('\n')
      : '(No progress yet)';

    return `# Current Task

**Task ID:** ${memory.taskId}
**Title:** ${memory.title}
**Started:** ${memory.startedAt}

## Context

${memory.context}

## Progress

${progressItems}

## Notes

${memory.notes || '(No notes yet)'}
`;
  }

  private parseWorkingMemory(content: string): WorkingMemory | null {
    try {
      const taskIdMatch = content.match(/\*\*Task ID:\*\*\s*(.+)/);
      const titleMatch = content.match(/\*\*Title:\*\*\s*(.+)/);
      const startedMatch = content.match(/\*\*Started:\*\*\s*(.+)/);
      const contextMatch = content.match(/## Context\n\n([\s\S]*?)(?=\n## Progress)/);
      const progressMatch = content.match(/## Progress\n\n([\s\S]*?)(?=\n## Notes)/);
      const notesMatch = content.match(/## Notes\n\n([\s\S]*?)$/);

      if (!taskIdMatch?.[1] || !titleMatch?.[1]) return null;

      const progress = progressMatch?.[1]
        ?.split('\n')
        .filter(line => line.startsWith('- ['))
        .map(line => line.replace(/^- \[.\] /, ''))
        || [];

      return {
        taskId: taskIdMatch[1].trim(),
        title: titleMatch[1].trim(),
        startedAt: startedMatch?.[1]?.trim() || new Date().toISOString(),
        context: contextMatch?.[1]?.trim() || '',
        progress,
        notes: notesMatch?.[1]?.trim() || '',
      };
    } catch {
      return null;
    }
  }

  // =========================================================================
  // Daily Logs - Activity tracking
  // =========================================================================

  /**
   * Get today's date string
   */
  private getDateString(date?: Date): string {
    const d = date || new Date();
    return d.toISOString().split('T')[0]!;
  }

  /**
   * Get daily log for a specific date
   */
  async getDailyLog(agentId: string, date?: string): Promise<DailyLog | null> {
    const dateStr = date || this.getDateString();
    const memoryPath = this.getMemoryPath(agentId);
    const dailyPath = path.join(memoryPath, 'daily', `${dateStr}.md`);

    try {
      const content = await fs.readFile(dailyPath, 'utf-8');
      return this.parseDailyLog(content, agentId, dateStr);
    } catch {
      return null;
    }
  }

  /**
   * Add an entry to today's daily log
   */
  async addToDailyLog(agentId: string, entry: DailyLogEntry): Promise<void> {
    const dateStr = this.getDateString();
    await this.ensureMemoryDir(agentId);

    let log = await this.getDailyLog(agentId, dateStr);
    if (!log) {
      log = {
        date: dateStr,
        agentId,
        completedTasks: [],
        inProgressTasks: [],
        blockers: [],
      };
    }

    if (entry.status === 'completed') {
      log.completedTasks.push(entry);
    } else if (entry.status === 'in_progress') {
      log.inProgressTasks.push(entry);
    } else if (entry.status === 'blocked') {
      log.blockers.push(`${entry.taskId}: ${entry.title}`);
    }

    const memoryPath = this.getMemoryPath(agentId);
    const dailyPath = path.join(memoryPath, 'daily', `${dateStr}.md`);
    await fs.writeFile(dailyPath, this.formatDailyLog(log), 'utf-8');

    logger.info({ agentId, date: dateStr, taskId: entry.taskId }, 'Updated daily log');
  }

  /**
   * Add a blocker to today's log
   */
  async addBlocker(agentId: string, blocker: string): Promise<void> {
    const dateStr = this.getDateString();
    await this.ensureMemoryDir(agentId);

    let log = await this.getDailyLog(agentId, dateStr);
    if (!log) {
      log = {
        date: dateStr,
        agentId,
        completedTasks: [],
        inProgressTasks: [],
        blockers: [],
      };
    }

    log.blockers.push(blocker);

    const memoryPath = this.getMemoryPath(agentId);
    const dailyPath = path.join(memoryPath, 'daily', `${dateStr}.md`);
    await fs.writeFile(dailyPath, this.formatDailyLog(log), 'utf-8');
  }

  /**
   * Set standup summary for today
   */
  async setStandupSummary(agentId: string, summary: string): Promise<void> {
    const dateStr = this.getDateString();
    await this.ensureMemoryDir(agentId);

    let log = await this.getDailyLog(agentId, dateStr);
    if (!log) {
      log = {
        date: dateStr,
        agentId,
        completedTasks: [],
        inProgressTasks: [],
        blockers: [],
      };
    }

    log.standupSummary = summary;

    const memoryPath = this.getMemoryPath(agentId);
    const dailyPath = path.join(memoryPath, 'daily', `${dateStr}.md`);
    await fs.writeFile(dailyPath, this.formatDailyLog(log), 'utf-8');
  }

  private formatDailyLog(log: DailyLog): string {
    const completedSection = log.completedTasks.length > 0
      ? log.completedTasks.map(t => {
          const duration = t.duration ? ` (${t.duration})` : '';
          const cost = t.cost ? `\n  - Cost: $${t.cost.toFixed(2)}` : '';
          const artifacts = t.artifacts?.length
            ? `\n  - Delivered: ${t.artifacts.join(', ')}`
            : '';
          return `- **${t.taskId}** ${t.title}${duration}${artifacts}${cost}`;
        }).join('\n')
      : 'None';

    const inProgressSection = log.inProgressTasks.length > 0
      ? log.inProgressTasks.map(t => `- **${t.taskId}** ${t.title}`).join('\n')
      : 'None';

    const blockersSection = log.blockers.length > 0
      ? log.blockers.map(b => `- ${b}`).join('\n')
      : 'None';

    return `# ${log.date}

## Completed Tasks

${completedSection}

## In Progress

${inProgressSection}

## Blockers

${blockersSection}

${log.standupSummary ? `## Standup Summary\n\n${log.standupSummary}\n` : ''}
`;
  }

  private parseDailyLog(content: string, agentId: string, date: string): DailyLog | null {
    try {
      // Simple parsing - in production, use a proper markdown parser
      return {
        date,
        agentId,
        completedTasks: [],
        inProgressTasks: [],
        blockers: [],
        standupSummary: content.match(/## Standup Summary\n\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim(),
      };
    } catch {
      return null;
    }
  }

  // =========================================================================
  // MEMORY.md - Long-term knowledge
  // =========================================================================

  /**
   * Get long-term memory
   */
  async getLongTermMemory(agentId: string): Promise<LongTermMemory | null> {
    const memoryPath = this.getMemoryPath(agentId);
    const memoryFilePath = path.join(memoryPath, 'MEMORY.md');

    try {
      const content = await fs.readFile(memoryFilePath, 'utf-8');
      return this.parseLongTermMemory(content, agentId);
    } catch {
      return null;
    }
  }

  /**
   * Add domain knowledge to long-term memory
   */
  async addDomainKnowledge(
    agentId: string,
    topic: string,
    knowledge: string
  ): Promise<void> {
    await this.ensureMemoryDir(agentId);

    let memory = await this.getLongTermMemory(agentId);
    if (!memory) {
      memory = {
        agentId,
        lastUpdated: new Date().toISOString(),
        domainKnowledge: {},
        lessonsLearned: [],
      };
    }

    memory.domainKnowledge[topic] = knowledge;
    memory.lastUpdated = new Date().toISOString();

    const memoryPath = this.getMemoryPath(agentId);
    const memoryFilePath = path.join(memoryPath, 'MEMORY.md');
    await fs.writeFile(memoryFilePath, this.formatLongTermMemory(memory), 'utf-8');

    logger.info({ agentId, topic }, 'Added domain knowledge');
  }

  /**
   * Add a lesson learned
   */
  async addLessonLearned(agentId: string, lesson: string): Promise<void> {
    await this.ensureMemoryDir(agentId);

    let memory = await this.getLongTermMemory(agentId);
    if (!memory) {
      memory = {
        agentId,
        lastUpdated: new Date().toISOString(),
        domainKnowledge: {},
        lessonsLearned: [],
      };
    }

    memory.lessonsLearned.push(lesson);
    memory.lastUpdated = new Date().toISOString();

    const memoryPath = this.getMemoryPath(agentId);
    const memoryFilePath = path.join(memoryPath, 'MEMORY.md');
    await fs.writeFile(memoryFilePath, this.formatLongTermMemory(memory), 'utf-8');

    logger.info({ agentId }, 'Added lesson learned');
  }

  /**
   * Summarize recent daily logs into long-term memory
   */
  async summarizeDailyLogs(agentId: string, days: number = 7): Promise<void> {
    const logs: DailyLog[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = this.getDateString(date);
      const log = await this.getDailyLog(agentId, dateStr);
      if (log) logs.push(log);
    }

    if (logs.length === 0) {
      logger.info({ agentId }, 'No daily logs to summarize');
      return;
    }

    // Create summary
    const totalTasks = logs.reduce((sum, l) => sum + l.completedTasks.length, 0);
    const summary = `Completed ${totalTasks} tasks over ${logs.length} days.`;

    await this.addDomainKnowledge(agentId, 'Recent Activity Summary', summary);
    logger.info({ agentId, days, totalTasks }, 'Summarized daily logs');
  }

  private formatLongTermMemory(memory: LongTermMemory): string {
    const agentName = memory.agentId.replace(/^agent:/, '');

    const domainSections = Object.entries(memory.domainKnowledge)
      .map(([topic, knowledge]) => `### ${topic}\n\n${knowledge}`)
      .join('\n\n');

    const lessonsSection = memory.lessonsLearned.length > 0
      ? memory.lessonsLearned.map(l => `- ${l}`).join('\n')
      : '(No lessons recorded yet)';

    return `# Agent Memory: ${agentName}

Last updated: ${memory.lastUpdated}

## Domain Knowledge

${domainSections || '(No domain knowledge yet)'}

## Lessons Learned

${lessonsSection}
`;
  }

  private parseLongTermMemory(content: string, agentId: string): LongTermMemory | null {
    try {
      const lastUpdatedMatch = content.match(/Last updated:\s*(.+)/);

      return {
        agentId,
        lastUpdated: lastUpdatedMatch?.[1]?.trim() || new Date().toISOString(),
        domainKnowledge: {},
        lessonsLearned: [],
      };
    } catch {
      return null;
    }
  }

  // =========================================================================
  // Utility methods
  // =========================================================================

  /**
   * Initialize memory structure for an agent
   */
  async initializeAgentMemory(agentId: string): Promise<void> {
    await this.ensureMemoryDir(agentId);

    // Create empty MEMORY.md if it doesn't exist
    const memory = await this.getLongTermMemory(agentId);
    if (!memory) {
      await this.addDomainKnowledge(agentId, 'Initialization', `Agent memory initialized on ${new Date().toISOString()}`);
    }

    logger.info({ agentId }, 'Agent memory initialized');
  }

  /**
   * Get full memory context for an agent (for prompting)
   */
  async getFullContext(agentId: string): Promise<{
    working: WorkingMemory | null;
    today: DailyLog | null;
    longTerm: LongTermMemory | null;
  }> {
    const [working, today, longTerm] = await Promise.all([
      this.getWorkingMemory(agentId),
      this.getDailyLog(agentId),
      this.getLongTermMemory(agentId),
    ]);

    return { working, today, longTerm };
  }
}

// Singleton instance
export const agentMemoryService = new AgentMemoryService();

// Export class for testing
export { AgentMemoryService };
