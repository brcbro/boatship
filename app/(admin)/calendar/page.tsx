"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { cn, formatDate, statusLabel } from "@/lib/utils";

type CalendarEvent = {
  taskId: string;
  title: string;
  clientId: string;
  clientName: string;
  status: string;
  dueDate: string;
  type: string;
  assignedRole: string;
};

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "blocked") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

export default function CalendarPage() {
  const { token } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date>(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ events: CalendarEvent[] }>("/api/calendar", { token });
      setEvents(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    const end = endOfWeek(endOfMonth(cursor));
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      let dayKey: string;
      try {
        dayKey = format(parseISO(ev.dueDate), "yyyy-MM-dd");
      } catch {
        continue;
      }
      const list = map.get(dayKey) || [];
      list.push(ev);
      map.set(dayKey, list);
    }
    return map;
  }, [events]);

  const selectedKey = format(selected, "yyyy-MM-dd");
  const selectedEvents = eventsByDay.get(selectedKey) || [];

  const monthList = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);
    return events
      .filter((ev) => {
        try {
          const d = parseISO(ev.dueDate);
          return d >= start && d <= end;
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [events, cursor]);

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading calendar…</p>;
  }

  if (error) {
    return (
      <EmptyState
        title="Couldn’t load calendar"
        description={error}
        action={
          <Button type="button" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Due dates across all client onboarding tasks."
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setCursor(subMonths(cursor, 1))}>
              Prev
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                const today = new Date();
                setCursor(startOfMonth(today));
                setSelected(today);
              }}
            >
              Today
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setCursor(addMonths(cursor, 1))}>
              Next
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
              {format(cursor, "MMMM yyyy")}
            </h2>
          </div>
          <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--surface-2)]/50 text-center text-xs font-medium text-[var(--ink-muted)]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="px-1 py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayEvents = eventsByDay.get(key) || [];
              const inMonth = isSameMonth(day, cursor);
              const active = isSameDay(day, selected);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(day)}
                  className={cn(
                    "min-h-[72px] border-b border-r border-[var(--border)] p-1.5 text-left transition hover:bg-[var(--surface-2)]/60",
                    !inMonth && "bg-[var(--surface)]/40 text-[var(--ink-muted)]",
                    active && "bg-[var(--brand)]/8 ring-1 ring-inset ring-[var(--brand)]/30"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                      isToday(day) && "bg-[var(--brand)] font-semibold text-white",
                      !isToday(day) && "text-[var(--ink)]"
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  {dayEvents.length > 0 ? (
                    <span className="mt-1 block truncate text-[10px] text-[var(--ink-muted)]">
                      {dayEvents.length} due
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-3 font-[family-name:var(--font-display)] text-base">
              {format(selected, "EEE, MMM d")}
            </h3>
            {selectedEvents.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">No tasks due this day.</p>
            ) : (
              <ul className="space-y-3">
                {selectedEvents.map((ev) => (
                  <li key={ev.taskId} className="border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--ink)]">{ev.title}</p>
                        <Link
                          href={`/clients/${ev.clientId}`}
                          className="text-xs text-[var(--brand)] hover:underline"
                        >
                          {ev.clientName}
                        </Link>
                      </div>
                      <Badge tone={statusTone(ev.status)}>{statusLabel(ev.status)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 font-[family-name:var(--font-display)] text-base">
              {format(cursor, "MMMM")} list
            </h3>
            {monthList.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">No due dates this month.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {monthList.map((ev) => (
                  <li key={ev.taskId} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{ev.title}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {formatDate(ev.dueDate)} ·{" "}
                        <Link href={`/clients/${ev.clientId}`} className="text-[var(--brand)] hover:underline">
                          {ev.clientName}
                        </Link>
                      </p>
                    </div>
                    <Badge tone={statusTone(ev.status)}>{statusLabel(ev.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
