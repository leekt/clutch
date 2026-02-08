import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ChannelView } from './components/ChannelView';
import { TasksView } from './components/TasksView';
import { AgentsView } from './components/AgentsView';
import { ColonyView } from './components/colony/ColonyView';
import { TaskDetailPanel } from './components/TaskDetailPanel';
import { useStore, selectAgentsList } from './store';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 2,
    },
  },
});

function DefaultRoute() {
  const agents = useStore(selectAgentsList);
  // If no agents exist, send to /agents for onboarding; otherwise go to general channel
  if (agents.length === 0) {
    return <Navigate to="/agents" replace />;
  }
  return <Navigate to="/channels/general" replace />;
}

function AppContent() {
  const { rightPanelOpen, rightPanelView, selectedTaskId } = useStore();

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      <Layout>
        <Routes>
          <Route path="/" element={<DefaultRoute />} />
          <Route path="/channels/:channelId" element={<ChannelView />} />
          <Route path="/tasks" element={<TasksView />} />
          <Route path="/tasks/:taskId" element={<TasksView />} />
          <Route path="/agents" element={<AgentsView />} />
          <Route path="/agents/:agentId" element={<AgentsView />} />
          <Route path="/colony" element={<ColonyView />} />
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
