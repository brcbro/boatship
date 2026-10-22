"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { messageMatchesContext } from "@/lib/message-context";
import type { PortalMessage } from "@/types";

type LiveEvent = { message: PortalMessage; type: "message" } | { type: "connected" };

type Options = {
  clientId: string | null | undefined;
  onMessage: (message: PortalMessage) => void;
  token: string | null | undefined;
  engagementId?: string | null;
  includeAccountWide?: boolean;
};

/**
 * Opens a short-lived, authorized socket for one client conversation. If the
 * Worker is not deployed or a connection drops, callers keep their polling
 * fallback; this hook retries without triggering route navigation.
 */
export function useMessageRealtime({ clientId, onMessage, token, engagementId, includeAccountWide = false }: Options) {
  const callbackRef = useRef(onMessage);
  const connectionKey = JSON.stringify([clientId, token, engagementId, includeAccountWide]);
  const [connectedKey, setConnectedKey] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!clientId) {
      return;
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let retryDelay = 1_000;

    const connect = async () => {
      try {
        const { ticket } = await apiFetch<{ ticket: string }>(
          `/api/messages/live-ticket?clientId=${encodeURIComponent(clientId)}`,
          { token },
        );
        if (closed) return;

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${window.location.host}/api/messages/live?ticket=${encodeURIComponent(ticket)}`);
        socket.onopen = () => {
          if (closed) return;
          retryDelay = 1_000;
          setConnectedKey(connectionKey);
        };
        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(String(event.data)) as LiveEvent;
            if (!closed && data.type === "message" && data.message.clientId === clientId && messageMatchesContext(data.message, engagementId, includeAccountWide)) callbackRef.current(data.message);
          } catch {
            // Ignore malformed frames; the API remains the source of truth.
          }
        };
        socket.onclose = () => {
          if (closed) return;
          setConnectedKey(null);
          if (!closed) scheduleRetry();
        };
        socket.onerror = () => socket?.close();
      } catch {
        if (closed) return;
        setConnectedKey(null);
        if (!closed) scheduleRetry();
      }
    };

    const scheduleRetry = () => {
      if (retryTimer !== undefined || closed) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    };

    void connect();
    return () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close(1000, "Conversation changed");
    };
  }, [clientId, token, engagementId, includeAccountWide, connectionKey]);

  return Boolean(clientId) && connectedKey === connectionKey;
}
