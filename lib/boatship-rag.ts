import type { AuthSession, Client } from "@/types";
import { isStaff } from "@/lib/rbac";
import { getStore } from "@/lib/store";
import { buildHodiClientInsights } from "@/lib/hodi-insights";
import { listAccountingEntries } from "@/lib/accounting";

type KnowledgeChunk = {
  source: string;
  text: string;
  updatedAt?: string;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "for", "from", "has", "have", "how", "in", "is", "it", "of", "on",
  "please", "show", "that", "the", "to", "what", "which", "with", "you",
]);

function terms(value: string) {
  const raw = value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
  return [...new Set(raw.flatMap((term) => (term.endsWith("s") ? [term, term.slice(0, -1)] : [term])))].filter(
    (term) => !STOP_WORDS.has(term)
  );
}

function displayClient(client: Pick<Client, "name" | "companyName">) {
  return `${client.name}${client.companyName ? ` · ${client.companyName}` : ""}`;
}

function clientOrUnknown(client: Client | undefined): Pick<Client, "name" | "companyName"> {
  return client || { name: "Unknown client", companyName: "" };
}

function compact(value: unknown, limit = 500) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function normalizedStatus(value: string | undefined) {
  return (value || "").trim().toLowerCase();
}

function isCompleteStatus(value: string | undefined) {
  return ["approved", "completed", "complete", "done", "reviewed", "published"].includes(
    normalizedStatus(value)
  );
}

function isSubmittedOrPending(value: string | undefined) {
  return ["submitted", "pending", "in_review", "in review", "draft"].includes(
    normalizedStatus(value)
  );
}

function scoreChunk(chunk: KnowledgeChunk, query: string, queryTerms: string[]) {
  const haystack = chunk.text.toLowerCase();
  const directPhrase = query.length > 3 && haystack.includes(query.toLowerCase()) ? 8 : 0;
  const matches = queryTerms.reduce(
    (score, term) => score + (haystack.includes(term) ? 2 : 0),
    0
  );
  const recency = chunk.updatedAt ? Math.max(0, 0.5 - (Date.now() - Date.parse(chunk.updatedAt)) / 3.154e10) : 0;
  return directPhrase + matches + recency;
}

/**
 * Query-time retrieval over data the signed-in staff member can already view.
 * It stays current without copying customer records to a separate index.
 */
export async function retrieveBoatshipKnowledge(query: string, session: AuthSession) {
  if (!isStaff(session.role)) return [] as KnowledgeChunk[];

  const store = await getStore();
  const clients = await store.listClients();
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const [users, tasks, documents, forms, vessels, activity, templates, messages, notifications, accountingEntries] = await Promise.all([
    store.listUsers(),
    store.listAllTasks(),
    store.listAllDocuments(),
    store.listAllForms(),
    Promise.all(clients.map((client) => store.listVessels(client.id))).then((items) => items.flat()),
    store.listAllActivity(),
    store.listTemplates(),
    Promise.all(clients.map((client) => store.listMessages(client.id))).then((items) => items.flat()),
    store.listNotifications(session.uid),
    listAccountingEntries(),
  ]);
  const taskComments = (
    await Promise.all(tasks.map((task) => store.listTaskComments(task.id)))
  ).flat();
  const hodiInsights = await buildHodiClientInsights(session);

  const onboardingChunks: KnowledgeChunk[] = clients.map((client) => {
    const clientTasks = tasks.filter((task) => task.clientId === client.id);
    const clientDocuments = documents.filter((document) => document.clientId === client.id);
    const clientForms = forms.filter((form) => form.clientId === client.id);
    const clientMessages = messages.filter((message) => message.clientId === client.id);
    const openTasks = clientTasks.filter((task) => !isCompleteStatus(task.status));
    const overdueTasks = openTasks.filter(
      (task) => task.dueDate && Date.parse(task.dueDate) < Date.now()
    );
    const pendingDocuments = clientDocuments.filter(
      (document) => !isCompleteStatus(document.status)
    );
    const pendingForms = clientForms.filter((form) => isSubmittedOrPending(form.status));
    const blockers = [
      overdueTasks.length ? `${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"}` : "",
      pendingForms.length ? `${pendingForms.length} form${pendingForms.length === 1 ? "" : "s"} awaiting completion or review` : "",
      pendingDocuments.length ? `${pendingDocuments.length} document${pendingDocuments.length === 1 ? "" : "s"} awaiting review or approval` : "",
      client.pauseReason ? `client paused: ${client.pauseReason}` : "",
    ].filter(Boolean);
    const health = client.pauseReason
      ? "Waiting on client"
      : overdueTasks.length > 0
        ? "Blocked internally"
        : blockers.length > 0
          ? "Needs attention"
          : openTasks.length === 0
            ? "Ready for launch (no known open work)"
            : "On track";
    const nextStep = overdueTasks[0]
      ? `Resolve overdue task: ${overdueTasks[0].title}.`
      : pendingForms.length > 0
        ? "Review or follow up on the oldest outstanding intake item."
        : openTasks[0]?.title || "Confirm launch readiness and handover requirements.";

    return {
      source: `onboarding:${displayClient(client)}`,
      updatedAt: client.updatedAt,
      text: `Onboarding health for ${displayClient(client)}: ${health}. Known blockers: ${blockers.join("; ") || "none recorded"}. Open tasks: ${openTasks.length}/${clientTasks.length}; overdue tasks: ${overdueTasks.length}; documents needing attention: ${pendingDocuments.length}/${clientDocuments.length}; forms needing attention: ${pendingForms.length}/${clientForms.length}; client messages: ${clientMessages.length}. Recommended next step: ${nextStep}`,
    };
  });

  const chunks: KnowledgeChunk[] = [
    ...hodiInsights.map((insight) => ({
      source: `hodi-insight:${insight.profile.clientName}`,
      updatedAt: insight.profile.currentPhase.evidence[0]?.recordedAt,
      text: `Hodi project memory for ${insight.profile.clientName}. Service: ${insight.profile.service.value || "not recorded"}; phase: ${insight.profile.currentPhase.value}; health: ${insight.health.state} (${insight.health.score}/100). Recommendations: ${insight.recommendations.map((item) => item.summary).join(" ")}.`,
    })),
    ...onboardingChunks,
    ...users.map((user) => ({
      source: `staff:${user.name}`,
      updatedAt: user.createdAt,
      text: `Staff member ${user.name}. Email: ${user.email}; role: ${user.role}; permissions: ${user.permissions?.join(", ") || "full role access"}.`,
    })),
    ...clients.map((client) => ({
      source: `client:${displayClient(client)}`,
      updatedAt: client.updatedAt,
      text: `Client ${displayClient(client)}. Status: ${client.status}; pipeline stage: ${client.pipelineStage}; tags: ${client.tags.join(", ") || "none"}; paused: ${client.pauseReason || "no"}.`,
    })),
    ...tasks.map((task) => ({
      source: `task:${task.title}`,
      updatedAt: task.completedAt || task.createdAt,
      text: `Task for ${displayClient(clientOrUnknown(clientById.get(task.clientId)))}: ${task.title}. Status: ${task.status}; priority: ${task.priority}; due: ${task.dueDate || "none"}; overdue: ${task.dueDate && task.status !== "completed" && Date.parse(task.dueDate) < Date.now() ? "yes" : "no"}; section: ${task.section}; description: ${task.description}; notes: ${task.internalNotes}.`,
    })),
    ...documents.map((document) => ({
      source: `document:${document.fileName}`,
      updatedAt: document.uploadedAt,
      text: `Document for ${displayClient(clientOrUnknown(clientById.get(document.clientId)))}: ${document.fileName}. Type: ${document.documentType || document.contentType}; review status: ${document.status}; review note: ${document.reviewNote || "none"}; expires: ${document.expiresAt || "not recorded"}.`,
    })),
    ...forms.map((form) => ({
      source: `form:${form.id}`,
      updatedAt: form.reviewedAt || form.submittedAt || undefined,
      text: `Form for ${displayClient(clientOrUnknown(clientById.get(form.clientId)))}. Status: ${form.status}; responses: ${compact(form.responses)}; risk score: ${form.riskScore ?? "not scored"}; submitted: ${form.submittedAt || "not submitted"}; review note: ${form.reviewNote || "none"}.`,
    })),
    ...vessels.map((vessel) => ({
      source: `vessel:${vessel.name}`,
      updatedAt: vessel.updatedAt,
      text: `Vessel for ${displayClient(clientOrUnknown(clientById.get(vessel.clientId)))}: ${vessel.name}; IMO ${vessel.imo}; flag ${vessel.flag}; type ${vessel.vesselType}; class society ${vessel.classSociety}; notes: ${vessel.notes}.`,
    })),
    ...activity.map((entry) => ({
      source: `activity:${entry.action}`,
      updatedAt: entry.timestamp,
      text: `Activity for ${displayClient(clientOrUnknown(clientById.get(entry.clientId)))}: ${entry.action} by ${entry.actorName} at ${entry.timestamp}. Details: ${compact(entry.meta)}.`,
    })),
    ...templates.map((template) => ({
      source: `template:${template.name}`,
      updatedAt: template.updatedAt,
      text: `Onboarding template ${template.name}. Status: ${template.publishStatus}; industry: ${template.industry || "general"}; description: ${template.description || "none"}; tasks: ${template.taskList.map((task) => task.title).join(", ")}.`,
    })),
    ...messages.map((message) => ({
      source: `message:${message.authorName}`,
      updatedAt: message.createdAt,
      text: `Client message from ${message.authorName} (${message.authorRole}) for ${displayClient(clientOrUnknown(clientById.get(message.clientId)))}: ${message.body}.`,
    })),
    ...taskComments.map((comment) => ({
      source: `comment:${comment.authorName}`,
      updatedAt: comment.createdAt,
      text: `Task comment by ${comment.authorName}: ${comment.body}.`,
    })),
    ...notifications.map((notification) => ({
      source: `notification:${notification.kind}`,
      updatedAt: notification.createdAt,
      text: `Notification: ${notification.title}. ${notification.body}`,
    })),
    ...accountingEntries.map((entry) => ({
      source: `accounting:${entry.title}`,
      updatedAt: entry.updatedAt,
      text: `Accounting entry ${entry.title} for ${entry.month}. Category: ${entry.category}; total: ₹${entry.amount}; paid by: ${entry.paidByName}; division: ${entry.splitMode}; status: ${entry.status}; due: ${entry.dueDate || "not set"}. Amounts: ${entry.splits.map((allocation) => `${allocation.personName} ₹${allocation.amount}, ${allocation.paidAmount >= allocation.amount ? "settled" : "owed"}`).join("; ")}.`,
    })),
  ];

  const queryTerms = terms(query);
  const ranked = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, query, queryTerms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.chunk.updatedAt || "").localeCompare(a.chunk.updatedAt || ""));

  if (ranked.length === 0) {
    return chunks
      .filter((chunk) => chunk.source.startsWith("client:") || chunk.source.startsWith("task:"))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .slice(0, 8);
  }

  return ranked.slice(0, 10).map(({ chunk }) => chunk);
}

export async function buildBoatshipRagContext(query: string, session: AuthSession) {
  const sources = await retrieveBoatshipKnowledge(query, session);
  if (!sources.length) return "No relevant Boatship records were retrieved for this question.";

  return sources
    .map((source, index) => `[${index + 1} | ${source.source}]\n${source.text}`)
    .join("\n\n");
}
