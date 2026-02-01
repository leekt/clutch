import { Sidebar } from './components/Sidebar';
import { MainContent } from './components/MainContent';

export function App() {
  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      <Sidebar />
      <MainContent />
    </div>
  );
}
