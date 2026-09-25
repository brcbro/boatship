import type { AuthSession } from "@/types";
import {
  executeTool,
  isComposioConfiguredForUser,
  listBoatshipConnections,
} from "@/lib/composio";

type Payload = Record<string, unknown>;

type CalendarInput = {
  title: string;
  start: string;
  end: string;
  timezone: string;
  description: string;
  attendeeEmails: string[];
  createMeetingRoom: boolean;
};

function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`${name} must be ${maxLength} characters or fewer`);
  return result;
}

function optionalText(value: unknown, name: string, maxLength: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`${name} must be ${maxLength} characters or fewer`);
  return result;
}

function dateTime(value: unknown, name: string): string {
  const result = requiredText(value, name, 50);
  // Require an explicit offset so the preview and execution refer to the same instant.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(result)) {
    throw new Error(`${name} must be an ISO date and time with a UTC offset`);
  }
  if (Number.isNaN(Date.parse(result))) throw new Error(`${name} must be a valid date and time`);
  return new Date(result).toISOString();
}

function timezone(value: unknown): string {
  const result = value === undefined || value === null || value === ""
    ? "Asia/Kolkata"
    : requiredText(value, "timezone", 100);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: result });
  } catch {
    throw new Error("timezone must be a valid IANA time zone");
  }
  return result;
}

function attendeeEmails(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("attendeeEmails must be a list of email addresses");
  if (value.length > 100) throw new Error("An event can have at most 100 attendees");
  const emails = value.map((item) => {
    if (typeof item !== "string") throw new Error("Every attendee must be an email address");
    const email = item.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new Error(`Invalid attendee email: ${email || "(empty)"}`);
    }
    return email;
  });
  return [...new Set(emails)];
}

function validate(payload: Payload): CalendarInput {
  const title = requiredText(payload.title, "title", 200);
  const start = dateTime(payload.start, "start");
  const end = dateTime(payload.end, "end");
  if (Date.parse(end) <= Date.parse(start)) throw new Error("end must be after start");
  if (payload.createMeetingRoom !== undefined && typeof payload.createMeetingRoom !== "boolean") {
    throw new Error("createMeetingRoom must be true or false");
  }
  return {
    title,
    start,
    end,
    timezone: timezone(payload.timezone),
    description: optionalText(payload.description, "description", 10000),
    attendeeEmails: attendeeEmails(payload.attendeeEmails),
    createMeetingRoom: payload.createMeetingRoom !== false,
  };
}

async function requireGoogleCalendar(session: AuthSession) {
  if (session.role !== "admin" && session.role !== "team") throw new Error("Forbidden");
  if (!(await isComposioConfiguredForUser(session.uid))) {
    throw new Error("Composio is not configured for this user or the server");
  }
  const connections = await listBoatshipConnections(session.uid);
  if (!connections.some((connection) => connection.slug === "googlecalendar" && connection.connected)) {
    throw new Error("Connect Google Calendar before creating an event");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { return asRecord(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createdEvent(result: unknown, input: CalendarInput) {
  const root = asRecord(result);
  if (!root || root.successful === false || root.error) {
    throw new Error(stringField(root, "error") || "Google Calendar could not create the event");
  }
  const data = asRecord(root.data);
  const response = asRecord(root.response_data) || asRecord(data?.response_data);
  const candidates = [response, data, root].flatMap((item) => [
    asRecord(item?.event),
    asRecord(item?.data),
    item,
  ]);
  const event = candidates.find((item) => stringField(item, "id") || stringField(item, "htmlLink"));
  const id = stringField(event, "id");
  const htmlLink = stringField(event, "htmlLink") || stringField(event, "html_link");
  return {
    id,
    title: stringField(event, "summary") || input.title,
    start: input.start,
    end: input.end,
    timezone: input.timezone,
    attendeeEmails: input.attendeeEmails,
    htmlLink,
    meetingLink: stringField(event, "hangoutLink"),
    providerConfirmationMissing: !id && !htmlLink,
  };
}

export async function previewCreateCalendarAction(
  action: string,
  payload: Payload,
  session: AuthSession,
) {
  if (action !== "create_calendar_event") throw new Error("Unsupported calendar action");
  const input = validate(payload);
  await requireGoogleCalendar(session);
  const format = (value: string) => new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: input.timezone,
  }).format(new Date(value));
  return {
    title: `Create Google Calendar event: ${input.title}`,
    changes: [
      `Schedule ${format(input.start)} to ${format(input.end)} (${input.timezone})`,
      `Invite ${input.attendeeEmails.length ? input.attendeeEmails.join(", ") : "no attendees"}`,
      input.attendeeEmails.length ? "Google Calendar will send invitations and event updates" : "No invitations will be sent",
      input.createMeetingRoom ? "Create a Google Meet room" : "Do not create a meeting room",
    ],
    diff: [
      { field: "calendar", label: "Calendar", before: "No event", after: "Primary Google Calendar" },
      { field: "title", label: "Title", before: "No event", after: input.title },
      { field: "start", label: "Start", before: "No event", after: format(input.start) },
      { field: "end", label: "End", before: "No event", after: format(input.end) },
      { field: "timezone", label: "Time zone", before: "No event", after: input.timezone },
      { field: "attendees", label: "Attendees", before: "No event", after: input.attendeeEmails.join(", ") || "None" },
      { field: "description", label: "Description", before: "No event", after: input.description || "None" },
    ],
  };
}

export async function executeCreateCalendarAction(
  action: string,
  payload: Payload,
  session: AuthSession,
) {
  if (action !== "create_calendar_event") throw new Error("Unsupported calendar action");
  const input = validate(payload);
  await requireGoogleCalendar(session);
  const result = await executeTool({
    boatshipUid: session.uid,
    toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
    arguments: {
      calendar_id: "primary",
      summary: input.title,
      start_datetime: input.start,
      end_datetime: input.end,
      timezone: input.timezone,
      description: input.description || undefined,
      attendees: input.attendeeEmails.length ? input.attendeeEmails : undefined,
      send_updates: input.attendeeEmails.length ? "all" : "none",
      create_meeting_room: input.createMeetingRoom,
      extended_properties: { private: { source: "boatship", createdBy: session.uid } },
    },
  });
  return { event: createdEvent(result, input) };
}
