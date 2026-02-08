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
    reconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Use refs for callbacks to avoid re-triggering the effect
  const onMessageRef = useRef(options.onMessage);
  const onConnectRef = useRef(options.onConnect);
  const onDisconnectRef = useRef(options.onDisconnect);
  const onErrorRef = useRef(options.onError);

  onMessageRef.current = options.onMessage;
  onConnectRef.current = options.onConnect;
  onDisconnectRef.current = options.onDisconnect;
  onErrorRef.current = options.onError;

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [lastMessage, setLastMessage] = useState<WSEvent | null>(null);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setConnectionState('connecting');

    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setConnectionState('connected');
        reconnectAttempts.current = 0;
        onConnectRef.current?.();
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnectionState('disconnected');
        onDisconnectRef.current?.();

        // Attempt reconnect
        if (reconnect && reconnectAttempts.current < maxReconnectAttempts && mountedRef.current) {
          reconnectAttempts.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        if (!mountedRef.current) return;
        setConnectionState('error');
        onErrorRef.current?.(error);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        const handle = async () => {
          try {
            const raw = event.data instanceof Blob
              ? await event.data.text()
              : typeof event.data === 'string'
                ? event.data
                : event.data instanceof ArrayBuffer
                  ? new TextDecoder().decode(event.data)
                  : String(event.data);
            const data = JSON.parse(raw) as WSEvent;
            setLastMessage(data);
            onMessageRef.current?.(data);
          } catch {
            console.error('Failed to parse WebSocket message:', event.data);
          }
        };
        void handle();
      };

      wsRef.current = ws;
    } catch (error) {
      setConnectionState('error');
      console.error('Failed to create WebSocket connection:', error);
    }
  }, [reconnect, reconnectInterval, maxReconnectAttempts]);

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

  // Auto-connect on mount, disconnect on unmount
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
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
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const { subscribe, unsubscribe, lastMessage, isConnected } = useWebSocket({
    onMessage: (event) => {
      if (event.type === 'task_update' && event.taskId === taskId) {
        onUpdateRef.current(event.data || {});
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
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const { subscribe, unsubscribe, lastMessage, isConnected } = useWebSocket({
    onMessage: (event) => {
      if (event.type === 'message_update') {
        onUpdateRef.current(event.data || {});
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
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const { subscribe, unsubscribe, lastMessage, isConnected } = useWebSocket({
    onMessage: (event) => {
      if (event.type === 'agent_status' && event.agentId === agentId) {
        onUpdateRef.current(event.status, event.details);
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
