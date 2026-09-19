"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";
import type { AppNotification } from "@/types";

type NotificationPayload = {
  notifications: AppNotification[];
  unreadCount: number;
};

const NOTIFICATION_REFRESH_MS = 5 * 60_000;
let notificationRequest: Promise<NotificationPayload> | null = null;
let notificationRequestToken: string | null;

function requestNotifications(token: string | null) {
  if (notificationRequest && notificationRequestToken === token) {
    return notificationRequest;
  }

  notificationRequestToken = token;
  const request = apiFetch<NotificationPayload>("/api/notifications", { token });
  notificationRequest = request;
  return request.finally(() => {
    if (notificationRequest === request) notificationRequest = null;
  });
}

export function NotificationBell({
  className,
  tone = "light",
}: {
  className?: string;
  /** light = ink on surface; dark = white on brand sidebar */
  tone?: "light" | "dark";
}) {
  const { token, loading: authLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isDark = tone === "dark";

  const load = useCallback(async () => {
    if (authLoading) return;
    setLoading(true);
    try {
      const data = await requestNotifications(token);
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      /* keep prior list */
    } finally {
      setLoading(false);
    }
  }, [token, authLoading]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, NOTIFICATION_REFRESH_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (
        !rootRef.current?.contains(e.target as Node) &&
        !panelRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(352, window.innerWidth - 32);
      const left = Math.max(16, Math.min(trigger.right - width, window.innerWidth - width - 16));
      // Sidebar bells open upward; top-bar bells open downward. Reserve enough
      // room for the panel's maximum height and keep it inside the viewport.
      const top = isDark
        ? Math.max(16, trigger.top - 368)
        : Math.min(trigger.bottom + 8, window.innerHeight - 16);
      setPanelStyle({ left, top, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, isDark]);

  async function markOne(id: string) {
    try {
      await apiFetch("/api/notifications", {
        method: "PATCH",
        token,
        body: JSON.stringify({ id }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt || new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      /* ignore */
    }
  }

  async function markAll() {
    try {
      await apiFetch("/api/notifications", {
        method: "PATCH",
        token,
        body: JSON.stringify({ all: true }),
      });
      const ts = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || ts })));
      setUnreadCount(0);
    } catch {
      /* ignore */
    }
  }

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
        onClick={() => void onOpenChange(!open)}
        className={cn(
          "relative inline-flex h-11 w-11 items-center justify-center rounded-lg transition",
          isDark
            ? "text-white hover:bg-white/10"
            : "border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface-2)]"
        )}
      >
        <Bell size={18} />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open && panelStyle && typeof document !== "undefined"
        ? createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className={cn(
            "fixed z-[70] max-h-[calc(100dvh-2rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-lg"
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
            <p className="text-sm font-medium text-[var(--ink)]">Notifications</p>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="text-xs font-medium text-[var(--brand)] hover:underline"
                onClick={() => void markAll()}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto overscroll-contain">
            {loading && notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--ink-muted)]">Loading…</p>
            ) : notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--ink-muted)]">
                No notifications yet.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {notifications.slice(0, 30).map((n) => {
                  const unread = !n.readAt;
                  const inner = (
                    <>
                      <p
                        className={cn(
                          "text-sm text-[var(--ink)]",
                          unread ? "font-semibold" : "font-medium"
                        )}
                      >
                        {n.title}
                      </p>
                      {n.body ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-[var(--ink-muted)]">
                          {n.body}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                        {formatDateTime(n.createdAt)}
                      </p>
                    </>
                  );

                  return (
                    <li key={n.id} className={cn(unread && "bg-[var(--surface-2)]/60")}>
                      {n.href ? (
                        <Link
                          href={n.href}
                          className="block px-3 py-2.5 transition hover:bg-[var(--surface-2)]"
                          onClick={() => {
                            if (unread) void markOne(n.id);
                            setOpen(false);
                          }}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="block w-full px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]"
                          onClick={() => {
                            if (unread) void markOne(n.id);
                          }}
                        >
                          {inner}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        ,
        document.body
      )
        : null}
    </div>
  );
}
