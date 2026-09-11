"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";
import type { AppNotification } from "@/types";

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
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (authLoading) return;
    setLoading(true);
    try {
      const data = await apiFetch<{
        notifications: AppNotification[];
        unreadCount: number;
      }>("/api/notifications", { token });
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      /* keep prior list */
    } finally {
      setLoading(false);
    }
  }, [token, authLoading]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 45_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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

  const isDark = tone === "dark";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
        onClick={() => void onOpenChange(!open)}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-md transition",
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

      {open ? (
        <div
          className={cn(
            "absolute z-50 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-lg",
            isDark ? "bottom-full right-0 mb-2" : "right-0 top-full mt-2"
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

          <div className="max-h-80 overflow-y-auto">
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
      ) : null}
    </div>
  );
}
