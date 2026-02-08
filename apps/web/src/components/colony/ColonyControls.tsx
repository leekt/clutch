import { clsx } from 'clsx';
import { useColonyStore } from '../../store/colony';

const SPEEDS = [0, 1, 2, 3];
const SPEED_LABELS = ['||', '1x', '2x', '3x'];

export function ColonyControls() {
  const { simulationSpeed, setSpeed } = useColonyStore();

  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-gray-900/90 border border-gray-700 rounded px-2 py-1">
      <span className="text-[10px] font-mono text-gray-500 mr-1">SPD</span>
      {SPEEDS.map((speed, i) => (
        <button
          key={speed}
          onClick={() => setSpeed(speed)}
          className={clsx(
            'text-xs font-mono px-1.5 py-0.5 rounded',
            simulationSpeed === speed
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700',
          )}
        >
          {SPEED_LABELS[i]}
        </button>
      ))}
    </div>
  );
}
