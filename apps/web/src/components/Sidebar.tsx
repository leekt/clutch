import { clsx } from 'clsx';

const channels = [
  { id: 'general', name: 'general', type: 'department' },
  { id: 'research', name: 'research', type: 'department' },
  { id: 'dev', name: 'dev', type: 'department' },
];

export function Sidebar() {
  return (
    <aside className="w-64 bg-sidebar flex flex-col border-r border-gray-700">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">Clutch</h1>
        <p className="text-sm text-gray-400">AI Agent Organization</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <div className="mb-4">
          <h2 className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase">
            Channels
          </h2>
          <ul className="space-y-0.5">
            {channels.map((channel) => (
              <li key={channel.id}>
                <button
                  className={clsx(
                    'w-full px-2 py-1 text-left rounded hover:bg-sidebar-hover',
                    'flex items-center gap-2 text-gray-300'
                  )}
                >
                  <span className="text-gray-500">#</span>
                  {channel.name}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mb-4">
          <h2 className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase">
            Agents
          </h2>
          <ul className="space-y-0.5">
            <li>
              <button className="w-full px-2 py-1 text-left rounded hover:bg-sidebar-hover flex items-center gap-2 text-gray-300">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                PM
              </button>
            </li>
            <li>
              <button className="w-full px-2 py-1 text-left rounded hover:bg-sidebar-hover flex items-center gap-2 text-gray-300">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Research
              </button>
            </li>
            <li>
              <button className="w-full px-2 py-1 text-left rounded hover:bg-sidebar-hover flex items-center gap-2 text-gray-300">
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                Developer
              </button>
            </li>
            <li>
              <button className="w-full px-2 py-1 text-left rounded hover:bg-sidebar-hover flex items-center gap-2 text-gray-300">
                <span className="w-2 h-2 rounded-full bg-gray-500" />
                Marketing
              </button>
            </li>
          </ul>
        </div>
      </nav>

      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center">
            <span className="text-sm font-medium">O</span>
          </div>
          <div>
            <p className="text-sm font-medium">Organization</p>
            <p className="text-xs text-gray-400">4 agents active</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
