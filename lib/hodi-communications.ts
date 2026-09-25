import { createHash, randomUUID } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import type { AuthSession } from "@/types";
import { hasPermission } from "@/lib/rbac";
import { requireClientAccess } from "@/lib/client-access";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";

export const HODI_COMMUNICATION_TYPES = ["missing_assets", "missing_access", "approval_request", "kickoff_scheduling", "overdue_escalation", "weekly_progress_update"] as const;
export const HODI_COMMUNICATION_CHANNELS = ["email", "slack", "sms", "whatsapp"] as const;
export type HodiCommunicationType = (typeof HODI_COMMUNICATION_TYPES)[number];
export type HodiCommunicationChannel = (typeof HODI_COMMUNICATION_CHANNELS)[number];
export type HodiCommunicationStatus = "pending" | "approved_ready_for_handoff" | "rejected" | "expired";

export type HodiCommunicationPayload = {
  clientId: string; channel?: HodiCommunicationChannel; recipient?: string; subject?: string; body?: string;
  missingItems?: string[]; approvalItem?: string; proposedTimes?: string[]; overdueItems?: string[];
  progressSummary?: string; nextSteps?: string[];
};

export type HodiCommunicationPlan = {
  type: HodiCommunicationType;
  client: { id: string; name: string; companyName: string; email: string };
  channel: HodiCommunicationChannel;
  recipient: string;
  subject: string | null;
  body: string;
  connection: { required: string; available: false; status: "unavailable" | "future_channel" };
  approval: { required: true; state: "awaiting_approval" | "approved"; token?: string; expiresAt?: string };
  sendEligibility: { eligible: false; reason: string };
  fallback: string;
};

const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const textList = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadHash(type: HodiCommunicationType, payload: HodiCommunicationPayload) {
  return createHash("sha256").update(`${type}:${stableJson(payload)}`).digest("hex");
}

function assertType(value: unknown): asserts value is HodiCommunicationType {
  if (!HODI_COMMUNICATION_TYPES.includes(value as HodiCommunicationType)) throw new Error("Unsupported communication type");
}

function assertChannel(value: unknown): HodiCommunicationChannel {
  const channel = text(value) || "email";
  if (!HODI_COMMUNICATION_CHANNELS.includes(channel as HodiCommunicationChannel)) throw new Error("Unsupported communication channel");
  return channel as HodiCommunicationChannel;
}

function assertCanCommunicate(session: AuthSession) {
  if (!hasPermission(session, "clients.view")) throw new Error("Forbidden");
}

function channelDetails(channel: HodiCommunicationChannel) {
  if (channel === "email") return { required: "A connected Gmail account", status: "unavailable" as const, fallback: "Copy this email into your mail client, or connect Gmail before trying to send." };
  if (channel === "slack") return { required: "A connected Slack workspace and destination channel", status: "unavailable" as const, fallback: "Copy this update into Slack, or connect Slack and choose a destination channel." };
  return { required: `${channel === "sms" ? "SMS" : "WhatsApp"} sending is not connected yet`, status: "future_channel" as const, fallback: `This ${channel === "sms" ? "SMS" : "WhatsApp"} draft is copy-ready. Sending will be available after a consented provider is connected.` };
}

function defaults(type: HodiCommunicationType, client: { name: string; companyName: string }, payload: HodiCommunicationPayload) {
  const items = textList(payload.missingItems);
  const overdue = textList(payload.overdueItems);
  const nextSteps = textList(payload.nextSteps);
  const greeting = `Hi ${client.name},`;
  const signature = "\n\nThanks,\nThe Boatship team";
  switch (type) {
    case "missing_assets": return { subject: `Assets needed for ${client.companyName}`, body: `${greeting}\n\nTo keep your project moving, please share ${items.length ? items.join(", ") : "the remaining project assets"}. Once these are in, we can continue with the next delivery step.${signature}` };
    case "missing_access": return { subject: `Access needed for ${client.companyName}`, body: `${greeting}\n\nWe are ready for the next step and need access to ${items.length ? items.join(", ") : "the required account access"}. Please share access with the appropriate Boatship contact when convenient.${signature}` };
    case "approval_request": return { subject: `Approval requested: ${client.companyName}`, body: `${greeting}\n\nYour review is ready for ${text(payload.approvalItem) || "the latest project deliverable"}. Please reply with approval or any feedback so we can keep the timeline on track.${signature}` };
    case "kickoff_scheduling": {
      const times = textList(payload.proposedTimes);
      return { subject: `Schedule your ${client.companyName} kickoff`, body: `${greeting}\n\nWe are ready to schedule your project kickoff. Please let us know which time works best, or share a few alternatives.${times.length ? `\n\nSuggested times:\n${times.map((time) => `- ${time}`).join("\n")}` : ""}${signature}` };
    }
    case "overdue_escalation": return { subject: `Action needed to keep ${client.companyName} on schedule`, body: `${greeting}\n\nA few project items are waiting, which may affect the planned timeline. Please review the items below and let us know how you would like to proceed.${overdue.length ? `\n\nItems waiting:\n${overdue.map((item) => `- ${item}`).join("\n")}` : ""}${signature}` };
    case "weekly_progress_update": return { subject: `Weekly update: ${client.companyName}`, body: `${greeting}\n\n${text(payload.progressSummary) || "We made progress on the current project priorities."}${nextSteps.length ? `\n\nNext up:\n${nextSteps.map((step) => `- ${step}`).join("\n")}` : ""}${signature}` };
  }
}

async function buildPlan(type: HodiCommunicationType, payload: HodiCommunicationPayload, session: AuthSession): Promise<HodiCommunicationPlan> {
  assertCanCommunicate(session);
  const clientId = text(payload.clientId);
  if (!clientId) throw new Error("clientId is required");
  await requireClientAccess(session, clientId);
  const client = await (await getStore()).getClient(clientId);
  if (!client) throw new Error("Client not found");
  const channel = assertChannel(payload.channel);
  const generated = defaults(type, client, payload);
  const details = channelDetails(channel);
  const recipient = text(payload.recipient) || client.primaryContactEmail;
  if (!recipient) throw new Error("A recipient is required");
  return {
    type, client: { id: client.id, name: client.name, companyName: client.companyName, email: client.primaryContactEmail }, channel, recipient,
    subject: channel === "email" ? text(payload.subject) || generated.subject : null,
    body: text(payload.body) || generated.body,
    connection: { required: details.required, available: false, status: details.status },
    approval: { required: true, state: "awaiting_approval" },
    sendEligibility: { eligible: false, reason: "Direct sending is disabled until Boatship has a verified channel-specific sending contract." },
    fallback: details.fallback,
  };
}

function planFromRecord(record: { plan: unknown; approvalToken: string; expiresAt: Date; status: string }): HodiCommunicationPlan {
  const plan = record.plan as unknown as HodiCommunicationPlan;
  return {
    ...plan,
    approval: record.status === "pending"
      ? { required: true, state: "awaiting_approval", token: record.approvalToken, expiresAt: record.expiresAt.toISOString() }
      : { required: true, state: "approved" },
  };
}

export async function proposeHodiCommunication(type: HodiCommunicationType, payload: HodiCommunicationPayload, session: AuthSession) {
  assertType(type);
  const plan = await buildPlan(type, payload, session);
  const approvalToken = randomUUID();
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
  const record = await getPrisma().hodiCommunicationProposal.create({ data: {
    id: randomUUID(), approvalToken, type, channel: plan.channel, recipient: plan.recipient, subject: plan.subject, body: plan.body,
    payload: json(payload), payloadHash: payloadHash(type, payload), plan: json(plan), userId: session.uid, expiresAt,
  } });
  return { proposalId: record.id, plan: planFromRecord(record), outcome: "awaiting_approval" as const };
}

export async function approveHodiCommunication(type: HodiCommunicationType, payload: HodiCommunicationPayload, approvalToken: string, session: AuthSession) {
  assertType(type);
  assertCanCommunicate(session);
  await requireClientAccess(session, text(payload.clientId));
  const db = getPrisma();
  const proposal = await db.hodiCommunicationProposal.findUnique({ where: { approvalToken } });
  if (!proposal || proposal.userId !== session.uid || proposal.type !== type || proposal.payloadHash !== payloadHash(type, payload)) throw new Error("Approval token is missing or does not match this communication draft");
  if (proposal.expiresAt.getTime() <= Date.now()) {
    await db.$executeRaw`UPDATE "HodiCommunicationProposal" SET "status" = 'expired', "updatedAt" = NOW() WHERE "id" = ${proposal.id} AND "status" = 'pending'`;
    throw new Error("Approval token has expired. Create a new draft to review it again.");
  }
  const approved = await db.$executeRaw`UPDATE "HodiCommunicationProposal" SET "status" = 'approved_ready_for_handoff', "approvedBy" = ${session.uid}, "approvedAt" = NOW(), "handoffReadyAt" = NOW(), "updatedAt" = NOW() WHERE "id" = ${proposal.id} AND "status" = 'pending' AND "expiresAt" > NOW()`;
  if (approved !== 1) throw new Error("This communication has already been reviewed");
  const stored = await db.hodiCommunicationProposal.findUniqueOrThrow({ where: { id: proposal.id } });
  return {
    proposalId: stored.id,
    plan: { ...planFromRecord(stored), sendEligibility: { eligible: false, reason: "Approved for handoff only. Boatship has not sent this communication." } },
    outcome: "approved_ready_for_handoff" as const,
  };
}

export async function listHodiCommunicationProposals(session: AuthSession, status?: HodiCommunicationStatus) {
  assertCanCommunicate(session);
  const where = { ...(session.role === "admin" ? {} : { userId: session.uid }), ...(status ? { status } : {}) };
  const records = await getPrisma().hodiCommunicationProposal.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  return records.map((record) => ({
    id: record.id, type: record.type as HodiCommunicationType, channel: record.channel as HodiCommunicationChannel,
    recipient: record.recipient, subject: record.subject, body: record.body, status: record.status as HodiCommunicationStatus,
    userId: record.userId, createdAt: record.createdAt.toISOString(), expiresAt: record.expiresAt.toISOString(),
    approvedBy: record.approvedBy, approvedAt: record.approvedAt?.toISOString() || null,
    handoffReadyAt: record.handoffReadyAt?.toISOString() || null,
  }));
}
