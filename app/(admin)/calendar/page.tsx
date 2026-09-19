"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
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
import { CalendarPlus, ExternalLink, Link2, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Textarea,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { cn, formatDate, statusLabel } from "@/lib/utils";

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  source: "task" | "google";
  status: string;
  clientId: string | null;
  clientName: string | null;
  taskId: string | null;
  htmlLink: string | null;
  location: string | null;
};

type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  error: string | null;
};

const EMPTY_GOOGLE_STATUS: GoogleStatus = {
  configured: false,
  connected: false,
  error: null,
};

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "completed") return "success";
  if (status === "in_progress" || status === "scheduled") return "info";
  if (status === "blocked") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

function eventDayKey(event: CalendarEvent) {
  try {
    return format(parseISO(event.start), "yyyy-MM-dd");
  } catch {
    return null;
  }
}

function eventTime(event: CalendarEvent) {
  if (event.allDay) return "All day";
  try {
    return format(parseISO(event.start), "h:mm a");
  } catch {
    return "Scheduled";
  }
}

export default function CalendarPage() {
  const { token } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [google, setGoogle] = useState<GoogleStatus>(EMPTY_GOOGLE_STATUS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date>(() => new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:30");
  const [attendees, setAttendees] = useState("");
  const [description, setDescription] = useState("");
  const [createMeetingRoom, setCreateMeetingRoom] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const rangeStart = startOfWeek(startOfMonth(cursor));
    const rangeEnd = addDays(endOfWeek(endOfMonth(cursor)), 1);
    try {
      const params = new URLSearchParams({
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
      });
      const data = await apiFetch<{ events: CalendarEvent[]; google: GoogleStatus }>(
        `/api/calendar?${params.toString()}`,
        { token },
      );
      setEvents(data.events || []);
      setGoogle(data.google || EMPTY_GOOGLE_STATUS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [cursor, token]);

  useEffect(() => {
    // The calendar depends on the signed-in user's browser-held auth token.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    const end = endOfWeek(endOfMonth(cursor));
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const dayKey = eventDayKey(event);
      if (!dayKey) continue;
      const list = map.get(dayKey) || [];
      list.push(event);
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
      .filter((event) => {
        try {
          const date = parseISO(event.start);
          return date >= start && date <= end;
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [events, cursor]);

  function moveMonth(next: Date) {
    const month = startOfMonth(next);
    setCursor(month);
    setSelected(month);
  }

  function openCreateForm() {
    setEventDate(format(selected, "yyyy-MM-dd"));
    setShowCreate(true);
    setMessage("");
    setError("");
  }

  async function connectGoogle() {
    setConnecting(true);
    setError("");
    try {
      const response = await apiFetch<{ redirectUrl: string }>("/api/integrations", {
        method: "POST",
        token,
        body: JSON.stringify({ toolkit: "googlecalendar" }),
      });
      if (!response.redirectUrl) throw new Error("Google did not return a connection URL");
      window.location.href = response.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google Calendar connection");
      setConnecting(false);
    }
  }

  async function createGoogleEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!title.trim()) {
      setError("Enter an event title.");
      return;
    }
    if (!eventDate || !startTime || !endTime || endTime <= startTime) {
      setError("Choose an end time after the start time.");
      return;
    }

    setCreating(true);
    try {
      await apiFetch("/api/calendar", {
        method: "POST",
        token,
        body: JSON.stringify({
          title: title.trim(),
          start: `${eventDate}T${startTime}:00`,
          end: `${eventDate}T${endTime}:00`,
          description: description.trim(),
          attendeeEmails: attendees.split(",").map((email) => email.trim()).filter(Boolean),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
          createMeetingRoom,
        }),
      });
      setMessage("Event created in Google Calendar.");
      setShowCreate(false);
      setTitle("");
      setAttendees("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the Google event");
    } finally {
      setCreating(false);
    }
  }

  if (loading && events.length === 0) {
    return <p className="text-sm text-[var(--ink-muted)]" aria-live="polite">Loading calendar…</p>;
  }

  if (error && events.length === 0) {
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
        description="Google Calendar events and Boatship task deadlines in one view."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {google.connected ? (
              <Button type="button" size="sm" onClick={openCreateForm}>
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                New event
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="sm" onClick={() => moveMonth(subMonths(cursor, 1))}>
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
            <Button type="button" variant="secondary" size="sm" onClick={() => moveMonth(addMonths(cursor, 1))}>
              Next
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-2 text-[var(--ink)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand)]" aria-hidden="true" />
            Google events
          </span>
          <span className="inline-flex items-center gap-2 text-[var(--ink)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--warning)]" aria-hidden="true" />
            Task deadlines
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={google.connected && !google.error ? "success" : "warning"}>
            {google.connected && !google.error ? "Google connected" : "Google needs attention"}
          </Badge>
          <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {!google.connected ? (
        <Card className="flex flex-col gap-4 border-[var(--warning)]/30 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-medium text-[var(--ink)]">Connect Google Calendar</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Authorize your primary calendar to view and create events from Boatship.
            </p>
          </div>
          <Button type="button" disabled={connecting || !google.configured} onClick={() => void connectGoogle()}>
            <Link2 className="h-4 w-4" aria-hidden="true" />
            {connecting ? "Opening Google…" : "Connect Google Calendar"}
          </Button>
        </Card>
      ) : null}

      {google.error ? (
        <p role="alert" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-4 py-3 text-sm text-[var(--ink)]">
          Google Calendar did not refresh: {google.error} Task deadlines are still available below.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/5 px-4 py-3 text-sm text-[var(--ink)]">
          {message}
        </p>
      ) : null}

      {showCreate && google.connected ? (
        <Card className="space-y-4">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">New Google event</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Creates the event in your connected primary calendar.</p>
          </div>
          <form className="space-y-4" onSubmit={(event) => void createGoogleEvent(event)} aria-busy={creating}>
            <div>
              <Label htmlFor="calendar-event-title">Title</Label>
              <Input id="calendar-event-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required autoFocus />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="calendar-event-date">Date</Label>
                <Input id="calendar-event-date" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} required />
              </div>
              <div>
                <Label htmlFor="calendar-event-start">Starts</Label>
                <Input id="calendar-event-start" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
              </div>
              <div>
                <Label htmlFor="calendar-event-end">Ends</Label>
                <Input id="calendar-event-end" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="calendar-event-attendees">Attendees <span className="font-normal text-[var(--ink-muted)]">(optional)</span></Label>
              <Input id="calendar-event-attendees" value={attendees} onChange={(event) => setAttendees(event.target.value)} placeholder="name@example.com, teammate@example.com" inputMode="email" />
              <p className="mt-1 text-xs text-[var(--ink-muted)]">Separate multiple email addresses with commas. Google will email invitations.</p>
            </div>
            <div>
              <Label htmlFor="calendar-event-description">Description <span className="font-normal text-[var(--ink-muted)]">(optional)</span></Label>
              <Textarea id="calendar-event-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[var(--ink)]">
              <input type="checkbox" checked={createMeetingRoom} onChange={(event) => setCreateMeetingRoom(event.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
              Add a Google Meet link
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" disabled={creating} onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={creating}>{creating ? "Creating…" : "Create in Google Calendar"}</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
              {format(cursor, "MMMM yyyy")}
            </h2>
            {loading ? <span className="text-xs text-[var(--ink-muted)]">Refreshing…</span> : null}
          </div>
          <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--surface-2)]/50 text-center text-xs font-medium text-[var(--ink-muted)]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="px-1 py-2">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayEvents = eventsByDay.get(key) || [];
              const googleCount = dayEvents.filter((event) => event.source === "google").length;
              const taskCount = dayEvents.length - googleCount;
              const inMonth = isSameMonth(day, cursor);
              const active = isSameDay(day, selected);
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`${format(day, "EEEE, MMMM d")}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ""}`}
                  aria-pressed={active}
                  onClick={() => {
                    setSelected(day);
                    if (!inMonth) setCursor(startOfMonth(day));
                  }}
                  className={cn(
                    "min-h-[82px] cursor-pointer border-b border-r border-[var(--border)] p-1.5 text-left transition hover:bg-[var(--surface-2)]/60 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]",
                    !inMonth && "bg-[var(--surface)]/40 text-[var(--ink-muted)]",
                    active && "bg-[var(--brand)]/8 ring-1 ring-inset ring-[var(--brand)]/30",
                  )}
                >
                  <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full text-xs", isToday(day) ? "bg-[var(--brand)] font-semibold text-white" : "text-[var(--ink)]")}>
                    {format(day, "d")}
                  </span>
                  {dayEvents.length ? (
                    <span className="mt-1 block space-y-0.5 text-[10px] leading-tight">
                      {googleCount ? <span className="block truncate text-[var(--brand)]">{googleCount} Google</span> : null}
                      {taskCount ? <span className="block truncate text-[var(--ink-muted)]">{taskCount} task{taskCount === 1 ? "" : "s"}</span> : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-[family-name:var(--font-display)] text-base">{format(selected, "EEE, MMM d")}</h3>
              {google.connected ? <Button type="button" variant="ghost" size="sm" onClick={openCreateForm}>Add event</Button> : null}
            </div>
            {selectedEvents.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">No events or task deadlines this day.</p>
            ) : (
              <ul className="space-y-3">
                {selectedEvents.map((event) => (
                  <li key={event.id} className="border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-[var(--ink)]">{event.title}</p>
                        <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{eventTime(event)}{event.location ? ` · ${event.location}` : ""}</p>
                        {event.source === "task" && event.clientId ? (
                          <Link href={`/clients/${event.clientId}`} className="text-xs text-[var(--brand)] hover:underline">{event.clientName}</Link>
                        ) : event.htmlLink ? (
                          <a href={event.htmlLink} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--brand)] hover:underline">
                            Open in Google Calendar <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={event.source === "google" ? "info" : "neutral"}>{event.source === "google" ? "Google" : "Task"}</Badge>
                        {event.source === "task" ? <Badge tone={statusTone(event.status)}>{statusLabel(event.status)}</Badge> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 font-[family-name:var(--font-display)] text-base">{format(cursor, "MMMM")} agenda</h3>
            {monthList.length === 0 ? (
              <p className="text-sm text-[var(--ink-muted)]">No events this month.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {monthList.map((event) => (
                  <li key={event.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" title={event.title}>{event.title}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {formatDate(event.start)} · {eventTime(event)}
                        {event.source === "task" && event.clientId ? (
                          <> · <Link href={`/clients/${event.clientId}`} className="text-[var(--brand)] hover:underline">{event.clientName}</Link></>
                        ) : null}
                      </p>
                    </div>
                    <Badge tone={event.source === "google" ? "info" : "neutral"}>{event.source === "google" ? "Google" : "Task"}</Badge>
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
