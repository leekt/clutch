import type { TaskState } from '../repositories/index.js';

export const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  created: ['assigned', 'cancelled'],
  assigned: ['running', 'created', 'cancelled'], // can unassign back to created
  running: ['review', 'assigned', 'failed', 'cancelled'], // can pause back to assigned
  review: ['done', 'rework', 'cancelled'],
  rework: ['running', 'review', 'cancelled'], // can go directly to review if quick fix
  done: [], // terminal state
  cancelled: [], // terminal state
  failed: ['created', 'assigned'], // can retry from failed
};

export function isValidTransition(from: TaskState, to: TaskState): boolean {
  const validStates = VALID_TRANSITIONS[from];
  return validStates ? validStates.includes(to) : false;
}

export function getValidTransitions(state: TaskState): TaskState[] {
  return VALID_TRANSITIONS[state] ?? [];
}

export function isTerminalState(state: TaskState): boolean {
  return state === 'done' || state === 'cancelled';
}

export function isActiveState(state: TaskState): boolean {
  return state === 'running' || state === 'review' || state === 'rework';
}

export interface TaskStateEvent {
  taskId: string;
  runId: string;
  from: TaskState;
  to: TaskState;
  timestamp: Date;
  agentId?: string;
  reason?: string;
}

export class TaskStateMachine {
  private listeners: Array<(event: TaskStateEvent) => void> = [];

  onTransition(listener: (event: TaskStateEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emitTransition(event: TaskStateEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const taskStateMachine = new TaskStateMachine();
