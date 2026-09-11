export type HodiWorkflowMode = "read" | "draft" | "action";
export type HodiConnectionState = "connected" | "unavailable" | "unknown";

export type HodiWorkflow = {
  id: string;
  name: string;
  description: string;
  requiredConnection: string;
  mode: HodiWorkflowMode;
  requiresConfirmation: boolean;
  safeOutcome: string;
  unavailableMessage: string;
};

export type HodiWorkflowPlan = HodiWorkflow & {
  connectionState: HodiConnectionState;
  executable: false;
  status: "ready_for_review" | "unavailable" | "connection_unknown";
  nextStep: string;
};

export const hodiWorkflows: readonly HodiWorkflow[] = [
  {
    id: "drive-project-assets",
    name: "Prepare Drive project folders and asset checklist",
    description: "Plans a standard client folder structure and identifies the assets to request or organize.",
    requiredConnection: "googledrive",
    mode: "action",
    requiresConfirmation: true,
    safeOutcome: "A reviewable folder and asset plan; creating or moving files needs a separate confirmed execution.",
    unavailableMessage: "Google Drive is not connected. Hodi can still provide the folder structure as a checklist.",
  },
  {
    id: "gmail-follow-up-draft",
    name: "Draft a client follow-up",
    description: "Prepares a follow-up for missing assets, access, approvals, kickoff scheduling, or overdue work.",
    requiredConnection: "gmail",
    mode: "draft",
    requiresConfirmation: false,
    safeOutcome: "A reviewable email draft only; it is never sent by this workflow.",
    unavailableMessage: "Gmail is not connected. Hodi can provide copy-ready follow-up text instead.",
  },
  {
    id: "gmail-thread-summary",
    name: "Summarize client email threads",
    description: "Plans a summary of client decisions, open questions, commitments, and approval requests from email.",
    requiredConnection: "gmail",
    mode: "read",
    requiresConfirmation: false,
    safeOutcome: "A read-only summary with decisions and follow-up items.",
    unavailableMessage: "Gmail is not connected. Hodi can summarize email content pasted into the conversation.",
  },
  {
    id: "calendar-meeting-options",
    name: "Draft kickoff, review, or launch meeting options",
    description: "Prepares meeting options and an invitation draft without placing anything on a calendar.",
    requiredConnection: "google_calendar",
    mode: "draft",
    requiresConfirmation: false,
    safeOutcome: "A reviewable meeting-options draft only; no event is created.",
    unavailableMessage: "Google Calendar is not connected. Hodi can provide suggested time slots for manual scheduling.",
  },
  {
    id: "slack-blocker-alert",
    name: "Prepare an internal blocker alert",
    description: "Creates a concise internal alert with the blocker, owner, due date, and requested decision.",
    requiredConnection: "slack",
    mode: "action",
    requiresConfirmation: true,
    safeOutcome: "A previewable Slack alert; posting requires a separate confirmed execution.",
    unavailableMessage: "Slack is not connected. Hodi can provide the alert text for manual posting.",
  },
  {
    id: "figma-review-tracking",
    name: "Track Figma review links and approval state",
    description: "Plans a review record using provided Figma links and keeps approval status ready for team review.",
    requiredConnection: "figma",
    mode: "read",
    requiresConfirmation: false,
    safeOutcome: "A read-only review-link and approval-status summary.",
    unavailableMessage: "Figma is not connected. Hodi can track links and approval notes entered in Boatship.",
  },
  {
    id: "github-release-readiness",
    name: "Summarize GitHub release readiness",
    description: "Plans a read-only release summary for open pull requests, issues, and release risks.",
    requiredConnection: "github",
    mode: "read",
    requiresConfirmation: false,
    safeOutcome: "A read-only release-readiness summary with unresolved risks.",
    unavailableMessage: "GitHub is not connected. Hodi can assess release readiness from links or notes supplied by the team.",
  },
  {
    id: "ads-performance-summary",
    name: "Summarize paid ads performance",
    description: "Plans a performance summary and anomaly review for Google Ads or Meta Ads data.",
    requiredConnection: "ads_platform",
    mode: "read",
    requiresConfirmation: false,
    safeOutcome: "A read-only performance summary; campaigns and budgets are never changed.",
    unavailableMessage: "No ads platform is connected. Hodi can summarize exported campaign metrics instead.",
  },
  {
    id: "crm-deal-handoff",
    name: "Prepare a CRM deal-to-onboarding handoff",
    description: "Builds a reviewable handoff plan from a won deal into a client onboarding record.",
    requiredConnection: "crm",
    mode: "action",
    requiresConfirmation: true,
    safeOutcome: "A reviewable handoff plan; creating a client or changing CRM data needs a separate confirmed execution.",
    unavailableMessage: "No CRM is connected. Hodi can prepare a manual handoff checklist from discovery notes.",
  },
];

export function getHodiWorkflow(id: string) {
  return hodiWorkflows.find((workflow) => workflow.id === id);
}

export function planHodiWorkflow(
  workflow: HodiWorkflow,
  availableConnections?: readonly string[]
): HodiWorkflowPlan {
  const connectionState: HodiConnectionState = availableConnections
    ? availableConnections.includes(workflow.requiredConnection)
      ? "connected"
      : "unavailable"
    : "unknown";

  if (connectionState === "unavailable") {
    return {
      ...workflow,
      connectionState,
      executable: false,
      status: "unavailable",
      nextStep: workflow.unavailableMessage,
    };
  }

  return {
    ...workflow,
    connectionState,
    executable: false,
    status: connectionState === "connected" ? "ready_for_review" : "connection_unknown",
    nextStep:
      connectionState === "connected"
        ? workflow.requiresConfirmation
          ? "Review the plan, then request explicit confirmation before any external action."
          : "Review the generated draft or read-only summary before using it."
        : "Confirm the required connection before preparing this workflow.",
  };
}
