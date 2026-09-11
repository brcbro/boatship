import { evaluateOnboardingHealth, type OnboardingBlocker } from "@/lib/onboarding-health";
import { getStore } from "@/lib/store";
import type { AppUser, AuthSession, Client, DocumentRecord, FormSubmission, OnboardingTemplate, Task } from "@/types";

export type HodiEvidence = {
  source: string;
  label: string;
  recordedAt?: string;
};

export type HodiRecommendation = {
  kind: "blocker" | "next_action" | "risk" | "launch_approval";
  summary: string;
  owner: "client" | "team" | "unassigned";
  evidence: HodiEvidence[];
};

export type HodiClientProfile = {
  clientId: string;
  clientName: string;
  service: { value: string | null; evidence: HodiEvidence[] };
  goals: { value: string | null; evidence: HodiEvidence[] };
  audience: { value: string | null; evidence: HodiEvidence[] };
  budget: { value: string | null; evidence: HodiEvidence[] };
  deadline: { value: string | null; evidence: HodiEvidence[] };
  brandAssets: Array<{ name: string; type: string; status: string; evidence: HodiEvidence }>;
  currentPhase: { value: string; evidence: HodiEvidence[] };
  decisionsAndApprovals: Array<{ summary: string; evidence: HodiEvidence }>;
  connectedAccess: Array<{ name: string; status: "recorded" | "missing"; evidence: HodiEvidence }>;
};

export type HodiClientInsight = {
  profile: HodiClientProfile;
  health: { state: string; score: number };
  recommendations: HodiRecommendation[];
};

const ACCESS_PATTERN = /access|login|credential|account|permission|invite/i;
const DECISION_PATTERN = /decision|approved|approval|signoff|signed|confirmed/i;
const FIELD_ALIASES: Record<"goals" | "audience" | "budget" | "deadline", RegExp> = {
  goals: /goal|objective|outcome|success/i,
  audience: /audience|customer|persona|target market/i,
  budget: /budget|spend|investment|price/i,
  deadline: /deadline|launch date|go live|target date|due date/i,
};

function clientLabel(client: Client) {
  return client.companyName || client.name;
}

function fieldValue(client: Client, field: keyof typeof FIELD_ALIASES) {
  const match = Object.entries(client.customFields || {}).find(([key, value]) =>
    FIELD_ALIASES[field].test(key) && String(value).trim()
  );
  return match
    ? { value: String(match[1]), evidence: [{ source: "Client details", label: match[0], recordedAt: client.updatedAt }] }
    : { value: null, evidence: [] };
}

function ownerFor(task: Task) {
  return task.assignedRole === "client" || task.type === "client_facing" ? "client" as const : task.assignedTo ? "team" as const : "unassigned" as const;
}

function blockerRecommendation(blocker: OnboardingBlocker, taskById: Map<string, Task>): HodiRecommendation {
  const task = blocker.taskId ? taskById.get(blocker.taskId) : undefined;
  const verb = blocker.kind === "approval" ? "Review" : blocker.kind === "overdue_task" ? "Resolve overdue" : "Unblock";
  return {
    kind: "blocker",
    summary: `${verb}: ${blocker.label}.`,
    owner: blocker.owner,
    evidence: [{ source: task ? "Task" : "Onboarding health", label: task?.title || blocker.label, recordedAt: task?.createdAt }],
  };
}

function deadlineFromTasks(tasks: Task[], client: Client) {
  const recorded = fieldValue(client, "deadline");
  if (recorded.value) return recorded;
  const next = tasks.filter((task) => task.status !== "completed" && task.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  return next
    ? { value: next.dueDate, evidence: [{ source: "Task", label: `Earliest open due date: ${next.title}`, recordedAt: next.createdAt }] }
    : recorded;
}

function buildProfile(input: {
  client: Client;
  template: OnboardingTemplate | undefined;
  tasks: Task[];
  documents: DocumentRecord[];
  forms: FormSubmission[];
  activity: Awaited<ReturnType<Awaited<ReturnType<typeof getStore>>["listActivity"]>>;
  users: AppUser[];
}): HodiClientProfile {
  const { client, template, tasks, documents, forms, activity, users } = input;
  const completedOrApproved = [
    ...documents.filter((item) => item.status === "approved").map((item) => ({ summary: `Approved document: ${item.fileName}`, evidence: { source: "Document", label: item.fileName, recordedAt: item.uploadedAt } })),
    ...forms.filter((item) => item.status === "reviewed").map((item) => ({ summary: `Reviewed intake form`, evidence: { source: "Form", label: item.id, recordedAt: item.reviewedAt || undefined } })),
    ...activity.filter((item) => DECISION_PATTERN.test(`${item.action} ${JSON.stringify(item.meta)}`)).slice(0, 6).map((item) => ({ summary: item.action, evidence: { source: "Activity", label: item.action, recordedAt: item.timestamp } })),
  ].slice(0, 10);
  const accessTasks = tasks.filter((task) => ACCESS_PATTERN.test(`${task.title} ${task.description} ${task.internalNotes}`));
  const access = [
    ...(client.driveFolderUrl ? [{ name: "Google Drive folder", status: "recorded" as const, evidence: { source: "Client details", label: "Drive folder URL", recordedAt: client.updatedAt } }] : []),
    ...accessTasks.map((task) => ({ name: task.title, status: task.status === "completed" ? "recorded" as const : "missing" as const, evidence: { source: "Task", label: task.title, recordedAt: task.createdAt } })),
  ];
  const owner = client.assignedTeamMemberId ? users.find((user) => user.uid === client.assignedTeamMemberId) : undefined;
  const phaseLabel = client.pipelineStage.replaceAll("_", " ");
  return {
    clientId: client.id,
    clientName: clientLabel(client),
    service: template
      ? { value: template.name, evidence: [{ source: "Playbook", label: template.name, recordedAt: template.updatedAt }] }
      : { value: client.tags[0] || null, evidence: client.tags[0] ? [{ source: "Client details", label: "First client tag", recordedAt: client.updatedAt }] : [] },
    goals: fieldValue(client, "goals"),
    audience: fieldValue(client, "audience"),
    budget: fieldValue(client, "budget"),
    deadline: deadlineFromTasks(tasks, client),
    brandAssets: documents.filter((item) => /brand|logo|style|asset|design/i.test(`${item.fileName} ${item.documentType || ""}`)).slice(0, 10).map((item) => ({ name: item.fileName, type: item.documentType || item.contentType, status: item.status, evidence: { source: "Document", label: item.fileName, recordedAt: item.uploadedAt } })),
    currentPhase: { value: `${phaseLabel}${owner ? ` · owner: ${owner.name}` : " · owner not assigned"}`, evidence: [{ source: "Client details", label: "Pipeline stage and assigned owner", recordedAt: client.updatedAt }] },
    decisionsAndApprovals: completedOrApproved,
    connectedAccess: access,
  };
}

export async function buildHodiClientInsights(session: AuthSession, clientId?: string): Promise<HodiClientInsight[]> {
  const store = await getStore();
  const clients = clientId ? [await store.getClient(clientId)].filter(Boolean) as Client[] : await store.listClients();
  const [users, templates] = await Promise.all([store.listUsers(), store.listTemplates()]);
  return Promise.all(clients.map(async (client) => {
    const [tasks, documents, forms, activity] = await Promise.all([store.listTasks(client.id), store.listDocuments(client.id), store.listForms(client.id), store.listActivity(client.id)]);
    const health = evaluateOnboardingHealth(client, tasks, forms, documents);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const recommendations: HodiRecommendation[] = health.blockers.map((blocker) => blockerRecommendation(blocker, taskById));
    const nextTask = tasks.find((task) => task.status !== "completed" && task.status !== "blocked");
    if (nextTask) recommendations.push({ kind: "next_action", summary: `Next action: ${nextTask.title}.`, owner: ownerFor(nextTask), evidence: [{ source: "Task", label: nextTask.title, recordedAt: nextTask.createdAt }] });
    const risk = health.overdueTaskCount > 0 || health.blockers.some((blocker) => blocker.kind === "blocked_task") ? "High risk of delay" : health.blockers.length ? "Moderate risk: unresolved onboarding work" : "Low known risk";
    recommendations.push({ kind: "risk", summary: risk, owner: "team", evidence: health.blockers.length ? health.blockers.map((blocker) => ({ source: "Onboarding health", label: blocker.label })) : [{ source: "Onboarding health", label: "No recorded blockers" }] });
    for (const blocker of health.blockers.filter((item) => item.kind === "approval")) recommendations.push({ kind: "launch_approval", summary: `Launch approval needed: ${blocker.label}.`, owner: "team", evidence: [{ source: "Onboarding health", label: blocker.label }] });
    return { profile: buildProfile({ client, template: templates.find((template) => template.id === client.templateId), tasks, documents, forms, activity, users }), health: { state: health.state, score: health.score }, recommendations };
  }));
}
