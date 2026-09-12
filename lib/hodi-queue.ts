import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";
import { buildHodiClientInsights } from "@/lib/hodi-insights";
import type { AuthSession } from "@/types";

export type HodiQueueStatus = "open" | "in_progress" | "snoozed" | "dismissed" | "completed";
export type HodiQueueItemInput = {
  dedupeKey: string; clientId?: string | null; taskId?: string | null; kind: string; source: string;
  title: string; summary: string; ownerId?: string | null; priority?: string; dueAt?: string | null;
  metadata?: unknown; evidence?: unknown;
};

function json(value: unknown) { return value as Prisma.InputJsonValue; }
function canSee(session: AuthSession, clientId: string | null) { return session.role !== "client" || Boolean(session.clientId && clientId && session.clientId === clientId); }

export async function upsertHodiQueueItem(input: HodiQueueItemInput) {
  const db = getPrisma();
  const data = {
    clientId: input.clientId ?? null, taskId: input.taskId ?? null, kind: input.kind, source: input.source,
    title: input.title, summary: input.summary, ownerId: input.ownerId ?? null, priority: input.priority || "medium",
    dueAt: input.dueAt ? new Date(input.dueAt) : null, metadata: input.metadata === undefined ? undefined : json(input.metadata),
    evidence: input.evidence === undefined ? undefined : json(input.evidence),
  };
  return db.hodiQueueItem.upsert({ where: { dedupeKey: input.dedupeKey }, create: { id: randomUUID(), dedupeKey: input.dedupeKey, ...data }, update: data });
}

export async function listHodiQueue(session: AuthSession, filters: { status?: string; clientId?: string; ownerId?: string; includeDismissed?: boolean } = {}) {
  if (session.role === "client" && !session.clientId) return [];
  const clientId = filters.clientId || (session.role === "client" ? session.clientId || undefined : undefined);
  if (clientId && !canSee(session, clientId)) throw new Error("Forbidden");
  return getPrisma().hodiQueueItem.findMany({ where: {
    ...(clientId ? { clientId } : {}), ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.includeDismissed ? {} : { dismissedAt: null }),
    AND: [{ OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] }],
  }, orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { updatedAt: "desc" }] });
}

export async function getHodiQueueItem(id: string, session: AuthSession) {
  const item = await getPrisma().hodiQueueItem.findUnique({ where: { id } });
  if (!item || !canSee(session, item.clientId)) throw new Error("Queue item not found");
  return item;
}

export async function updateHodiQueueItem(id: string, session: AuthSession, input: { status?: HodiQueueStatus; snoozedUntil?: string | null; ownerId?: string | null; dismissed?: boolean }) {
  const current = await getHodiQueueItem(id, session);
  if (session.role === "client" && (input.ownerId !== undefined || input.status === "dismissed")) throw new Error("Forbidden");
  if (input.ownerId) {
    const owner = await (await getStore()).getUser(input.ownerId);
    if (!owner || (owner.role !== "admin" && owner.role !== "team")) throw new Error("Queue owner must be an active staff member");
  }
  const status = input.dismissed ? "dismissed" : input.status;
  const updated = await getPrisma().hodiQueueItem.update({ where: { id: current.id }, data: {
    ...(status ? { status } : {}), ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
    ...(input.snoozedUntil !== undefined ? { snoozedUntil: input.snoozedUntil ? new Date(input.snoozedUntil) : null, status: input.snoozedUntil ? "snoozed" : (status || "open") } : {}),
    ...(input.dismissed ? { dismissedAt: new Date() } : {}),
  } });
  if (current.clientId) await (await getStore()).addActivity({ clientId: current.clientId, actorId: session.uid, actorName: session.name, action: `hodi.queue.${input.dismissed ? "dismissed" : "updated"}`, meta: { queueItemId: id, status: updated.status } });
  return updated;
}

export async function generateHodiQueue(session: AuthSession, clientId?: string) {
  const store = await getStore();
  const clients = clientId ? [await store.getClient(clientId)].filter(Boolean) : await store.listClients();
  const insights = await buildHodiClientInsights(session, clientId);
  const generated = [];
  for (const insight of insights) {
    const client = clients.find((item) => item?.id === insight.profile.clientId);
    if (!client || !canSee(session, client.id)) continue;
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
  const pending = await getPrisma().hodiActionProposal.findMany({ where: { status: "pending", expiresAt: { gt: new Date() } } });
  for (const proposal of pending) generated.push(await upsertHodiQueueItem({ dedupeKey: `proposal:${proposal.id}`, kind: "approval", source: "hodi-action", title: `Approve ${proposal.action}`, summary: `Hodi action ${proposal.action} is waiting for approval.`, ownerId: proposal.userId, priority: "high", metadata: { proposalId: proposal.id } }));
  return generated;
}

export async function listHodiActionProposals(session: AuthSession, status = "pending") {
  const where = session.role === "admin" || session.role === "team" ? { status } : { userId: session.uid, status };
  return getPrisma().hodiActionProposal.findMany({ where, orderBy: { createdAt: "desc" } });
}

export async function createHodiActionProposal(input: { approvalToken: string; action: string; payload: unknown; payloadHash: string; userId: string; preview: unknown; expiresAt: Date }) {
  return getPrisma().hodiActionProposal.create({ data: { id: randomUUID(), approvalToken: input.approvalToken, action: input.action, payload: json(input.payload), payloadHash: input.payloadHash, userId: input.userId, preview: json(input.preview), expiresAt: input.expiresAt } });
}

export async function consumeHodiActionProposal(input: { approvalToken: string; action: string; payloadHash: string; userId: string }) {
  const db = getPrisma();
  const proposal = await db.hodiActionProposal.findUnique({ where: { approvalToken: input.approvalToken } });
  if (!proposal || !["pending", "approved"].includes(proposal.status) || proposal.expiresAt.getTime() <= Date.now() || proposal.userId !== input.userId || proposal.action !== input.action || proposal.payloadHash !== input.payloadHash) throw new Error("Approval token is missing, expired, or does not match this action");
  const updated = await db.hodiActionProposal.updateMany({ where: { id: proposal.id, status: { in: ["pending", "approved"] } }, data: { status: "consumed", consumedAt: new Date() } });
  if (updated.count !== 1) throw new Error("Approval token has already been used");
  return proposal;
}

export async function reviewHodiActionProposal(id: string, reviewer: AuthSession, status: "approved" | "rejected", reason?: string) {
  if (reviewer.role !== "admin" && reviewer.role !== "team") throw new Error("Forbidden");
  if (status === "rejected" && !reason?.trim()) throw new Error("A reason is required when rejecting");
  const proposal = await getPrisma().hodiActionProposal.findUnique({ where: { id } });
  if (!proposal) throw new Error("Action proposal not found");
  if (proposal.status !== "pending" || proposal.expiresAt.getTime() <= Date.now()) throw new Error("Action proposal is no longer reviewable");
  return getPrisma().hodiActionProposal.update({ where: { id }, data: { status, approvedBy: reviewer.uid, approvedAt: new Date(), rejectedReason: reason?.trim() || null } });
}
