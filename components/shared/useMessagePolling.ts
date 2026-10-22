"use client";

import { useEffect, useRef } from "react";

const MESSAGE_REFRESH_INTERVAL = 15_000;

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
