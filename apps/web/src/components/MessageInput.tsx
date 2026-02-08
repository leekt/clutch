import { useState } from 'react';
import { useCreateRun, useSendChat } from '../hooks/useQueries';

interface MessageInputProps {
  channelId?: string;
  mode?: 'task' | 'chat';
}

export function MessageInput({ channelId, mode = 'task' }: MessageInputProps) {
  if (mode === 'chat') {
    return <ChatInput channelId={channelId} />;
  }
  return <TaskInput />;
}

function ChatInput({ channelId }: { channelId?: string }) {
  const [content, setContent] = useState('');
  const sendChat = useSendChat(channelId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !channelId) return;

    try {
      await sendChat.mutateAsync(content.trim());
      setContent('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <div className="p-4 border-t border-gray-700">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        <button
          type="submit"
          disabled={!content.trim() || sendChat.isPending}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function TaskInput() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const createRun = useCreateRun();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      await createRun.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
      });

      setTitle('');
      setDescription('');
      setIsExpanded(false);
    } catch (error) {
      console.error('Failed to create run:', error);
    }
  };

  return (
    <div className="p-4 border-t border-gray-700">
      <form onSubmit={handleSubmit}>
        {!isExpanded ? (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="w-full bg-gray-800 hover:bg-gray-750 rounded-lg p-3 text-left text-gray-400"
          >
            Create a new task...
          </button>
        ) : (
          <div className="bg-gray-800 rounded-lg p-3 space-y-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              className="w-full bg-gray-700 rounded px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={3}
              className="w-full bg-gray-700 rounded px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setIsExpanded(false);
                  setTitle('');
                  setDescription('');
                }}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || createRun.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-medium"
              >
                {createRun.isPending ? 'Creating...' : 'Create Task'}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
