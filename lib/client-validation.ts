import { z } from "zod";
import { accountStatus } from "@/lib/account-status";
import type { AppUser, ClientStatus, PipelineStage } from "@/types";

/** Request validation for client records (create, update, bulk update). */

export const CLIENT_STATUSES = ["not_started", "in_progress", "completed", "on_hold"] as const satisfies readonly ClientStatus[];
export const PIPELINE_STAGES = ["intake", "kyc", "compliance", "kickoff", "go_live", "done"] as const satisfies readonly PipelineStage[];

export const CLIENT_LIMITS = {
  name: 255,
  email: 254,
  tag: 50,
  tags: 50,
  customFieldKey: 100,
  customFieldValue: 2000,
  customFields: 50,
  pauseReason: 1000,
  templateId: 200,
  bulkIds: 500,
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const requiredText = (label: string, max: number) =>
  z.string({ error: `${label} must be text` }).trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);

const email = z.string({ error: "primaryContactEmail must be text" }).trim().toLowerCase()
  .max(CLIENT_LIMITS.email, `primaryContactEmail must be at most ${CLIENT_LIMITS.email} characters`)
  .regex(EMAIL, "primaryContactEmail must be a valid email address");

const status = z.enum(CLIENT_STATUSES, { error: `status must be one of ${CLIENT_STATUSES.join(", ")}` });
const pipelineStage = z.enum(PIPELINE_STAGES, { error: `pipelineStage must be one of ${PIPELINE_STAGES.join(", ")}` });

const tags = z.array(
  z.string({ error: "Each tag must be text" }).trim().max(CLIENT_LIMITS.tag, `Each tag must be at most ${CLIENT_LIMITS.tag} characters`),
  { error: "tags must be a list of text values" },
).max(CLIENT_LIMITS.tags, `At most ${CLIENT_LIMITS.tags} tags are allowed`)
  .transform((values) => [...new Set(values.filter(Boolean))]);

const customFields = z.record(
  z.string().trim().max(CLIENT_LIMITS.customFieldKey, `Custom field names must be at most ${CLIENT_LIMITS.customFieldKey} characters`),
  z.union([z.string(), z.number(), z.boolean(), z.null()], { error: "Custom field values must be text, numbers or true/false" })
    .transform((value) => String(value ?? "").trim())
    .pipe(z.string().max(CLIENT_LIMITS.customFieldValue, `Custom field values must be at most ${CLIENT_LIMITS.customFieldValue} characters`)),
  { error: "customFields must be an object of name/value pairs" },
).refine((record) => Object.keys(record).length <= CLIENT_LIMITS.customFields, `At most ${CLIENT_LIMITS.customFields} custom fields are allowed`);

const assignee = z.string({ error: "assignedTeamMemberId must be a user id or null" }).trim().min(1, "assignedTeamMemberId must be a user id or null").nullable();
const templateId = z.string({ error: "templateId must be text or null" }).trim()
  .max(CLIENT_LIMITS.templateId, `templateId must be at most ${CLIENT_LIMITS.templateId} characters`)
  .transform((value) => value || null).nullable();
const isoDate = z.string({ error: "pausedAt must be a date" }).refine((value) => /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value)), "pausedAt must be a valid date");

export const clientCreateSchema = z.object({
  name: requiredText("name", CLIENT_LIMITS.name),
  companyName: requiredText("companyName", CLIENT_LIMITS.name),
  primaryContactEmail: email,
  assignedTeamMemberId: assignee.optional(),
  templateId: templateId.optional(),
  status: status.optional(),
  tags: tags.optional(),
  customFields: customFields.optional(),
});

export const clientUpdateSchema = z.object({
  name: requiredText("name", CLIENT_LIMITS.name).optional(),
  companyName: requiredText("companyName", CLIENT_LIMITS.name).optional(),
  primaryContactEmail: email.optional(),
  status: status.optional(),
  assignedTeamMemberId: assignee.optional(),
  templateId: templateId.optional(),
  tags: tags.optional(),
  customFields: customFields.optional(),
  pipelineStage: pipelineStage.optional(),
  pauseReason: z.string({ error: "pauseReason must be text or null" }).trim().max(CLIENT_LIMITS.pauseReason, `pauseReason must be at most ${CLIENT_LIMITS.pauseReason} characters`).nullable().optional(),
  pausedAt: isoDate.nullable().optional(),
  paused: z.boolean({ error: "paused must be true or false" }).optional(),
});

export const clientBulkSchema = z.object({
  ids: z.array(z.string().trim(), { error: "ids must be a list of client ids" })
    .transform((values) => [...new Set(values.filter(Boolean))])
    .pipe(z.array(z.string()).min(1, "ids is required").max(CLIENT_LIMITS.bulkIds, `At most ${CLIENT_LIMITS.bulkIds} clients can be updated at once`)),
  status: status.optional(),
  assignedTeamMemberId: assignee.optional(),
  tags: tags.optional(),
});

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;
export type ClientBulkInput = z.infer<typeof clientBulkSchema>;

/** One readable message for the first problem, prefixed with its field. */
export function validationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const field = issue.path.map(String).join(".");
  return field && !issue.message.startsWith(issue.path[0] as string) ? `${field}: ${issue.message}` : issue.message;
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseClientInput<S extends z.ZodType>(schema: S, body: unknown): ParseResult<z.infer<S>> {
  const result = schema.safeParse(body && typeof body === "object" ? body : {});
  return result.success ? { ok: true, data: result.data } : { ok: false, error: validationMessage(result.error) };
}

/** An assignee must be an existing admin or team user whose account is active. */
export function isActiveStaffUser(user: AppUser | null | undefined): boolean {
  return Boolean(user && (user.role === "admin" || user.role === "team") && accountStatus(user) === "active");
}
