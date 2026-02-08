import { useColonyEngine } from '../../colony/useColonyEngine';
import { useColonyStore } from '../../store/colony';
import { EventTicker } from './EventTicker';
import { TaskQueuePanel } from './TaskQueuePanel';
import { AgentInfoPanel } from './AgentInfoPanel';
import { ColonyControls } from './ColonyControls';

/**
 * ColonyView is the RimWorld-style top-down colony view.
 *
 * Shows agents as pixel pawns moving around an office map.
 * Overlays: event ticker (top), task queue (right), agent info (bottom), controls (bottom-right).
 */
export function ColonyView() {
  const { canvasRef, selectedAgentId, selectAgent } = useColonyEngine();
  const { selectedPawnId } = useColonyStore();

  // Use either the engine's selection or the store's selection
  const activeAgentId = selectedAgentId ?? selectedPawnId;

  return (
    <div className="flex-1 relative overflow-hidden bg-gray-950">
      {/* Pixi.js canvas */}
      <div ref={canvasRef} className="absolute inset-0" />

      {/* HUD Overlays */}
      <EventTicker />
      <TaskQueuePanel />
      <ColonyControls />

      {/* Agent info panel (shown when an agent is selected) */}
      {activeAgentId && (
        <AgentInfoPanel
          agentId={activeAgentId}
          onClose={() => selectAgent(null)}
        />
      )}
    </div>
  );
}
