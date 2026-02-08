import { Container, Graphics, Text } from 'pixi.js';
import {
  MAP_COLS,
  MAP_ROWS,
  TILE_SIZE,
  ZONES,
  DESK_POSITIONS,
  ROLE_COLORS,
} from './constants';
import { createDeskGraphic } from './sprites';
import type { AgentRole } from '../types';

/**
 * OfficeMap renders the top-down office floor plan.
 *
 * Zones: work area (top), meeting room, break room, server room (bottom row).
 * Desks are placed per role in the work area.
 */
export class OfficeMap extends Container {
  constructor() {
    super();
    this.drawFloor();
    this.drawZones();
    this.drawDesks();
  }

  private drawFloor(): void {
    const floor = new Graphics();

    // Base floor
    floor.rect(0, 0, MAP_COLS * TILE_SIZE, MAP_ROWS * TILE_SIZE);
    floor.fill(0x0f172a);

    // Grid lines
    for (let col = 0; col <= MAP_COLS; col++) {
      floor.moveTo(col * TILE_SIZE, 0);
      floor.lineTo(col * TILE_SIZE, MAP_ROWS * TILE_SIZE);
    }
    for (let row = 0; row <= MAP_ROWS; row++) {
      floor.moveTo(0, row * TILE_SIZE);
      floor.lineTo(MAP_COLS * TILE_SIZE, row * TILE_SIZE);
    }
    floor.stroke({ width: 1, color: 0xffffff, alpha: 0.04 });

    this.addChild(floor);
  }

  private drawZones(): void {
    for (const zone of ZONES) {
      const zoneGfx = new Graphics();
      const x = zone.x * TILE_SIZE;
      const y = zone.y * TILE_SIZE;
      const w = zone.width * TILE_SIZE;
      const h = zone.height * TILE_SIZE;

      // Zone fill
      zoneGfx.rect(x, y, w, h);
      zoneGfx.fill({ color: zone.color, alpha: 0.4 });

      // Zone border
      zoneGfx.rect(x, y, w, h);
      zoneGfx.stroke({ width: 1, color: 0x475569, alpha: 0.5 });

      this.addChild(zoneGfx);

      // Zone label
      const label = new Text({
        text: zone.label,
        style: {
          fontFamily: 'monospace',
          fontSize: 10,
          fill: 0x94a3b8,
        },
      });
      label.x = x + 6;
      label.y = y + 4;
      this.addChild(label);
    }
  }

  private drawDesks(): void {
    const roles = Object.keys(DESK_POSITIONS) as AgentRole[];
    for (const role of roles) {
      const pos = DESK_POSITIONS[role];
      const desk = createDeskGraphic();
      desk.x = pos.col * TILE_SIZE + TILE_SIZE / 2;
      desk.y = pos.row * TILE_SIZE + TILE_SIZE + 6; // Below pawn position
      this.addChild(desk);

      // Desk nameplate
      const plate = new Text({
        text: role.toUpperCase(),
        style: {
          fontFamily: 'monospace',
          fontSize: 8,
          fill: ROLE_COLORS[role],
        },
      });
      plate.anchor.set(0.5);
      plate.x = pos.col * TILE_SIZE + TILE_SIZE / 2;
      plate.y = pos.row * TILE_SIZE + TILE_SIZE + 24;
      this.addChild(plate);
    }
  }
}
