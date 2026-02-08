import type { AgentLifecycleState, AgentRole } from '../types';

/** Zones in the office map */
export type MapZoneType = 'desk' | 'meeting' | 'breakroom' | 'server';

export interface MapZone {
  type: MapZoneType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
}

/** Per-pawn visual state */
export interface PawnState {
  agentId: string;
  name: string;
  role: AgentRole;
  lifecycleState: AgentLifecycleState;
  progress: number; // 0–100, shown as bar
  activity?: string; // e.g. "Researching competitors"
  currentTaskTitle?: string;
}

/** Events emitted from the colony engine to React */
export interface ColonyEvent {
  type: 'task.assigned' | 'task.completed' | 'task.failed' | 'agent.woke' | 'agent.slept';
  agentName?: string;
  taskTitle?: string;
  timestamp: number;
}
