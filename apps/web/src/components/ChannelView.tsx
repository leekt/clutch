import { useParams } from 'react-router-dom';
import { useMessages, useChannel } from '../hooks/useQueries';
import { MessageCard } from './MessageCard';
import { MessageInput } from './MessageInput';

function extractDMAgentName(channelName: string): string {
  // Format: dm:user:agent:{name}
  const match = channelName.match(/^dm:user:agent:(.+)$/);
  return match ? match[1]! : channelName;
}

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

  const isDM = channel?.type === 'dm';
  const displayName = isDM
    ? extractDMAgentName(channel?.name || '')
    : channel?.name || channelId;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          {isDM ? (
            <span className="text-gray-400 text-sm">DM</span>
          ) : (
            <span className="text-gray-500 text-xl">#</span>
          )}
          <h2 className="text-lg font-semibold">{displayName}</h2>
          {channel?.description && !isDM && (
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
            {isDM ? (
              <>
                <p className="text-lg mb-2">Start a conversation</p>
                <p className="text-sm">
                  Send a message to {displayName}.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg mb-2">No messages yet</p>
                <p className="text-sm">
                  Messages from agents will appear here as they work on tasks.
                </p>
              </>
            )}
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
      <MessageInput channelId={channelId} mode={isDM ? 'chat' : 'task'} />
    </div>
  );
}
