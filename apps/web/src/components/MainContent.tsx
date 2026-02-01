export function MainContent() {
  return (
    <main className="flex-1 flex flex-col">
      <header className="h-14 px-4 flex items-center border-b border-gray-700">
        <h2 className="text-lg font-semibold"># general</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          <MessageCard
            type="PLAN"
            sender="PM"
            summary="Project kickoff plan"
            body="We will start by researching the market, then create marketing copy, and finally implement the landing page."
            timestamp="10:30 AM"
          />
          <MessageCard
            type="PROPOSAL"
            sender="Research"
            summary="Market research findings"
            body="Based on initial research, the target market shows strong demand for AI orchestration tools. Key competitors include..."
            timestamp="11:45 AM"
            artifacts={[{ path: 'research/market-analysis.md', hash: 'abc123' }]}
          />
        </div>
      </div>

      <div className="p-4 border-t border-gray-700">
        <div className="bg-gray-800 rounded-lg p-3">
          <p className="text-gray-400 text-sm">
            Agent messages will appear here. Tasks can be created from the sidebar.
          </p>
        </div>
      </div>
    </main>
  );
}

interface MessageCardProps {
  type: 'PLAN' | 'PROPOSAL' | 'EXEC_REPORT' | 'REVIEW' | 'BLOCKER';
  sender: string;
  summary: string;
  body: string;
  timestamp: string;
  artifacts?: Array<{ path: string; hash: string }>;
}

const typeColors: Record<string, string> = {
  PLAN: 'bg-blue-600',
  PROPOSAL: 'bg-purple-600',
  EXEC_REPORT: 'bg-green-600',
  REVIEW: 'bg-yellow-600',
  BLOCKER: 'bg-red-600',
};

function MessageCard({ type, sender, summary, body, timestamp, artifacts }: MessageCardProps) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-medium">{sender[0]}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold">{sender}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${typeColors[type]}`}>{type}</span>
            <span className="text-xs text-gray-400">{timestamp}</span>
          </div>
          <h3 className="font-medium mb-2">{summary}</h3>
          <p className="text-gray-300 text-sm">{body}</p>
          {artifacts && artifacts.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Artifacts:</p>
              <ul className="space-y-1">
                {artifacts.map((artifact) => (
                  <li key={artifact.path} className="text-sm text-blue-400">
                    {artifact.path}
                    <span className="text-gray-500 ml-2">({artifact.hash.slice(0, 7)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
