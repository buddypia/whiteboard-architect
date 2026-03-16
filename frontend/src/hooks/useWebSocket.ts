"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionState, ErrorMessage, ServerMessage } from "@/lib/types";
import {
  BACKPRESSURE_THRESHOLD,
  WS_RECONNECT_MAX_DELAY,
} from "@/lib/constants";

interface UseWebSocketOptions {
  url: string;
  onEvent: (event: ServerMessage) => void;
  onConnectionIssue?: (error: ErrorMessage) => void;
  onOpen?: () => void;
  autoConnect?: boolean;
}

export function useWebSocket({
  url,
  onEvent,
  onConnectionIssue,
  onOpen,
  autoConnect = false,
}: UseWebSocketOptions) {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalDisconnectRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const onConnectionIssueRef = useRef(onConnectionIssue);
  const onOpenRef = useRef(onOpen);
  const urlRef = useRef(url);
  const lastConnectionIssueRef = useRef<{ key: string; timestamp: number } | null>(null);

  useEffect(() => {
    onEventRef.current = onEvent;
    onConnectionIssueRef.current = onConnectionIssue;
    onOpenRef.current = onOpen;
    urlRef.current = url;
  }, [onConnectionIssue, onEvent, onOpen, url]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connectRef = useRef<() => void>(() => {});

  const reportConnectionIssue = useCallback((error: ErrorMessage) => {
    const key = `${error.code}:${error.message}`;
    const now = Date.now();
    const last = lastConnectionIssueRef.current;
    if (last && last.key === key && now - last.timestamp < 8000) {
      return;
    }
    lastConnectionIssueRef.current = { key, timestamp: now };
    onConnectionIssueRef.current?.(error);
  }, []);

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    intentionalDisconnectRef.current = false;
    setConnectionState("connecting");

    const ws = new WebSocket(urlRef.current);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("connected");
      reconnectDelayRef.current = 1000;
      lastConnectionIssueRef.current = null;
      onOpenRef.current?.();
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const data = JSON.parse(event.data) as ServerMessage;
        onEventRef.current(data);
      } catch {
        console.error("Failed to parse WebSocket message");
      }
    };

    ws.onerror = () => {
      console.error("WebSocket error");
    };

    ws.onclose = (event) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setConnectionState("disconnected");

      if (!intentionalDisconnectRef.current) {
        if (event.code !== 1000) {
          reportConnectionIssue({
            type: "error",
            code: event.code ? `WS_${event.code}` : "WS_CLOSED",
            message: event.reason
              ? `WebSocket 接続が切断されました (${event.code}): ${event.reason}`
              : `WebSocket 接続が切断されました (${event.code || "network"})。再接続を試みます。`,
            retryable: true,
          });
        }
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, WS_RECONNECT_MAX_DELAY);
        reconnectTimerRef.current = setTimeout(() => {
          connectRef.current();
        }, delay);
      }
    };
  }, [reportConnectionIssue]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    clearReconnectTimer();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("disconnected");
  }, [clearReconnectTimer]);

  const sendJson = useCallback((data: object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > BACKPRESSURE_THRESHOLD) {
      console.warn("WebSocket backpressure: skipping send");
      return;
    }
    ws.send(JSON.stringify(data));
  }, []);

  useEffect(() => {
    if (autoConnect) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      connect();
    }
    return () => {
      intentionalDisconnectRef.current = true;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [autoConnect, connect, clearReconnectTimer]);

  return { connectionState, sendJson, connect, disconnect };
}
