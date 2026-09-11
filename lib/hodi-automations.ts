export const hodiAuthorityLevels = [
  "Observe",
  "Draft",
  "Internal autopilot",
  "External approved",
] as const;

export type HodiAuthorityLevel = (typeof hodiAuthorityLevels)[number];

export type HodiAutomationRule = {
  id: string;
  name: string;
  authority: HodiAuthorityLevel;
  schedule: string;
  description: string;
  output: string;
  requiresReview: boolean;
};

export type HodiAutomationReview = {
  ruleId: string;
  clientName: string;
  generatedAt: string;
  status: "observed" | "ready_for_review";
  title: string;
  summary: string;
  evidence: string[];
  nextStep: string;
  externalAction: false;
};

export const hodiAutomationRules: readonly HodiAutomationRule[] = [
  {
    id: "daily-health-scan",
    name: "Daily health scan",
    authority: "Observe",
    schedule: "Every weekday at 9:00 AM",
    description: "Checks active onboarding work for blockers, overdue tasks, unanswered requests, and launch risks.",
    output: "A prioritised attention list for the team.",
    requiresReview: false,
  },
  {
    id: "missing-assets-follow-up",
    name: "Missing-assets follow-up",
    authority: "Draft",
    schedule: "After assets are missing for 2 days",
    description: "Prepares a concise client reminder for missing logos, copy, brand files, or product assets.",
    output: "A reviewable email draft. It is never sent automatically.",
    requiresReview: true,
  },
  {
    id: "missing-access-follow-up",
    name: "Missing-access follow-up",
    authority: "Draft",
    schedule: "After requested access is missing for 2 days",
    description: "Prepares a request for website, analytics, ad-account, hosting, or other required access.",
    output: "A reviewable email draft. It is never sent automatically.",
    requiresReview: true,
  },
  {
    id: "overdue-task-escalation",
    name: "Overdue-task escalation",
    authority: "Internal autopilot",
    schedule: "Every weekday at 10:00 AM",
    description: "Creates a reviewable internal escalation for overdue work, naming the owner and the delivery risk.",
    output: "An internal follow-up recommendation; no message is posted automatically.",
    requiresReview: true,
  },
  {
    id: "launch-readiness-review",
    name: "Launch-readiness review",
    authority: "Observe",
    schedule: "When a project enters launch preparation",
    description: "Checks approvals, outstanding tasks, access, deliverables, and known risks before launch.",
    output: "A launch checklist with confirmed gaps and a recommendation.",
    requiresReview: true,
  },
  {
    id: "weekly-client-status-draft",
    name: "Weekly client status draft",
    authority: "Draft",
    schedule: "Every Friday at 3:00 PM",
    description: "Prepares a clear update covering completed work, current focus, decisions needed, and next milestones.",
    output: "A reviewable client email draft. It is never sent automatically.",
    requiresReview: true,
  },
];

export function getHodiAutomationRule(id: string) {
  return hodiAutomationRules.find((rule) => rule.id === id);
}

export function generateHodiAutomationReview(
  rule: HodiAutomationRule,
  clientName = "this client"
): HodiAutomationReview {
  const generatedAt = new Date().toISOString();
  const reviews: Record<string, Omit<HodiAutomationReview, "ruleId" | "clientName" | "generatedAt" | "externalAction">> = {
    "daily-health-scan": {
      status: "observed",
      title: `Daily health scan for ${clientName}`,
      summary: "Health scan prepared. Review connected project evidence before assigning follow-up work.",
      evidence: ["Active onboarding work", "Task due dates", "Open client requests", "Pending approvals"],
      nextStep: "Open the client workspace and review the highest-risk item.",
    },
    "missing-assets-follow-up": {
      status: "ready_for_review",
      title: `Missing-assets reminder for ${clientName}`,
      summary: "A client-ready reminder can be drafted once the missing assets are confirmed.",
      evidence: ["Required asset checklist", "Uploaded files", "Open asset requests"],
      nextStep: "Review and edit the draft before sending it through an approved email connection.",
    },
    "missing-access-follow-up": {
      status: "ready_for_review",
      title: `Missing-access reminder for ${clientName}`,
      summary: "A request for outstanding project access can be drafted for review.",
      evidence: ["Access checklist", "Connected accounts", "Open access requests"],
      nextStep: "Review and edit the draft before sending it through an approved email connection.",
    },
    "overdue-task-escalation": {
      status: "ready_for_review",
      title: `Overdue-work escalation for ${clientName}`,
      summary: "An internal escalation recommendation is ready to review before it is added to the team work queue.",
      evidence: ["Overdue tasks", "Assigned owners", "Upcoming milestones"],
      nextStep: "Confirm the escalation recipient and internal follow-up plan.",
    },
    "launch-readiness-review": {
      status: "ready_for_review",
      title: `Launch-readiness review for ${clientName}`,
      summary: "A review checklist is ready; launch should only proceed after every required item is confirmed.",
      evidence: ["Launch tasks", "Approvals", "Required access", "Deliverables"],
      nextStep: "Review gaps with the delivery owner and record a launch decision.",
    },
    "weekly-client-status-draft": {
      status: "ready_for_review",
      title: `Weekly status update for ${clientName}`,
      summary: "A weekly client update can be prepared from this week’s work and upcoming milestones.",
      evidence: ["Completed tasks", "Current work", "Open decisions", "Upcoming milestones"],
      nextStep: "Review and edit the update before sending it through an approved email connection.",
    },
  };

  return {
    ruleId: rule.id,
    clientName,
    generatedAt,
    externalAction: false,
    ...reviews[rule.id],
  };
}
