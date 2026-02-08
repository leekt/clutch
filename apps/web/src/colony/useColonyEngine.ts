import { useEffect, useRef, useCallback, useState } from 'react';
import { ColonyEngine } from './ColonyEngine';
import { useStore, selectAgentsList, selectActiveTasksList } from '../store';
import { useColonyStore } from '../store/colony';
import type { PawnState } from './types';
import type { Agent, Task } from '../types';

/**
 * React hook that manages the ColonyEngine lifecycle.
 *
 * Creates the Pixi.js engine on mount, feeds it agent/task data from
 * Zustand stores, and cleans up on unmount.
 */
export function useColonyEngine() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ColonyEngine | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const agents = useStore(selectAgentsList);
  const tasks = useStore(selectActiveTasksList);
  const { simulationSpeed, selectPawn } = useColonyStore();

  // Store selectPawn in ref to avoid re-running the init effect
  const selectPawnRef = useRef(selectPawn);
  selectPawnRef.current = selectPawn;

  // Initialize engine
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    let destroyed = false;
    const engine = new ColonyEngine();
    engineRef.current = engine;

    engine.init(container).then(() => {
      if (destroyed) return;

      // Listen for clicks
      engine.on('agent-clicked', (data) => {
        const { agentId } = data as { agentId: string };
        setSelectedAgentId(agentId);
        selectPawnRef.current(agentId);
      });

      setReady(true);
    });

    // ResizeObserver for responsive sizing
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          engine.resize(width, height);
        }
      }
    });
    observer.observe(container);

    return () => {
      destroyed = true;
      observer.disconnect();
      engine.destroy();
      engineRef.current = null;
      setReady(false);
    };
  }, []); // Only run once on mount

  // Update agents whenever store changes (only after engine is ready)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;

    const pawnStates = buildPawnStates(agents, tasks);
    engine.updateAgents(pawnStates);
  }, [agents, tasks, ready]);

  // Update speed when control changes
  useEffect(() => {
    engineRef.current?.setSpeed(simulationSpeed);
  }, [simulationSpeed]);

  // Selection sync
  const handleSelectAgent = useCallback((agentId: string | null) => {
    setSelectedAgentId(agentId);
    selectPawnRef.current(agentId);
    engineRef.current?.selectAgent(agentId);
  }, []);

  return {
    canvasRef,
    selectedAgentId,
    selectAgent: handleSelectAgent,
    engine: engineRef,
  };
}

/** Map store data to PawnState array for the engine */
function buildPawnStates(agents: Agent[], tasks: Task[]): PawnState[] {
  return agents.map((agent) => {
    // Find the agent's current task
    const agentTask = tasks.find(
      (t) => t.assigneeId === agent.id && t.state === 'running',
    );

    return {
      agentId: agent.agentId,
      name: agent.name,
      role: agent.role,
      lifecycleState: agent.lifecycleState ?? 'asleep',
      progress: 0,
      currentTaskTitle: agentTask?.title,
    };
  });
}
