"use client";

import { useEffect, useRef } from "react";

/**
 * Fallback cadence while the realtime room is not connected. Each poll loads
 * the thread through the store, so this stays slow; the room delivers new
 * messages immediately when it is available, and focus still refreshes.
 */
const MESSAGE_REFRESH_INTERVAL = 60_000;

/** Keeps an active message thread fresh without reloading the route. */
export function useMessagePolling(refresh: () => Promise<void>, enabled: boolean, contextKey = "") {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    let refreshing = false;

    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible" || refreshing) return;

      refreshing = true;
      void refreshRef.current().finally(() => {
        refreshing = false;
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshWhenVisible();
    };

    const interval = window.setInterval(refreshWhenVisible, MESSAGE_REFRESH_INTERVAL);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, contextKey]);
}
