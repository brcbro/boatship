"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Button, Textarea } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";
import type { TaskComment } from "@/types";

type MentionUser = { uid: string; name: string };

type TaskCommentsProps = {
  taskId: string;
  users?: MentionUser[];
  className?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve @Name mentions (longest names first so "Jane Doe" beats "Jane"). */
export function parseMentionUserIds(text: string, users: MentionUser[]): string[] {
  if (!text || !users.length) return [];
  const sorted = [...users]
    .filter((u) => u.name?.trim())
    .sort((a, b) => b.name.trim().length - a.name.trim().length);
  const ids = new Set<string>();
  for (const user of sorted) {
    const name = user.name.trim();
    const re = new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=\\s|$|[.,!?;:])`, "i");
    if (re.test(text)) ids.add(user.uid);
  }
  return Array.from(ids);
}

export function TaskComments({
  taskId,
  users = [],
  className,
  defaultOpen = true,
  collapsible = true,
}: TaskCommentsProps) {
  const { token } = useAuth();
  const [open, setOpen] = useState(defaultOpen);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>(users);

  useEffect(() => {
    setMentionUsers(users);
  }, [users]);

  useEffect(() => {
    if (users.length || !token) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiFetch<{ users: MentionUser[] }>("/api/users", { token });
        if (!cancelled) setMentionUsers(data.users || []);
      } catch {
        // Clients cannot list users; mentions still work if parent passes users.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [users.length, token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ comments: TaskComment[] }>(
        `/api/tasks/${encodeURIComponent(taskId)}/comments`,
        { token }
      );
      setComments(data.comments);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [taskId, token]);

  useEffect(() => {
    setLoaded(false);
    setComments([]);
    setBody("");
    setError("");
    if (!collapsible || open) void load();
  }, [taskId, collapsible, open, load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const mentionUserIds = parseMentionUserIds(text, mentionUsers);
      const data = await apiFetch<{ comment: TaskComment }>(
        `/api/tasks/${encodeURIComponent(taskId)}/comments`,
        {
          method: "POST",
          token,
          body: JSON.stringify({ body: text, mentionUserIds }),
        }
      );
      setComments((prev) => [...prev, data.comment]);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("rounded-md border border-[var(--border)]", className)}>
      {collapsible ? (
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--surface-2)]/60"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
            <MessageSquare className="h-4 w-4 text-[var(--ink-muted)]" />
            Comments
            {loaded ? (
              <span className="rounded bg-[var(--surface-2)] px-1.5 py-px text-[10px] text-[var(--ink-muted)]">
                {comments.length}
              </span>
            ) : null}
          </span>
          <span className="text-xs text-[var(--ink-muted)]">{open ? "Hide" : "Show"}</span>
        </button>
      ) : (
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <MessageSquare className="h-4 w-4 text-[var(--ink-muted)]" />
          <span className="text-sm font-medium text-[var(--ink)]">Comments</span>
        </div>
      )}

      {(!collapsible || open) && (
        <div className={cn("space-y-3 px-3 pb-3", collapsible && "border-t border-[var(--border)] pt-3")}>
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
              {error}
            </p>
          ) : null}

          {loading && !loaded ? (
            <p className="text-sm text-[var(--ink-muted)]">Loading comments…</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">No comments yet.</p>
          ) : (
            <ul className="max-h-56 space-y-2.5 overflow-y-auto overscroll-contain">
              {comments.map((c) => (
                <li key={c.id} className="rounded-md bg-[var(--surface-2)]/70 px-2.5 py-2">
                  <div className="mb-0.5 flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--ink)]">{c.authorName}</span>
                    <span className="shrink-0 text-[10px] text-[var(--ink-muted)]">
                      {formatDateTime(c.createdAt)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-[var(--ink)]">{c.body}</p>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleSubmit} className="space-y-2">
            <Textarea
              rows={2}
              placeholder={
                mentionUsers.length
                  ? "Write a comment… Use @Name to mention"
                  : "Write a comment…"
              }
              value={body}
              disabled={busy}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={busy || !body.trim()}>
                <Send className="h-3.5 w-3.5" />
                Post
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
