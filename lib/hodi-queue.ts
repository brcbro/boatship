import { randomUUID } from "crypto";
import { Collection, getFirestore, nowIso } from "@/lib/firestore";
import { commitInChunks } from "@/lib/firestore/bulk";
import { getStore } from "@/lib/store";
import { buildHodiClientInsights } from "@/lib/hodi-insights";
import { canAccessClient, filterAssignedClients } from "@/lib/client-access";
import type { AuthSession } from "@/types";

export type HodiQueueStatus = "open" | "in_progress" | "snoozed" | "dismissed" | "completed";
export const HODI_PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 } as const;
export type HodiPriority = keyof typeof HODI_PRIORITY_RANK;
export type HodiQueueItemInput = {
  dedupeKey: string; clientId?: string | null; taskId?: string | null; kind: string; source: string;
  title: string; summary: string; ownerId?: string | null; priority?: string; dueAt?: string | null;
  metadata?: unknown; evidence?: unknown;
};

/** Firestore documents; every timestamp is an ISO-8601 string. */
export type HodiQueueItemDoc = {
  id: string; dedupeKey: string; clientId: string | null; taskId: string | null; kind: string; source: string;
  title: string; summary: string; ownerId: string | null; priority: string; status: string;
  dueAt: string | null; snoozedUntil: string | null; dismissedAt: string | null; metadata: unknown; evidence: unknown;
  createdAt: string; updatedAt: string;
};
export type HodiActionProposalDoc = {
  id: string; approvalToken: string; action: string; payload: unknown; payloadHash: string; userId: string; status: string;
  preview: unknown; expiresAt: string; approvedBy: string | null; approvedAt: string | null; rejectedReason: string | null;
  consumedAt: string | null; createdAt: string; updatedAt: string;
};
export const HODI_QUEUE_ITEMS = new Collection<HodiQueueItemDoc>("HodiQueueItem");
export const HODI_ACTION_PROPOSALS = new Collection<HodiActionProposalDoc>("HodiActionProposal");

async function canSee(session: AuthSession, clientId: string | null, ownerId: string | null) {
  if (session.role === "admin") return true;
  if (clientId) return canAccessClient(session, clientId);
  return session.role === "team" && ownerId === session.uid;
}
function normalisePriority(value: string | undefined): HodiPriority {
  return value && value in HODI_PRIORITY_RANK ? value as HodiPriority : "medium";
}

const time = (value: string | null | undefined) => (value ? Date.parse(value) : null);

function queueOrder<T extends { priority: string; dueAt: string | null; updatedAt: string }>(items: T[]) {
  return items.sort((left, right) => {
    const priority = HODI_PRIORITY_RANK[normalisePriority(right.priority)] - HODI_PRIORITY_RANK[normalisePriority(left.priority)];
    if (priority) return priority;
    const due = (time(left.dueAt) ?? Number.MAX_SAFE_INTEGER) - (time(right.dueAt) ?? Number.MAX_SAFE_INTEGER);
    if (due) return due;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function assertQueueDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("snoozedUntil must be a valid date");
  return date;
}

export async function upsertHodiQueueItem(input: HodiQueueItemInput): Promise<HodiQueueItemDoc> {
  const data = {
    clientId: input.clientId ?? null, taskId: input.taskId ?? null, kind: input.kind, source: input.source,
    title: input.title, summary: input.summary, ownerId: input.ownerId ?? null, priority: normalisePriority(input.priority),
    dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
  };
  return getFirestore().runTransaction(async (tx) => {
    const now = nowIso();
    const [existing] = await tx.query<HodiQueueItemDoc>(HODI_QUEUE_ITEMS.spec([{ field: "dedupeKey", op: "==", value: input.dedupeKey }], { limit: 1 }));
    if (existing) {
      tx.write({ update: { collection: HODI_QUEUE_ITEMS.name, id: existing.id, data: { ...data, updatedAt: now } } });
      return { ...existing.data, ...data, id: existing.id, updatedAt: now };
    }
    const created: HodiQueueItemDoc = {
      id: randomUUID(), dedupeKey: input.dedupeKey, status: "open", snoozedUntil: null, dismissedAt: null,
      metadata: input.metadata ?? null, evidence: input.evidence ?? null, createdAt: now, updatedAt: now, ...data,
    };
    tx.write({ set: { collection: HODI_QUEUE_ITEMS.name, id: created.id, data: created, precondition: { exists: false } } });
    return created;
  });
}

export async function listHodiQueue(session: AuthSession, filters: { status?: string; clientId?: string; ownerId?: string; includeDismissed?: boolean } = {}) {
  if (session.role === "client" && !session.clientId) return [];
  const clientId = filters.clientId || (session.role === "client" ? session.clientId || undefined : undefined);
  if (clientId && !await canSee(session, clientId, null)) throw new Error("Forbidden");
  const now = nowIso();
  const items = (await HODI_QUEUE_ITEMS.find([
    ...(clientId ? [{ field: "clientId", op: "==" as const, value: clientId }] : []),
    ...(filters.ownerId ? [{ field: "ownerId", op: "==" as const, value: filters.ownerId }] : []),
    ...(filters.status ? [{ field: "status", op: "==" as const, value: filters.status }] : []),
    ...(filters.includeDismissed ? [] : [{ field: "dismissedAt", op: "is-null" as const }]),
  ])).filter((item) => !item.snoozedUntil || item.snoozedUntil <= now);
  const visible = await Promise.all(items.map(async (item) => await canSee(session, item.clientId, item.ownerId) ? item : null));
  return queueOrder(visible.filter((item): item is NonNullable<typeof item> => item !== null));
}

export async function getHodiQueueItem(id: string, session: AuthSession): Promise<HodiQueueItemDoc> {
  const item = await HODI_QUEUE_ITEMS.get(id);
  if (!item || !await canSee(session, item.clientId, item.ownerId)) throw new Error("Queue item not found");
  return item;
}

export async function updateHodiQueueItem(id: string, session: AuthSession, input: { status?: HodiQueueStatus; snoozedUntil?: string | null; ownerId?: string | null; dismissed?: boolean }) {
  const current = await getHodiQueueItem(id, session);
  if (session.role === "client" && (input.ownerId !== undefined || input.status === "dismissed")) throw new Error("Forbidden");
  if (input.ownerId) {
    const owner = await (await getStore()).getUser(input.ownerId);
    if (!owner || (owner.role !== "admin" && owner.role !== "team")) throw new Error("Queue owner must be an active staff member");
  }
  if (input.snoozedUntil && input.status && input.status !== "snoozed") throw new Error("A snoozed item must have snoozed status");
  if (input.snoozedUntil && assertQueueDate(input.snoozedUntil).getTime() <= Date.now()) throw new Error("snoozedUntil must be in the future");
  const status = input.dismissed ? "dismissed" : input.status;
  if (status === "snoozed" && !input.snoozedUntil && (!current.snoozedUntil || Date.parse(current.snoozedUntil) <= Date.now())) {
    throw new Error("A snoozed item needs a future snoozedUntil time");
  }
  const reopening = status === "open" || status === "in_progress";
  const closingOrCompleting = status === "completed" || status === "dismissed";
  const now = nowIso();
  const patch: Partial<HodiQueueItemDoc> = {
    ...(status ? { status } : {}), ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
    ...(input.snoozedUntil !== undefined ? { snoozedUntil: input.snoozedUntil ? assertQueueDate(input.snoozedUntil).toISOString() : null, status: input.snoozedUntil ? "snoozed" : (status || "open") } : {}),
    ...(input.dismissed ? { dismissedAt: now } : {}),
    ...(reopening ? { dismissedAt: null } : {}),
    ...(reopening || closingOrCompleting ? { snoozedUntil: null } : {}),
    updatedAt: now,
  };
  await HODI_QUEUE_ITEMS.update(current.id, patch);
  const updated = { ...current, ...patch };
  if (current.clientId) await (await getStore()).addActivity({ clientId: current.clientId, actorId: session.uid, actorName: session.name, action: `hodi.queue.${input.dismissed ? "dismissed" : "updated"}`, meta: { queueItemId: id, previousStatus: current.status, status: updated.status, ownerId: updated.ownerId } });
  return updated;
}

/** Marks every live proposal past its deadline as expired. */
async function expireHodiActionProposals(now: string) {
  const live = await HODI_ACTION_PROPOSALS.find([{ field: "status", op: "in", value: ["pending", "approved", "executing"] }]);
  const expired = live.filter((proposal) => proposal.expiresAt <= now);
  await commitInChunks(expired.map((proposal) => ({ update: { collection: HODI_ACTION_PROPOSALS.name, id: proposal.id, data: { status: "expired", updatedAt: now } } })));
}

export async function generateHodiQueue(session: AuthSession, clientId?: string) {
  const store = await getStore();
  const clients = clientId ? [await store.getClient(clientId)].filter(Boolean) : await filterAssignedClients(session, await store.listClients());
  const insights = await buildHodiClientInsights(session, clientId);
  const generated: HodiQueueItemDoc[] = [];
  for (const insight of insights) {
    const client = clients.find((item) => item?.id === insight.profile.clientId);
    if (!client || !await canSee(session, client.id, null)) continue;
    for (const [index, recommendation] of insight.recommendations.entries()) {
      const task = recommendation.evidence.find((item) => item.source === "Task");
      generated.push(await upsertHodiQueueItem({
        dedupeKey: `insight:${client.id}:${recommendation.kind}:${task?.label || index}`,
        clientId: client.id, kind: recommendation.kind, source: "hodi-insight", title: recommendation.summary,
        summary: recommendation.summary, ownerId: recommendation.owner === "team" ? client.assignedTeamMemberId : null,
        priority: recommendation.kind === "blocker" || recommendation.kind === "launch_approval" ? "high" : "medium",
        evidence: recommendation.evidence,
      }));
    }
  }
  const now = nowIso();
  await expireHodiActionProposals(now);
  const pending = (await HODI_ACTION_PROPOSALS.find([{ field: "status", op: "in", value: ["pending", "approved"] }])).filter((proposal) => proposal.expiresAt > now);
  for (const proposal of pending) {
    if (session.role !== "admin" && proposal.userId !== session.uid) continue;
    generated.push(await upsertHodiQueueItem({ dedupeKey: `proposal:${proposal.id}`, kind: "approval", source: "hodi-action", title: `Approve ${proposal.action}`, summary: `Hodi action ${proposal.action} is waiting for approval.`, ownerId: proposal.userId, priority: "high", dueAt: proposal.expiresAt, metadata: { proposalId: proposal.id, action: proposal.action } }));
  }
  return generated;
}

export async function listHodiActionProposals(session: AuthSession, status = "pending") {
  const now = nowIso();
  await expireHodiActionProposals(now);
  const where = [{ field: "status", op: "==" as const, value: status }, ...(session.role === "admin" ? [] : [{ field: "userId", op: "==" as const, value: session.uid }])];
  return (await HODI_ACTION_PROPOSALS.find(where)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createHodiActionProposal(input: { approvalToken: string; action: string; payload: unknown; payloadHash: string; userId: string; preview: unknown; expiresAt: Date }) {
  const now = nowIso();
  const proposal: HodiActionProposalDoc = {
    id: randomUUID(), approvalToken: input.approvalToken, action: input.action, payload: input.payload, payloadHash: input.payloadHash,
    userId: input.userId, status: "pending", preview: input.preview, expiresAt: input.expiresAt.toISOString(),
    approvedBy: null, approvedAt: null, rejectedReason: null, consumedAt: null, createdAt: now, updatedAt: now,
  };
  await HODI_ACTION_PROPOSALS.create(proposal.id, proposal);
  return proposal;
}

export async function consumeHodiActionProposal(input: { approvalToken: string; action: string; payloadHash: string; userId: string }) {
  return getFirestore().runTransaction(async (tx) => {
    const [found] = await tx.query<HodiActionProposalDoc>(HODI_ACTION_PROPOSALS.spec([{ field: "approvalToken", op: "==", value: input.approvalToken }], { limit: 1 }));
    const proposal = found ? { ...found.data, id: found.id } : null;
    if (!proposal || !["pending", "approved"].includes(proposal.status) || Date.parse(proposal.expiresAt) <= Date.now() || proposal.userId !== input.userId || proposal.action !== input.action || proposal.payloadHash !== input.payloadHash) throw new Error("Approval token is missing, expired, or does not match this action");
    const previousStatus: "pending" | "approved" = proposal.status === "approved" ? "approved" : "pending";
    tx.write({ update: { collection: HODI_ACTION_PROPOSALS.name, id: proposal.id, data: { status: "executing", updatedAt: nowIso() } } });
    return { proposal, previousStatus };
  });
}

export async function finishHodiActionProposal(id: string) {
  const finished = await getFirestore().runTransaction(async (tx) => {
    const current = await tx.get<HodiActionProposalDoc>(HODI_ACTION_PROPOSALS.name, id);
    if (!current || current.data.status !== "executing") return false;
    const now = nowIso();
    tx.write({ update: { collection: HODI_ACTION_PROPOSALS.name, id, data: { status: "consumed", consumedAt: now, updatedAt: now } } });
    return true;
  });
  if (!finished) throw new Error("Action proposal could not be finalized");
}

export async function releaseHodiActionProposal(id: string, status: "pending" | "approved") {
  await getFirestore().runTransaction(async (tx) => {
    const current = await tx.get<HodiActionProposalDoc>(HODI_ACTION_PROPOSALS.name, id);
    if (!current || current.data.status !== "executing") return;
    tx.write({ update: { collection: HODI_ACTION_PROPOSALS.name, id, data: { status, updatedAt: nowIso() } } });
  });
}

export async function reviewHodiActionProposal(id: string, reviewer: AuthSession, status: "approved" | "rejected", reason?: string) {
  if (reviewer.role !== "admin" && reviewer.role !== "team") throw new Error("Forbidden");
  if (status === "rejected" && !reason?.trim()) throw new Error("A reason is required when rejecting");
  const proposal = await HODI_ACTION_PROPOSALS.get(id);
  if (!proposal) throw new Error("Action proposal not found");
  if (reviewer.role === "team" && proposal.userId !== reviewer.uid) throw new Error("Forbidden");
  if (proposal.status !== "pending" || Date.parse(proposal.expiresAt) <= Date.now()) throw new Error("Action proposal is no longer reviewable");
  const now = nowIso();
  const patch = { status, approvedBy: reviewer.uid, approvedAt: now, rejectedReason: reason?.trim() || null, updatedAt: now };
  await HODI_ACTION_PROPOSALS.update(id, patch);
  return { ...proposal, ...patch };
}
