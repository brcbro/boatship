import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import {
  executeTool,
  isComposioConfiguredForUser,
  listBoatshipConnections,
} from "@/lib/composio";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

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

type GoogleEventRecord = {
  id?: unknown;
  status?: unknown;
  summary?: unknown;
  htmlLink?: unknown;
  location?: unknown;
  start?: { date?: unknown; dateTime?: unknown };
  end?: { date?: unknown; dateTime?: unknown };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function googleItems(result: unknown): GoogleEventRecord[] {
  const root = record(result);
  const data = record(root?.data);
  const responseData = record(root?.response_data) || record(data?.response_data);
  const candidates = [data?.items, responseData?.items, root?.items];
  const items = candidates.find(Array.isArray);
  return Array.isArray(items) ? (items as GoogleEventRecord[]) : [];
}

function googleFailure(result: unknown) {
  const resultRecord = record(result);
  if (resultRecord?.successful !== false) return null;
  return typeof resultRecord.error === "string" && resultRecord.error.trim()
    ? resultRecord.error
    : "Google Calendar could not be reached. Reconnect it and try again.";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseGoogleEvent(item: GoogleEventRecord): CalendarEvent | null {
  if (item.status === "cancelled") return null;
  const id = stringValue(item.id);
  const startDateTime = stringValue(item.start?.dateTime);
  const startDate = stringValue(item.start?.date);
  const start = startDateTime || startDate;
  if (!id || !start) return null;

  return {
    id: `google:${id}`,
    title: stringValue(item.summary) || "Untitled Google event",
    start,
    end: stringValue(item.end?.dateTime) || stringValue(item.end?.date),
    allDay: !startDateTime,
    source: "google",
    status: "scheduled",
    clientId: null,
    clientName: null,
    taskId: null,
    htmlLink: stringValue(item.htmlLink),
    location: stringValue(item.location),
  };
}

function validRange(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

async function googleConnectionStatus(userId: string) {
  if (!(await isComposioConfiguredForUser(userId))) {
    return { configured: false, connected: false };
  }
  const connections = await listBoatshipConnections(userId);
  return {
    configured: true,
    connected: connections.some(
      (connection) => connection.slug === "googlecalendar" && connection.connected,
    ),
  };
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const url = new URL(req.url);
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const from = validRange(url.searchParams.get("from"), defaultFrom);
    const to = validRange(url.searchParams.get("to"), defaultTo);
    if (to <= from || to.getTime() - from.getTime() > 370 * 24 * 60 * 60 * 1000) {
      throw jsonError("Calendar range must be between 1 and 370 days", 400);
    }

    const store = await getStore();
    const [clients, tasks] = await Promise.all([store.listClients(), store.listAllTasks()]);
    const clientMap = new Map(clients.map((client) => [client.id, client]));
    const events: CalendarEvent[] = tasks.flatMap((task) => {
      if (!task.dueDate || !clientMap.has(task.clientId)) return [];
      const dueAt = new Date(task.dueDate);
      if (Number.isNaN(dueAt.getTime()) || dueAt < from || dueAt >= to) return [];
      const client = clientMap.get(task.clientId)!;
      return [{
        id: `task:${task.id}`,
        title: task.title,
        start: task.dueDate,
        end: null,
        allDay: true,
        source: "task" as const,
        status: task.status,
        clientId: client.id,
        clientName: client.name,
        taskId: task.id,
        htmlLink: null,
        location: null,
      }];
    });

    let google = { configured: false, connected: false, error: null as string | null };
    try {
      const status = await googleConnectionStatus(session.uid);
      google = { ...status, error: null };
      if (status.connected) {
        const result = await executeTool({
          boatshipUid: session.uid,
          toolSlug: "GOOGLECALENDAR_EVENTS_LIST",
          arguments: {
            calendarId: "primary",
            timeMin: from.toISOString(),
            timeMax: to.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 250,
            fields: "items(id,status,summary,start,end,htmlLink,location),nextPageToken",
          },
        });
        const failure = googleFailure(result);
        if (failure) {
          google.error = failure;
        } else {
          events.push(
            ...googleItems(result)
              .map(parseGoogleEvent)
              .filter((event): event is CalendarEvent => Boolean(event)),
          );
        }
      }
    } catch (error) {
      google.error = error instanceof Error ? error.message : "Google Calendar could not be loaded";
    }

    events.sort((a, b) => a.start.localeCompare(b.start));
    return { events, google };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      start?: string;
      end?: string;
      description?: string;
      attendeeEmails?: string[];
      timezone?: string;
      createMeetingRoom?: boolean;
    };
    const title = body.title?.trim();
    const start = body.start?.trim();
    const end = body.end?.trim();
    if (!title || !start || !end) throw jsonError("Title, start, and end are required", 400);
    if (title.length > 200) throw jsonError("Title must be 200 characters or fewer", 400);
    if (
      Number.isNaN(Date.parse(start)) ||
      Number.isNaN(Date.parse(end)) ||
      Date.parse(end) <= Date.parse(start)
    ) {
      throw jsonError("End time must be after the start time", 400);
    }

    const status = await googleConnectionStatus(session.uid);
    if (!status.configured || !status.connected) {
      throw jsonError("Connect Google Calendar before creating an event", 409);
    }

    const attendeeEmails = (body.attendeeEmails || [])
      .map((email) => email.trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    const result = await executeTool({
      boatshipUid: session.uid,
      toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
      arguments: {
        calendar_id: "primary",
        summary: title,
        start_datetime: start,
        end_datetime: end,
        timezone: body.timezone?.trim() || "Asia/Kolkata",
        description: body.description?.trim() || undefined,
        attendees: attendeeEmails.length ? attendeeEmails : undefined,
        send_updates: attendeeEmails.length ? "all" : "none",
        create_meeting_room: body.createMeetingRoom !== false,
        extended_properties: {
          private: { source: "boatship", createdBy: session.uid },
        },
      },
    });
    const failure = googleFailure(result);
    if (failure) throw jsonError(failure, 502);
    return { ok: true, result };
  });
}
