import type { AgentLifecycleState, AgentRole } from '../types';
import type { MapZone, MapZoneType } from './types';

export const TILE_SIZE = 32;
export const MAP_COLS = 24;
export const MAP_ROWS = 16;
export const MAP_WIDTH = MAP_COLS * TILE_SIZE;   // 768
export const MAP_HEIGHT = MAP_ROWS * TILE_SIZE;  // 512

export const PAWN_SIZE = 24;
export const PAWN_HEAD_SIZE = 10;

/** Role → color palette */
export const ROLE_COLORS: Record<AgentRole, number> = {
  pm: 0x3b82f6,        // blue
  research: 0x8b5cf6,  // purple
  marketing: 0xec4899,  // pink
  developer: 0x22c55e,  // green
  qa: 0xf97316,        // orange
};

/** Role → hex string for CSS */
export const ROLE_COLOR_HEX: Record<AgentRole, string> = {
  pm: '#3b82f6',
  research: '#8b5cf6',
  marketing: '#ec4899',
  developer: '#22c55e',
  qa: '#f97316',
};

/** Office zones */
export const ZONES: MapZone[] = [
  // Work area — top section
  { type: 'desk', label: 'Work Area', x: 1, y: 1, width: 22, height: 8, color: 0x1e293b },
  // Bottom row rooms
  { type: 'meeting', label: 'Meeting Room', x: 1, y: 10, width: 6, height: 5, color: 0x1e3a5f },
  { type: 'breakroom', label: 'Break Room', x: 8, y: 10, width: 6, height: 5, color: 0x3f2a1e },
  { type: 'server', label: 'Server Room', x: 15, y: 10, width: 8, height: 5, color: 0x1a2e1a },
];

/** Desk positions per role (tile coordinates within the work area) */
export const DESK_POSITIONS: Record<AgentRole, { col: number; row: number }> = {
  pm: { col: 4, row: 3 },
  research: { col: 8, row: 3 },
  marketing: { col: 12, row: 3 },
  developer: { col: 16, row: 3 },
  qa: { col: 20, row: 3 },
};

/** Where agents go based on lifecycle state */
export const STATE_ZONE: Record<AgentLifecycleState, MapZoneType> = {
  working: 'desk',
  waking: 'desk',
  sleeping: 'breakroom',
  asleep: 'breakroom',
};

/** Get pixel position for a pawn based on role and lifecycle state */
export function getPawnPosition(
  role: AgentRole,
  state: AgentLifecycleState,
): { x: number; y: number } {
  if (state === 'working' || state === 'waking') {
    const desk = DESK_POSITIONS[role];
    return {
      x: desk.col * TILE_SIZE + TILE_SIZE / 2,
      y: desk.row * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  // Sleeping/asleep → breakroom, spread out by role
  const breakroom = ZONES.find((z) => z.type === 'breakroom')!;
  const roles: AgentRole[] = ['pm', 'research', 'marketing', 'developer', 'qa'];
  const idx = roles.indexOf(role);
  return {
    x: (breakroom.x + 1 + idx * 1.2) * TILE_SIZE,
    y: (breakroom.y + 2.5) * TILE_SIZE,
  };
}
