import { useParams } from 'react-router-dom';
import { useMessages, useChannel } from '../hooks/useQueries';
import { MessageCard } from './MessageCard';
import { MessageInput } from './MessageInput';

export function ChannelView() {
  const { channelId } = useParams<{ channelId: string }>();

  const { data: channel, isLoading: channelLoading } = useChannel(channelId);
  const { data: messages, isLoading: messagesLoading } = useMessages(channelId);

  if (channelLoading || messagesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400">Loading channel...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xl">#</span>
          <h2 className="text-lg font-semibold">{channel?.name || channelId}</h2>
          {channel?.description && (
            <span className="text-sm text-gray-400 ml-2">
              {channel.description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">
            {messages?.length || 0} messages
          </span>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {!messages || messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p className="text-lg mb-2">No messages yet</p>
            <p className="text-sm">
              Messages from agents will appear here as they work on tasks.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageCard key={message.messageId} message={message} />
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <MessageInput channelId={channelId} />
    </div>
  );
}
