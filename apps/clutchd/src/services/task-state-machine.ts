import type { TaskState } from '../repositories/index.js';

export const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  created: ['assigned'],
  assigned: ['running', 'created'], // can unassign back to created
  running: ['review', 'assigned'], // can pause back to assigned
  review: ['done', 'rework'],
  rework: ['running', 'review'], // can go directly to review if quick fix
  done: [], // terminal state
};

export function isValidTransition(from: TaskState, to: TaskState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function getValidTransitions(state: TaskState): TaskState[] {
  return VALID_TRANSITIONS[state];
}

export interface TaskStateEvent {
  taskId: string;
  from: TaskState;
  to: TaskState;
  timestamp: Date;
  agentId?: string;
  reason?: string;
}

export class TaskStateMachine {
  private listeners: ((event: TaskStateEvent) => void)[] = [];

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

  canTransition(from: TaskState, to: TaskState): boolean {
    return isValidTransition(from, to);
  }

  getNextStates(current: TaskState): TaskState[] {
    return getValidTransitions(current);
  }
}

export const taskStateMachine = new TaskStateMachine();
