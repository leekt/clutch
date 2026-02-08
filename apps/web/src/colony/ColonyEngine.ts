import { Application, Container } from 'pixi.js';
import { OfficeMap } from './OfficeMap';
import { AgentPawn } from './AgentPawn';
import { MAP_WIDTH, MAP_HEIGHT } from './constants';
import type { PawnState, ColonyEvent } from './types';

type EngineEventType = 'agent-clicked' | 'agent-hovered' | 'colony-event';
type EngineCallback = (data: unknown) => void;

/**
 * ColonyEngine is the Pixi.js orchestrator for the RimWorld-style colony view.
 *
 * Manages the office map, agent pawns, animations, and user interaction.
 */
export class ColonyEngine {
  private app: Application;
  private mapContainer: Container;
  private pawnContainer: Container;
  private pawns: Map<string, AgentPawn> = new Map();
  private selectedAgentId: string | null = null;
  private speedMultiplier = 1;
  private eventListeners: Map<EngineEventType, EngineCallback[]> = new Map();
  private recentEvents: ColonyEvent[] = [];
  private initialized = false;

  constructor() {
    this.app = new Application();
    this.mapContainer = new Container();
    this.pawnContainer = new Container();
  }

  /** Initialize the Pixi application and mount to a canvas container */
  async init(container: HTMLElement): Promise<void> {
    if (this.initialized) return;

    const { width, height } = container.getBoundingClientRect();

    await this.app.init({
      background: 0x0f172a,
      width: width || 800,
      height: height || 600,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    container.appendChild(this.app.canvas);

    // Build scene graph
    const officeMap = new OfficeMap();
    this.mapContainer.addChild(officeMap);

    this.app.stage.addChild(this.mapContainer);
    this.app.stage.addChild(this.pawnContainer);

    // Center the map
    this.centerMap();

    // Animation loop
    this.app.ticker.add((ticker) => {
      for (const pawn of this.pawns.values()) {
        pawn.tick(ticker.deltaTime, this.speedMultiplier);
      }
    });

    this.initialized = true;
  }

  /** Update agent pawns from store data */
  updateAgents(agentStates: PawnState[]): void {
    const currentIds = new Set(agentStates.map((a) => a.agentId));

    // Remove pawns for agents that no longer exist
    for (const [id, pawn] of this.pawns) {
      if (!currentIds.has(id)) {
        this.pawnContainer.removeChild(pawn);
        this.pawns.delete(id);
      }
    }

    // Create or update pawns
    for (const state of agentStates) {
      let pawn = this.pawns.get(state.agentId);

      if (!pawn) {
        pawn = new AgentPawn(state.agentId, state.name, state.role);

        // Click handler
        pawn.on('pointertap', () => {
          this.selectAgent(state.agentId);
          this.emit('agent-clicked', { agentId: state.agentId });
        });

        pawn.on('pointerover', () => {
          this.emit('agent-hovered', { agentId: state.agentId });
        });

        this.pawnContainer.addChild(pawn);
        this.pawns.set(state.agentId, pawn);
      }

      pawn.setState(state.lifecycleState);
      pawn.setProgress(state.progress);
      pawn.setActivity(state.currentTaskTitle);
    }
  }

  /** Select an agent pawn (highlight ring) */
  selectAgent(agentId: string | null): void {
    // Deselect previous
    if (this.selectedAgentId) {
      this.pawns.get(this.selectedAgentId)?.setSelected(false);
    }

    this.selectedAgentId = agentId;

    if (agentId) {
      this.pawns.get(agentId)?.setSelected(true);
    }
  }

  /** Add a colony event to the ticker */
  addEvent(event: ColonyEvent): void {
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > 50) {
      this.recentEvents.pop();
    }
    this.emit('colony-event', event);
  }

  /** Get recent events */
  getRecentEvents(): ColonyEvent[] {
    return this.recentEvents;
  }

  /** Set animation speed multiplier */
  setSpeed(multiplier: number): void {
    this.speedMultiplier = multiplier;
  }

  /** Resize the renderer */
  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.centerMap();
  }

  /** Subscribe to engine events */
  on(event: EngineEventType, callback: EngineCallback): void {
    const listeners = this.eventListeners.get(event) ?? [];
    listeners.push(callback);
    this.eventListeners.set(event, listeners);
  }

  /** Unsubscribe from engine events */
  off(event: EngineEventType, callback: EngineCallback): void {
    const listeners = this.eventListeners.get(event) ?? [];
    this.eventListeners.set(
      event,
      listeners.filter((cb) => cb !== callback),
    );
  }

  private emit(event: EngineEventType, data: unknown): void {
    const listeners = this.eventListeners.get(event) ?? [];
    for (const cb of listeners) cb(data);
  }

  private centerMap(): void {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;

    const scale = Math.min(screenW / MAP_WIDTH, screenH / MAP_HEIGHT, 1.5);

    this.mapContainer.scale.set(scale);
    this.pawnContainer.scale.set(scale);

    this.mapContainer.x = (screenW - MAP_WIDTH * scale) / 2;
    this.mapContainer.y = (screenH - MAP_HEIGHT * scale) / 2;

    this.pawnContainer.x = this.mapContainer.x;
    this.pawnContainer.y = this.mapContainer.y;
  }

  /** Clean up resources */
  destroy(): void {
    try {
      if (this.initialized) {
        this.app.destroy(
          { removeView: true },
          { children: true, texture: true, textureSource: true },
        );
      }
    } catch {
      // Pixi may throw if destroyed before init completes
    }
    this.pawns.clear();
    this.eventListeners.clear();
    this.initialized = false;
  }
}
