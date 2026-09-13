import { randomUUID } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { AuthSession } from "@/types";

export const hodiAuthorityLevels = ["Observe", "Draft", "Internal autopilot", "External approved"] as const;
export type HodiAuthorityLevel = (typeof hodiAuthorityLevels)[number];
export type HodiAutomationRule = { id: string; name: string; authority: HodiAuthorityLevel; schedule: string; description: string; output: string; requiresReview: boolean };
export type HodiAutomationReview = { ruleId: string; clientName: string; generatedAt: string; status: "observed" | "ready_for_review"; title: string; summary: string; evidence: string[]; nextStep: string; externalAction: false };
export type HodiAutomationRuleWithState = HodiAutomationRule & { enabled: boolean; updatedAt: string | null; updatedBy: string | null };

export const hodiAutomationRules: readonly HodiAutomationRule[] = [
  { id: "daily-health-scan", name: "Daily health scan", authority: "Observe", schedule: "Every weekday at 9:00 AM", description: "Checks active onboarding work for blockers, overdue tasks, unanswered requests, and launch risks.", output: "A prioritised attention list for the team.", requiresReview: false },
  { id: "missing-assets-follow-up", name: "Missing-assets follow-up", authority: "Draft", schedule: "After assets are missing for 2 days", description: "Prepares a concise client reminder for missing logos, copy, brand files, or product assets.", output: "A reviewable email draft. It is never sent automatically.", requiresReview: true },
  { id: "missing-access-follow-up", name: "Missing-access follow-up", authority: "Draft", schedule: "After requested access is missing for 2 days", description: "Prepares a request for website, analytics, ad-account, hosting, or other required access.", output: "A reviewable email draft. It is never sent automatically.", requiresReview: true },
  { id: "overdue-task-escalation", name: "Overdue-task escalation", authority: "Internal autopilot", schedule: "Every weekday at 10:00 AM", description: "Creates a reviewable internal escalation for overdue work, naming the owner and the delivery risk.", output: "An internal follow-up recommendation; no message is posted automatically.", requiresReview: true },
  { id: "launch-readiness-review", name: "Launch-readiness review", authority: "Observe", schedule: "When a project enters launch preparation", description: "Checks approvals, outstanding tasks, access, deliverables, and known risks before launch.", output: "A launch checklist with confirmed gaps and a recommendation.", requiresReview: true },
  { id: "weekly-client-status-draft", name: "Weekly client status draft", authority: "Draft", schedule: "Every Friday at 3:00 PM", description: "Prepares a clear update covering completed work, current focus, decisions needed, and next milestones.", output: "A reviewable client email draft. It is never sent automatically.", requiresReview: true },
];

const json = (value: unknown) => value as Prisma.InputJsonValue;
export function getHodiAutomationRule(id: string) { return hodiAutomationRules.find((rule) => rule.id === id); }

export function generateHodiAutomationReview(rule: HodiAutomationRule, clientName = "this client"): HodiAutomationReview {
  const reviews: Record<string, Omit<HodiAutomationReview, "ruleId" | "clientName" | "generatedAt" | "externalAction">> = {
    "daily-health-scan": { status: "observed", title: `Daily health scan for ${clientName}`, summary: "Health scan prepared. Review connected project evidence before assigning follow-up work.", evidence: ["Active onboarding work", "Task due dates", "Open client requests", "Pending approvals"], nextStep: "Open the client workspace and review the highest-risk item." },
    "missing-assets-follow-up": { status: "ready_for_review", title: `Missing-assets reminder for ${clientName}`, summary: "A client-ready reminder can be drafted once the missing assets are confirmed.", evidence: ["Required asset checklist", "Uploaded files", "Open asset requests"], nextStep: "Review and edit the draft before sending it through an approved email connection." },
    "missing-access-follow-up": { status: "ready_for_review", title: `Missing-access reminder for ${clientName}`, summary: "A request for outstanding project access can be drafted for review.", evidence: ["Access checklist", "Connected accounts", "Open access requests"], nextStep: "Review and edit the draft before sending it through an approved email connection." },
    "overdue-task-escalation": { status: "ready_for_review", title: `Overdue-work escalation for ${clientName}`, summary: "An internal escalation recommendation is ready to review before it is added to the team work queue.", evidence: ["Overdue tasks", "Assigned owners", "Upcoming milestones"], nextStep: "Confirm the escalation recipient and internal follow-up plan." },
    "launch-readiness-review": { status: "ready_for_review", title: `Launch-readiness review for ${clientName}`, summary: "A review checklist is ready; launch should only proceed after every required item is confirmed.", evidence: ["Launch tasks", "Approvals", "Required access", "Deliverables"], nextStep: "Review gaps with the delivery owner and record a launch decision." },
    "weekly-client-status-draft": { status: "ready_for_review", title: `Weekly status update for ${clientName}`, summary: "A weekly client update can be prepared from this week’s work and upcoming milestones.", evidence: ["Completed tasks", "Current work", "Open decisions", "Upcoming milestones"], nextStep: "Review and edit the update before sending it through an approved email connection." },
  };
  return { ruleId: rule.id, clientName, generatedAt: new Date().toISOString(), externalAction: false, ...reviews[rule.id] };
}

export async function listHodiAutomationRules(): Promise<HodiAutomationRuleWithState[]> {
  const states = await getPrisma().hodiAutomationRuleState.findMany();
  const byRule = new Map(states.map((state) => [state.ruleId, state]));
  return hodiAutomationRules.map((rule) => {
    const state = byRule.get(rule.id);
    return { ...rule, enabled: state?.enabled || false, updatedAt: state?.updatedAt.toISOString() || null, updatedBy: state?.updatedBy || null };
  });
}

export async function setHodiAutomationRuleEnabled(ruleId: string, enabled: boolean, session: AuthSession) {
  if (session.role !== "admin") throw new Error("Only administrators can change automation rule state");
  if (!getHodiAutomationRule(ruleId)) throw new Error("Unknown automation rule");
  const state = await getPrisma().hodiAutomationRuleState.upsert({
    where: { ruleId }, create: { id: randomUUID(), ruleId, enabled, updatedBy: session.uid }, update: { enabled, updatedBy: session.uid },
  });
  return { ruleId: state.ruleId, enabled: state.enabled, updatedAt: state.updatedAt.toISOString(), updatedBy: state.updatedBy };
}

export async function runHodiAutomationReview(ruleId: string, clientName: string, session: AuthSession) {
  const rule = getHodiAutomationRule(ruleId);
  if (!rule) throw new Error("Unknown automation rule");
  const review = generateHodiAutomationReview(rule, clientName);
  const run = await getPrisma().hodiAutomationRun.create({ data: {
    id: randomUUID(), ruleId, clientName, triggeredBy: session.uid, trigger: "manual", status: review.status, review: json(review), externalAction: false,
  } });
  return { runId: run.id, review, note: "This is a persisted review result only. No email, message, calendar event, or external action has been sent." };
}

export async function listHodiAutomationRuns(session: AuthSession, ruleId?: string) {
  const runs = await getPrisma().hodiAutomationRun.findMany({ where: { ...(ruleId ? { ruleId } : {}), ...(session.role === "admin" ? {} : { triggeredBy: session.uid }) }, orderBy: { createdAt: "desc" }, take: 100 });
  return runs.map((run) => ({ id: run.id, ruleId: run.ruleId, clientName: run.clientName, trigger: run.trigger, status: run.status, review: run.review as unknown as HodiAutomationReview, externalAction: run.externalAction, createdAt: run.createdAt.toISOString() }));
}
