import { Container, Graphics, Text } from 'pixi.js';
import { PAWN_SIZE, ROLE_COLORS, getPawnPosition } from './constants';
import { createPawnGraphic, createSelectionRing } from './sprites';
import type { AgentLifecycleState, AgentRole } from '../types';

/**
 * AgentPawn is a visual representation of an agent in the colony view.
 *
 * Contains: body sprite, name label, status bar, activity text.
 * Supports: movement animation, state-based visuals, click interaction.
 */
export class AgentPawn extends Container {
  readonly agentId: string;
  readonly role: AgentRole;

  private body: Graphics;
  private nameLabel: Text;
  private statusText: Text;
  private progressBg: Graphics;
  private progressFill: Graphics;
  private selectionRing: Graphics;
  private activityBubble: Container;
  private activityText: Text;

  // Animation state
  private targetX = 0;
  private targetY = 0;
  private animSpeed = 2; // pixels per frame
  private bobPhase = Math.random() * Math.PI * 2;
  private bobAmount = 0;
  private currentState: AgentLifecycleState = 'asleep';
  private zzzPhase = 0;
  private selected = false;

  constructor(agentId: string, name: string, role: AgentRole) {
    super();
    this.agentId = agentId;
    this.role = role;
    this.eventMode = 'static';
    this.cursor = 'pointer';

    // Body
    this.body = createPawnGraphic(ROLE_COLORS[role]);
    this.addChild(this.body);

    // Name label (below body)
    this.nameLabel = new Text({
      text: name,
      style: {
        fontFamily: 'monospace',
        fontSize: 9,
        fill: 0xe2e8f0,
      },
    });
    this.nameLabel.anchor.set(0.5, 0);
    this.nameLabel.y = PAWN_SIZE * 0.4;
    this.addChild(this.nameLabel);

    // Status text (lifecycle state indicator)
    this.statusText = new Text({
      text: '',
      style: {
        fontFamily: 'monospace',
        fontSize: 8,
        fill: 0x94a3b8,
      },
    });
    this.statusText.anchor.set(0.5, 0);
    this.statusText.y = PAWN_SIZE * 0.4 + 12;
    this.addChild(this.statusText);

    // Progress bar (above head)
    const barWidth = 30;
    this.progressBg = new Graphics();
    this.progressBg.rect(-barWidth / 2, 0, barWidth, 3);
    this.progressBg.fill(0x334155);
    this.progressBg.y = -PAWN_SIZE * 0.7;
    this.progressBg.visible = false;
    this.addChild(this.progressBg);

    this.progressFill = new Graphics();
    this.progressFill.y = -PAWN_SIZE * 0.7;
    this.progressFill.visible = false;
    this.addChild(this.progressFill);

    // Selection ring
    this.selectionRing = createSelectionRing();
    this.selectionRing.visible = false;
    this.addChild(this.selectionRing);

    // Activity bubble
    this.activityBubble = new Container();
    this.activityBubble.visible = false;
    this.activityBubble.y = -PAWN_SIZE - 10;

    const bubbleBg = new Graphics();
    bubbleBg.roundRect(-50, -10, 100, 14, 3);
    bubbleBg.fill({ color: 0x1e293b, alpha: 0.9 });
    bubbleBg.stroke({ width: 1, color: 0x475569 });
    this.activityBubble.addChild(bubbleBg);

    this.activityText = new Text({
      text: '',
      style: {
        fontFamily: 'monospace',
        fontSize: 8,
        fill: 0xe2e8f0,
      },
    });
    this.activityText.anchor.set(0.5, 0.5);
    this.activityText.y = -3;
    this.activityBubble.addChild(this.activityText);
    this.addChild(this.activityBubble);

    // Initialize position
    const pos = getPawnPosition(role, 'asleep');
    this.x = pos.x;
    this.y = pos.y;
    this.targetX = pos.x;
    this.targetY = pos.y;
  }

  /** Move pawn to a target position with lerp animation */
  moveTo(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /** Update lifecycle state and move to appropriate zone */
  setState(state: AgentLifecycleState): void {
    this.currentState = state;
    const pos = getPawnPosition(this.role, state);
    this.moveTo(pos.x, pos.y);

    // Update bobbing based on state
    switch (state) {
      case 'working':
        this.bobAmount = 1.5;
        this.statusText.text = '';
        break;
      case 'waking':
        this.bobAmount = 0.5;
        this.statusText.text = '...';
        break;
      case 'sleeping':
        this.bobAmount = 0;
        this.statusText.text = '';
        break;
      case 'asleep':
        this.bobAmount = 0;
        this.statusText.text = '';
        break;
    }
  }

  /** Set progress bar value (0–100), hide when 0 */
  setProgress(progress: number): void {
    if (progress <= 0 || progress >= 100) {
      this.progressBg.visible = false;
      this.progressFill.visible = false;
      return;
    }

    this.progressBg.visible = true;
    this.progressFill.visible = true;

    const barWidth = 30;
    const fillWidth = (progress / 100) * barWidth;

    this.progressFill.clear();
    this.progressFill.rect(-barWidth / 2, 0, fillWidth, 3);
    this.progressFill.fill(0x22c55e);
  }

  /** Set activity text in speech bubble */
  setActivity(text?: string): void {
    if (!text) {
      this.activityBubble.visible = false;
      return;
    }

    // Truncate long text
    const display = text.length > 16 ? text.slice(0, 14) + '..' : text;
    this.activityText.text = display;
    this.activityBubble.visible = true;
  }

  /** Toggle selection ring */
  setSelected(selected: boolean): void {
    this.selected = selected;
    this.selectionRing.visible = selected;
  }

  /** Per-frame animation tick */
  tick(delta: number, speedMultiplier: number): void {
    const speed = this.animSpeed * speedMultiplier;

    // Position lerp
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 1) {
      const move = Math.min(speed * delta, dist);
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
    } else {
      this.x = this.targetX;
      this.y = this.targetY;
    }

    // Idle bobbing
    if (this.bobAmount > 0) {
      this.bobPhase += 0.05 * speedMultiplier;
      this.body.y = Math.sin(this.bobPhase) * this.bobAmount;
    }

    // ZZZ animation for sleeping/asleep
    if (this.currentState === 'asleep' || this.currentState === 'sleeping') {
      this.zzzPhase += 0.03 * speedMultiplier;
      // Pulsing selection ring as "breathing"
      if (!this.selected) {
        this.body.alpha = 0.5 + Math.sin(this.zzzPhase) * 0.15;
      }
      this.statusText.text = this.getZzzText();
    } else {
      this.body.alpha = 1;
    }

    // Pulse selection ring
    if (this.selected) {
      this.selectionRing.alpha = 0.6 + Math.sin(Date.now() / 300) * 0.3;
    }
  }

  private getZzzText(): string {
    const phase = Math.floor(this.zzzPhase) % 4;
    return ['z', 'zz', 'zzz', 'zz'][phase] ?? 'z';
  }
}
