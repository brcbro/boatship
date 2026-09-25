import { randomUUID } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
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

function json(value: unknown) { return value as Prisma.InputJsonValue; }
async function canSee(session: AuthSession, clientId: string | null, ownerId: string | null) {
  if (session.role === "admin") return true;
  if (clientId) return canAccessClient(session, clientId);
  return session.role === "team" && ownerId === session.uid;
}
function normalisePriority(value: string | undefined): HodiPriority {
  return value && value in HODI_PRIORITY_RANK ? value as HodiPriority : "medium";
}

function queueOrder<T extends { priority: string; dueAt: Date | null; updatedAt: Date }>(items: T[]) {
  return items.sort((left, right) => {
    const priority = HODI_PRIORITY_RANK[normalisePriority(right.priority)] - HODI_PRIORITY_RANK[normalisePriority(left.priority)];
    if (priority) return priority;
    const due = (left.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
    if (due) return due;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
}

function assertQueueDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("snoozedUntil must be a valid date");
  return date;
}

export async function upsertHodiQueueItem(input: HodiQueueItemInput) {
  const db = getPrisma();
  const data = {
    clientId: input.clientId ?? null, taskId: input.taskId ?? null, kind: input.kind, source: input.source,
    title: input.title, summary: input.summary, ownerId: input.ownerId ?? null, priority: normalisePriority(input.priority),
    dueAt: input.dueAt ? new Date(input.dueAt) : null, metadata: input.metadata === undefined ? undefined : json(input.metadata),
    evidence: input.evidence === undefined ? undefined : json(input.evidence),
  };
  return db.hodiQueueItem.upsert({ where: { dedupeKey: input.dedupeKey }, create: { id: randomUUID(), dedupeKey: input.dedupeKey, ...data }, update: data });
}

export async function listHodiQueue(session: AuthSession, filters: { status?: string; clientId?: string; ownerId?: string; includeDismissed?: boolean } = {}) {
  if (session.role === "client" && !session.clientId) return [];
  const clientId = filters.clientId || (session.role === "client" ? session.clientId || undefined : undefined);
  if (clientId && !await canSee(session, clientId, null)) throw new Error("Forbidden");
  const items = await getPrisma().hodiQueueItem.findMany({ where: {
    ...(clientId ? { clientId } : {}), ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.includeDismissed ? {} : { dismissedAt: null }),
    AND: [{ OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] }],
  }, orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }] });
  // Prisma sorts this legacy string column lexically. Rank it explicitly so urgent
  // work consistently appears before high, medium, and low priority work.
  const visible = await Promise.all(items.map(async (item) => await canSee(session, item.clientId, item.ownerId) ? item : null));
  return queueOrder(visible.filter((item): item is NonNullable<typeof item> => item !== null));
}

export async function getHodiQueueItem(id: string, session: AuthSession) {
  const item = await getPrisma().hodiQueueItem.findUnique({ where: { id } });
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
  if (status === "snoozed" && !input.snoozedUntil && (!current.snoozedUntil || current.snoozedUntil.getTime() <= Date.now())) {
    throw new Error("A snoozed item needs a future snoozedUntil time");
  }
  const reopening = status === "open" || status === "in_progress";
  const closingOrCompleting = status === "completed" || status === "dismissed";
  const updated = await getPrisma().hodiQueueItem.update({ where: { id: current.id }, data: {
    ...(status ? { status } : {}), ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
    ...(input.snoozedUntil !== undefined ? { snoozedUntil: input.snoozedUntil ? assertQueueDate(input.snoozedUntil) : null, status: input.snoozedUntil ? "snoozed" : (status || "open") } : {}),
    ...(input.dismissed ? { dismissedAt: new Date() } : {}),
    ...(reopening ? { dismissedAt: null } : {}),
    ...(reopening || closingOrCompleting ? { snoozedUntil: null } : {}),
  } });
  if (current.clientId) await (await getStore()).addActivity({ clientId: current.clientId, actorId: session.uid, actorName: session.name, action: `hodi.queue.${input.dismissed ? "dismissed" : "updated"}`, meta: { queueItemId: id, previousStatus: current.status, status: updated.status, previousOwnerId: current.ownerId, ownerId: updated.ownerId, snoozedUntil: updated.snoozedUntil?.toISOString() ?? null } });
  return updated;
}

export async function generateHodiQueue(session: AuthSession, clientId?: string) {
  const store = await getStore();
  const clients = clientId ? [await store.getClient(clientId)].filter(Boolean) : await filterAssignedClients(session, await store.listClients());
  const insights = await buildHodiClientInsights(session, clientId);
  const generated = [];
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
  const now = new Date();
  await getPrisma().$executeRaw`UPDATE "HodiActionProposal" SET "status" = 'expired', "updatedAt" = NOW() WHERE "status" IN ('pending', 'approved', 'executing') AND "expiresAt" <= ${now}`;
  const pending = await getPrisma().hodiActionProposal.findMany({ where: { status: { in: ["pending", "approved"] }, expiresAt: { gt: now } } });
  for (const proposal of pending) {
    if (session.role !== "admin" && proposal.userId !== session.uid) continue;
    generated.push(await upsertHodiQueueItem({ dedupeKey: `proposal:${proposal.id}`, kind: "approval", source: "hodi-action", title: `Approve ${proposal.action}`, summary: `Hodi action ${proposal.action} is waiting for approval.`, ownerId: proposal.userId, priority: "high", metadata: { proposalId: proposal.id } }));
  }
  return generated;
}

export async function listHodiActionProposals(session: AuthSession, status = "pending") {
  const now = new Date();
  await getPrisma().$executeRaw`UPDATE "HodiActionProposal" SET "status" = 'expired', "updatedAt" = NOW() WHERE "status" IN ('pending', 'approved', 'executing') AND "expiresAt" <= ${now}`;
  const where = session.role === "admin" ? { status } : { userId: session.uid, status };
  return getPrisma().hodiActionProposal.findMany({ where, orderBy: { createdAt: "desc" } });
}

export async function createHodiActionProposal(input: { approvalToken: string; action: string; payload: unknown; payloadHash: string; userId: string; preview: unknown; expiresAt: Date }) {
  return getPrisma().hodiActionProposal.create({ data: { id: randomUUID(), approvalToken: input.approvalToken, action: input.action, payload: json(input.payload), payloadHash: input.payloadHash, userId: input.userId, preview: json(input.preview), expiresAt: input.expiresAt } });
}

export async function consumeHodiActionProposal(input: { approvalToken: string; action: string; payloadHash: string; userId: string }) {
  const db = getPrisma();
  const proposal = await db.hodiActionProposal.findUnique({ where: { approvalToken: input.approvalToken } });
  if (!proposal || !["pending", "approved"].includes(proposal.status) || proposal.expiresAt.getTime() <= Date.now() || proposal.userId !== input.userId || proposal.action !== input.action || proposal.payloadHash !== input.payloadHash) throw new Error("Approval token is missing, expired, or does not match this action");
  const previousStatus: "pending" | "approved" = proposal.status === "approved" ? "approved" : "pending";
  const updated = await db.$executeRaw`UPDATE "HodiActionProposal" SET "status" = 'executing', "updatedAt" = NOW() WHERE "id" = ${proposal.id} AND "status" = ${previousStatus} AND "expiresAt" > NOW()`;
  if (updated !== 1) throw new Error("This action is already being executed or has been used");
  return { proposal, previousStatus };
}

export async function finishHodiActionProposal(id: string) {
  const updated = await getPrisma().$executeRaw`UPDATE "HodiActionProposal" SET "status" = 'consumed', "consumedAt" = NOW(), "updatedAt" = NOW() WHERE "id" = ${id} AND "status" = 'executing'`;
  if (updated !== 1) throw new Error("Action proposal could not be finalized");
}

export async function releaseHodiActionProposal(id: string, status: "pending" | "approved") {
  await getPrisma().$executeRaw`UPDATE "HodiActionProposal" SET "status" = ${status}, "updatedAt" = NOW() WHERE "id" = ${id} AND "status" = 'executing'`;
}

export async function reviewHodiActionProposal(id: string, reviewer: AuthSession, status: "approved" | "rejected", reason?: string) {
  if (reviewer.role !== "admin" && reviewer.role !== "team") throw new Error("Forbidden");
  if (status === "rejected" && !reason?.trim()) throw new Error("A reason is required when rejecting");
  const proposal = await getPrisma().hodiActionProposal.findUnique({ where: { id } });
  if (!proposal) throw new Error("Action proposal not found");
  if (reviewer.role === "team" && proposal.userId !== reviewer.uid) throw new Error("Forbidden");
  if (proposal.status !== "pending" || proposal.expiresAt.getTime() <= Date.now()) throw new Error("Action proposal is no longer reviewable");
  return getPrisma().hodiActionProposal.update({ where: { id }, data: { status, approvedBy: reviewer.uid, approvedAt: new Date(), rejectedReason: reason?.trim() || null } });
}
