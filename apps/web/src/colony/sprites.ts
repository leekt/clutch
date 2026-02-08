import { Graphics } from 'pixi.js';
import { PAWN_HEAD_SIZE, PAWN_SIZE, TILE_SIZE } from './constants';

/**
 * Create a pawn body graphic (colored rectangle with a head circle).
 */
export function createPawnGraphic(color: number): Graphics {
  const g = new Graphics();

  // Body (rectangle)
  g.rect(-PAWN_SIZE / 2, -PAWN_SIZE / 4, PAWN_SIZE, PAWN_SIZE * 0.6);
  g.fill(color);

  // Head (circle on top)
  g.circle(0, -PAWN_SIZE / 4 - PAWN_HEAD_SIZE / 2, PAWN_HEAD_SIZE / 2);
  g.fill(color);

  // Eyes (two small white dots)
  g.circle(-2, -PAWN_SIZE / 4 - PAWN_HEAD_SIZE / 2 - 1, 1.5);
  g.fill(0xffffff);
  g.circle(2, -PAWN_SIZE / 4 - PAWN_HEAD_SIZE / 2 - 1, 1.5);
  g.fill(0xffffff);

  return g;
}

/**
 * Create a desk graphic (dark rectangle with a lighter top surface).
 */
export function createDeskGraphic(): Graphics {
  const g = new Graphics();
  const w = TILE_SIZE * 1.5;
  const h = TILE_SIZE * 0.8;

  // Desk body
  g.rect(-w / 2, -h / 2, w, h);
  g.fill(0x4a3728);

  // Desk surface
  g.rect(-w / 2 + 2, -h / 2 + 2, w - 4, h * 0.3);
  g.fill(0x6b4f3a);

  // Monitor
  g.rect(-6, -h / 2 - 8, 12, 8);
  g.fill(0x334155);

  // Screen glow
  g.rect(-5, -h / 2 - 7, 10, 6);
  g.fill(0x60a5fa);

  return g;
}

/**
 * Create a progress bar graphic.
 */
export function createProgressBar(width: number): Graphics {
  const g = new Graphics();
  const h = 4;

  // Background
  g.rect(-width / 2, 0, width, h);
  g.fill(0x334155);

  return g;
}

/**
 * Create a progress bar fill graphic.
 */
export function createProgressFill(width: number, progress: number): Graphics {
  const g = new Graphics();
  const h = 4;
  const fillWidth = (progress / 100) * width;

  g.rect(-width / 2, 0, fillWidth, h);
  g.fill(0x22c55e);

  return g;
}

/**
 * Create floor tile graphic for the map.
 */
export function createFloorTile(color: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, TILE_SIZE, TILE_SIZE);
  g.fill(color);
  // Subtle grid line
  g.rect(0, 0, TILE_SIZE, 1);
  g.fill({ color: 0xffffff, alpha: 0.03 });
  g.rect(0, 0, 1, TILE_SIZE);
  g.fill({ color: 0xffffff, alpha: 0.03 });

  return g;
}

/**
 * Create a selection ring around a pawn.
 */
export function createSelectionRing(): Graphics {
  const g = new Graphics();
  const radius = PAWN_SIZE * 0.8;

  g.circle(0, 0, radius);
  g.stroke({ width: 2, color: 0xfbbf24, alpha: 0.8 });

  return g;
}

/**
 * Create a speech bubble graphic.
 */
export function createSpeechBubble(): Graphics {
  const g = new Graphics();

  // Bubble body
  g.roundRect(-40, -20, 80, 16, 4);
  g.fill({ color: 0x1e293b, alpha: 0.9 });
  g.stroke({ width: 1, color: 0x475569 });

  // Pointer triangle
  g.moveTo(-4, -4);
  g.lineTo(0, 2);
  g.lineTo(4, -4);
  g.fill({ color: 0x1e293b, alpha: 0.9 });

  return g;
}
