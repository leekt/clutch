import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSEvent } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseWebSocketOptions {
  onMessage?: (event: WSEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [lastMessage, setLastMessage] = useState<WSEvent | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionState('connecting');

    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setConnectionState('connected');
        reconnectAttempts.current = 0;
        onConnect?.();
      };

      ws.onclose = () => {
        setConnectionState('disconnected');
        onDisconnect?.();

        // Attempt reconnect
        if (reconnect && reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        setConnectionState('error');
        onError?.(error);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSEvent;
          setLastMessage(data);
          onMessage?.(data);
        } catch {
          console.error('Failed to parse WebSocket message:', event.data);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      setConnectionState('error');
      console.error('Failed to create WebSocket connection:', error);
    }
  }, [onMessage, onConnect, onDisconnect, onError, reconnect, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttempts.current = maxReconnectAttempts; // Prevent reconnect

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [maxReconnectAttempts]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket is not connected');
    }
  }, []);

  // Subscribe to specific channels
  const subscribe = useCallback((channels: string[]) => {
    send({ type: 'subscribe', channels });
  }, [send]);

  const unsubscribe = useCallback((channels: string[]) => {
    send({ type: 'unsubscribe', channels });
  }, [send]);

  // Auto-connect on mount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    connectionState,
    lastMessage,
    connect,
    disconnect,
    send,
    subscribe,
    unsubscribe,
    isConnected: connectionState === 'connected',
  };
}

// Hook for subscribing to specific task updates
export function useTaskUpdates(
  taskId: string | undefined,
  onUpdate: (data: Record<string, unknown>) => void
) {
  const { subscribe, unsubscribe, lastMessage, isConnected } = useWebSocket({
    onMessage: (event) => {
      if (event.type === 'task_update' && event.taskId === taskId) {
        onUpdate(event.data || {});
      }
    },
  });

  useEffect(() => {
    if (isConnected && taskId) {
      subscribe([`task:${taskId}`]);
      return () => unsubscribe([`task:${taskId}`]);
    }
  }, [isConnected, taskId, subscribe, unsubscribe]);

  return { lastMessage, isConnected };
}

// Hook for subscribing to message updates
export function useMessageUpdates(
  runId: string | undefined,
  onUpdate: (data: Record<string, unknown>) => void
) {
  const { subscribe, unsubscribe, lastMessage, isConnected } = useWebSocket({
    onMessage: (event) => {
      if (event.type === 'message_update') {
        onUpdate(event.data || {});
      }
    },
  });

  useEffect(() => {
    if (isConnected && runId) {
      subscribe([`run:${runId}`]);
      return () => unsubscribe([`run:${runId}`]);
    }
  }, [isConnected, runId, subscribe, unsubscribe]);

  return { lastMessage, isConnected };
}

// Hook for subscribing to agent status updates
export function useAgentStatus(
  agentId: string | undefined,
  onUpdate: (status: string, details?: Record<string, unknown>) => void
) {
  const { subscribe, unsubscribe, lastMessage, isConnected } = useWebSocket({
    onMessage: (event) => {
      if (event.type === 'agent_status' && event.agentId === agentId) {
        onUpdate(event.status, event.details);
      }
    },
  });

  useEffect(() => {
    if (isConnected && agentId) {
      subscribe([`agent:${agentId}`]);
      return () => unsubscribe([`agent:${agentId}`]);
    }
  }, [isConnected, agentId, subscribe, unsubscribe]);

  return { lastMessage, isConnected };
}
