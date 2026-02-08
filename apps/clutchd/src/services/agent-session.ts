/**
 * Agent Session Service
 *
 * Manages the agent lifecycle: wake → work → sleep
 *
 * Key principles (Organization OS):
 * - Agents are not always-on; they wake for tasks
 * - Each session is isolated (no state leakage between sessions)
 * - Control plane decides when to wake agents
 *
 * Wake triggers:
 * - Task assignment
 * - Scheduled time (e.g., daily standup)
 * - Review request
 * - Explicit human request
 */

import { EventEmitter } from 'events';

import { nanoid } from 'nanoid';

import { logger } from '../logger.js';
import { agentRepository } from '../repositories/agents.js';

export interface AgentSession {
  sessionId: string;
  agentId: string;
  startedAt: Date;
  taskId?: string;
  wakeReason: WakeReason;
  metadata?: Record<string, unknown>;
}

export type WakeReason =
  | 'task_assignment'
  | 'scheduled_standup'
  | 'review_request'
  | 'human_request'
  | 'scheduled_task';

export type SessionEvent =
  | { type: 'session_started'; session: AgentSession }
  | { type: 'session_ended'; session: AgentSession; duration: number }
  | { type: 'session_timeout'; session: AgentSession }
  | { type: 'session_error'; session: AgentSession; error: Error };

export interface AgentSessionServiceOptions {
  // Default session timeout in milliseconds (default: 30 minutes)
  defaultTimeoutMs?: number;
  // Maximum concurrent sessions per agent (default: 1)
  maxConcurrentSessions?: number;
}

class AgentSessionService extends EventEmitter {
  private activeSessions: Map<string, AgentSession> = new Map();
  private sessionTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private options: Required<AgentSessionServiceOptions>;

  constructor(options: AgentSessionServiceOptions = {}) {
    super();
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs ?? 30 * 60 * 1000, // 30 minutes
      maxConcurrentSessions: options.maxConcurrentSessions ?? 1,
    };
  }

  /**
   * Wake an agent for a task session
   */
  async wakeAgent(
    agentId: string,
    reason: WakeReason,
    options: {
      taskId?: string;
      timeoutMs?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<AgentSession> {
    const log = logger.child({ agentId, reason });

    // Check if agent exists
    const agent = await agentRepository.findByAgentId(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Check if agent is already awake
    const existingSession = this.getActiveSession(agentId);
    if (existingSession) {
      // For now, only allow one session per agent
      if (this.options.maxConcurrentSessions === 1) {
        log.warn({ existingSession }, 'Agent already awake, returning existing session');
        return existingSession;
      }
    }

    // Check agent's current lifecycle state
    if (agent.lifecycleState === 'working') {
      log.warn('Agent already in working state');
      // Return existing session if we have it
      if (existingSession) return existingSession;
    }

    // Generate session ID
    const sessionId = `session_${nanoid()}`;

    // Create session record
    const session: AgentSession = {
      sessionId,
      agentId,
      startedAt: new Date(),
      taskId: options.taskId,
      wakeReason: reason,
      metadata: options.metadata,
    };

    // Update agent state in database
    await agentRepository.wake(agentId, sessionId);

    // Store active session
    this.activeSessions.set(agentId, session);

    // Set session timeout
    const timeoutMs = options.timeoutMs ?? this.options.defaultTimeoutMs;
    const timeout = setTimeout(() => {
      this.handleSessionTimeout(agentId, session);
    }, timeoutMs);
    this.sessionTimeouts.set(sessionId, timeout);

    log.info({ sessionId, taskId: options.taskId }, 'Agent woken');

    // Emit event
    this.emit('session', { type: 'session_started', session } as SessionEvent);

    return session;
  }

  /**
   * Put an agent to sleep after work completion
   */
  async sleepAgent(
    agentId: string,
    options: {
      sessionId?: string;
      forceEvenIfBusy?: boolean;
    } = {}
  ): Promise<void> {
    const log = logger.child({ agentId });

    const session = this.getActiveSession(agentId);
    if (!session) {
      log.warn('No active session to end');
      // Still update the database state
      await agentRepository.sleep(agentId);
      return;
    }

    // Verify session ID if provided
    if (options.sessionId && session.sessionId !== options.sessionId) {
      throw new Error(`Session ID mismatch: expected ${session.sessionId}, got ${options.sessionId}`);
    }

    // Calculate session duration
    const duration = Date.now() - session.startedAt.getTime();

    // Clear timeout
    const timeout = this.sessionTimeouts.get(session.sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(session.sessionId);
    }

    // Remove from active sessions
    this.activeSessions.delete(agentId);

    // Update agent state in database
    await agentRepository.sleep(agentId);

    log.info({ sessionId: session.sessionId, durationMs: duration }, 'Agent put to sleep');

    // Emit event
    this.emit('session', {
      type: 'session_ended',
      session,
      duration,
    } as SessionEvent);
  }

  /**
   * Handle session timeout
   */
  private async handleSessionTimeout(agentId: string, session: AgentSession): Promise<void> {
    const log = logger.child({ agentId, sessionId: session.sessionId });
    log.warn('Session timed out');

    // Emit timeout event
    this.emit('session', { type: 'session_timeout', session } as SessionEvent);

    // Force sleep
    await this.sleepAgent(agentId, { forceEvenIfBusy: true });
  }

  /**
   * Get the active session for an agent
   */
  getActiveSession(agentId: string): AgentSession | undefined {
    return this.activeSessions.get(agentId);
  }

  /**
   * Check if an agent is currently awake
   */
  isAwake(agentId: string): boolean {
    return this.activeSessions.has(agentId);
  }

  /**
   * Get all active sessions
   */
  getAllActiveSessions(): AgentSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Get sessions by wake reason
   */
  getSessionsByReason(reason: WakeReason): AgentSession[] {
    return Array.from(this.activeSessions.values())
      .filter(s => s.wakeReason === reason);
  }

  /**
   * Wake agents for daily standup
   */
  async wakeForStandup(agentIds: string[]): Promise<AgentSession[]> {
    const sessions: AgentSession[] = [];

    for (const agentId of agentIds) {
      try {
        const session = await this.wakeAgent(agentId, 'scheduled_standup', {
          timeoutMs: 10 * 60 * 1000, // 10 minutes for standup
          metadata: { standupDate: new Date().toISOString().split('T')[0] },
        });
        sessions.push(session);
      } catch (error) {
        logger.error({ agentId, error }, 'Failed to wake agent for standup');
      }
    }

    return sessions;
  }

  /**
   * Extend session timeout
   */
  extendSession(sessionId: string, additionalMs: number): boolean {
    const session = Array.from(this.activeSessions.values())
      .find(s => s.sessionId === sessionId);

    if (!session) return false;

    // Clear existing timeout
    const existingTimeout = this.sessionTimeouts.get(sessionId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      this.handleSessionTimeout(session.agentId, session);
    }, additionalMs);
    this.sessionTimeouts.set(sessionId, timeout);

    logger.info({ sessionId, additionalMs }, 'Session extended');
    return true;
  }

  /**
   * Get session statistics
   */
  getStats(): {
    activeSessions: number;
    byReason: Record<WakeReason, number>;
    oldestSession: AgentSession | null;
  } {
    const sessions = Array.from(this.activeSessions.values());
    const byReason: Record<WakeReason, number> = {
      task_assignment: 0,
      scheduled_standup: 0,
      review_request: 0,
      human_request: 0,
      scheduled_task: 0,
    };

    for (const session of sessions) {
      byReason[session.wakeReason]++;
    }

    const oldestSession = sessions.reduce<AgentSession | null>((oldest, session) => {
      if (!oldest || session.startedAt < oldest.startedAt) {
        return session;
      }
      return oldest;
    }, null);

    return {
      activeSessions: sessions.length,
      byReason,
      oldestSession,
    };
  }

  /**
   * Cleanup: sleep all agents (for shutdown)
   */
  async sleepAllAgents(): Promise<void> {
    const agentIds = Array.from(this.activeSessions.keys());
    for (const agentId of agentIds) {
      await this.sleepAgent(agentId, { forceEvenIfBusy: true });
    }
  }
}

// Singleton instance
export const agentSessionService = new AgentSessionService();

// Export class for testing
export { AgentSessionService };
