import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ChannelView } from './components/ChannelView';
import { TasksView } from './components/TasksView';
import { AgentsView } from './components/AgentsView';
import { TaskDetailPanel } from './components/TaskDetailPanel';
import { useStore } from './store';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 2,
    },
  },
});

function AppContent() {
  const { rightPanelOpen, rightPanelView, selectedTaskId } = useStore();

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/channels/general" replace />} />
          <Route path="/channels/:channelId" element={<ChannelView />} />
          <Route path="/tasks" element={<TasksView />} />
          <Route path="/tasks/:taskId" element={<TasksView />} />
          <Route path="/agents" element={<AgentsView />} />
          <Route path="/agents/:agentId" element={<AgentsView />} />
        </Routes>
      </Layout>

      {/* Right panel for details */}
      {rightPanelOpen && rightPanelView === 'task-details' && selectedTaskId && (
        <TaskDetailPanel taskId={selectedTaskId} />
      )}
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
