import type { FormTemplate, OnboardingTemplate, TemplateTask } from "@/types";
import { toGoogleFormEmbedUrl } from "@/lib/google-forms";

function task(
  partial: Omit<TemplateTask, "formTemplateId" | "requiresUpload" | "section"> & {
    section: string;
    formTemplateId?: string | null;
    requiresUpload?: boolean;
  }
): TemplateTask {
  return {
    ...partial,
    formTemplateId: partial.formTemplateId ?? null,
    requiresUpload: Boolean(partial.requiresUpload),
  };
}

/** Example public Google Form URLs — replace with your org’s real forms in admin. */
const EXAMPLE_COMPANY =
  "https://docs.google.com/forms/d/e/1FAIpQLSdEXAMPLE_COMPANY/viewform";
const EXAMPLE_BANKING =
  "https://docs.google.com/forms/d/e/1FAIpQLSdEXAMPLE_BANKING/viewform";
const EXAMPLE_COMPLIANCE =
  "https://docs.google.com/forms/d/e/1FAIpQLSdEXAMPLE_COMPLIANCE/viewform";
const EXAMPLE_VESSEL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdEXAMPLE_VESSEL/viewform";

function gForm(
  id: string,
  name: string,
  url: string,
  description: string
): FormTemplate {
  return {
    id,
    name,
    description,
    googleFormUrl: url,
    googleFormEmbedUrl: toGoogleFormEmbedUrl(url),
    fields: [],
    createdAt: "",
    updatedAt: "",
  };
}

export const SEED_FORM_TEMPLATES: FormTemplate[] = [
  gForm(
    "seed_company_form",
    "Company Information",
    EXAMPLE_COMPANY,
    "Google Form for legal name, address, tax ID, and industry."
  ),
  gForm(
    "seed_banking_form",
    "Banking & Billing",
    EXAMPLE_BANKING,
    "Google Form for billing contact and payment preferences."
  ),
  gForm(
    "seed_compliance_form",
    "Compliance Questionnaire",
    EXAMPLE_COMPLIANCE,
    "Google Form covering data residency, DPA, and security contacts."
  ),
  gForm(
    "seed_vessel_form",
    "Vessel Profile",
    EXAMPLE_VESSEL,
    "Google Form for vessel name, IMO, type, and flag state."
  ),
];

function stamp(
  templates: Array<
    Omit<
      OnboardingTemplate,
      "createdAt" | "updatedAt" | "version" | "publishStatus" | "parentTemplateId" | "industry"
    > &
      Partial<
        Pick<OnboardingTemplate, "version" | "publishStatus" | "parentTemplateId" | "industry">
      >
  >
): OnboardingTemplate[] {
  return templates.map((t) => ({
    version: t.version ?? 1,
    publishStatus: t.publishStatus ?? "published",
    parentTemplateId: t.parentTemplateId ?? null,
    industry: t.industry ?? null,
    ...t,
    createdAt: "",
    updatedAt: "",
  }));
}

export const SEED_ONBOARDING_TEMPLATES: OnboardingTemplate[] = stamp([
  {
    id: "seed_standard",
    name: "Standard Onboarding",
    description: "Default checklist for most new clients.",
    taskList: [
      task({
        title: "Welcome & account setup",
        description: "Review welcome materials and confirm contact details.",
        type: "client_facing",
        order: 1,
        assignedRole: "client",
        section: "Getting started",
      }),
      task({
        title: "Company information form",
        description: "Complete the Google Form for company profile.",
        type: "client_facing",
        order: 2,
        assignedRole: "client",
        section: "Getting started",
        formTemplateId: "seed_company_form",
      }),
      task({
        title: "Upload signed contract",
        description: "Upload the signed service contract (PDF).",
        type: "client_facing",
        order: 3,
        assignedRole: "client",
        section: "Documents",
        requiresUpload: true,
      }),
      task({
        title: "Upload government ID",
        description: "Upload a valid government-issued ID for the primary contact.",
        type: "client_facing",
        order: 4,
        assignedRole: "client",
        section: "Documents",
        requiresUpload: true,
      }),
      task({
        title: "Schedule kickoff call",
        description: "Confirm a kickoff call time with the assigned team member.",
        type: "client_facing",
        order: 5,
        assignedRole: "client",
        section: "Kickoff",
      }),
      task({
        title: "Internal kickoff prep",
        description: "Prepare internal brief and confirm readiness.",
        type: "internal",
        order: 6,
        assignedRole: "team",
        section: "Kickoff",
      }),
    ],
  },
  {
    id: "seed_quick_start",
    name: "Quick Start",
    description: "Lightweight path for simple engagements.",
    taskList: [
      task({
        title: "Confirm contacts",
        description: "Verify primary and billing contacts.",
        type: "client_facing",
        order: 1,
        assignedRole: "client",
        section: "Basics",
      }),
      task({
        title: "Upload signed agreement",
        type: "client_facing",
        order: 2,
        assignedRole: "client",
        section: "Basics",
        requiresUpload: true,
      }),
      task({
        title: "Share access credentials",
        description: "Send any required portal or tool access.",
        type: "client_facing",
        order: 3,
        assignedRole: "client",
        section: "Access",
      }),
      task({
        title: "Internal handoff note",
        type: "internal",
        order: 4,
        assignedRole: "team",
        section: "Access",
      }),
    ],
  },
  {
    id: "seed_enterprise",
    name: "Enterprise Onboarding",
    description: "Longer path for larger accounts with security and billing.",
    taskList: [
      task({
        title: "Executive sponsor intro",
        type: "client_facing",
        order: 1,
        assignedRole: "client",
        section: "Alignment",
      }),
      task({
        title: "Company information form",
        type: "client_facing",
        order: 2,
        assignedRole: "client",
        section: "Alignment",
        formTemplateId: "seed_company_form",
      }),
      task({
        title: "Stakeholder map",
        description: "List decision makers, day-to-day owners, and escalation contacts.",
        type: "client_facing",
        order: 3,
        assignedRole: "client",
        section: "Alignment",
      }),
      task({
        title: "MSA / contract upload",
        type: "client_facing",
        order: 4,
        assignedRole: "client",
        section: "Legal",
        requiresUpload: true,
      }),
      task({
        title: "NDA upload",
        type: "client_facing",
        order: 5,
        assignedRole: "client",
        section: "Legal",
        requiresUpload: true,
      }),
      task({
        title: "Compliance questionnaire",
        type: "client_facing",
        order: 6,
        assignedRole: "client",
        section: "Security",
        formTemplateId: "seed_compliance_form",
      }),
      task({
        title: "Security review (internal)",
        type: "internal",
        order: 7,
        assignedRole: "team",
        section: "Security",
      }),
      task({
        title: "Banking & billing form",
        type: "client_facing",
        order: 8,
        assignedRole: "client",
        section: "Billing",
        formTemplateId: "seed_banking_form",
      }),
      task({
        title: "Kickoff workshop scheduled",
        type: "client_facing",
        order: 9,
        assignedRole: "client",
        section: "Launch",
      }),
      task({
        title: "Success plan drafted",
        type: "internal",
        order: 10,
        assignedRole: "team",
        section: "Launch",
      }),
    ],
  },
  {
    id: "seed_freelancer",
    name: "Freelancer / Solo",
    description: "For individual contractors and solo operators.",
    taskList: [
      task({
        title: "Profile & contact details",
        type: "client_facing",
        order: 1,
        assignedRole: "client",
        section: "Profile",
        formTemplateId: "seed_company_form",
      }),
      task({
        title: "Upload ID",
        type: "client_facing",
        order: 2,
        assignedRole: "client",
        section: "Profile",
        requiresUpload: true,
      }),
      task({
        title: "Upload W-9 / tax form",
        type: "client_facing",
        order: 3,
        assignedRole: "client",
        section: "Tax",
        requiresUpload: true,
      }),
      task({
        title: "Payment details",
        type: "client_facing",
        order: 4,
        assignedRole: "client",
        section: "Tax",
        formTemplateId: "seed_banking_form",
      }),
      task({
        title: "Contractor agreement",
        type: "client_facing",
        order: 5,
        assignedRole: "client",
        section: "Agreement",
        requiresUpload: true,
      }),
      task({
        title: "Internal vetting checklist",
        type: "internal",
        order: 6,
        assignedRole: "team",
        section: "Agreement",
      }),
    ],
  },
  {
    id: "seed_agency",
    name: "Agency Partner",
    description: "Onboard marketing/creative agencies as partners.",
    taskList: [
      task({
        title: "Agency profile",
        type: "client_facing",
        order: 1,
        assignedRole: "client",
        section: "Partner setup",
        formTemplateId: "seed_company_form",
      }),
      task({
        title: "Brand assets upload",
        description: "Logo pack, fonts, and brand guidelines.",
        type: "client_facing",
        order: 2,
        assignedRole: "client",
        section: "Partner setup",
        requiresUpload: true,
      }),
      task({
        title: "Partner agreement",
        type: "client_facing",
        order: 3,
        assignedRole: "client",
        section: "Legal",
        requiresUpload: true,
      }),
      task({
        title: "Tooling access requests",
        description: "List tools needed (Drive, Slack, analytics, etc.).",
        type: "client_facing",
        order: 4,
        assignedRole: "client",
        section: "Access",
      }),
      task({
        title: "Provision partner seats",
        type: "internal",
        order: 5,
        assignedRole: "team",
        section: "Access",
      }),
      task({
        title: "Partner kickoff call",
        type: "client_facing",
        order: 6,
        assignedRole: "client",
        section: "Kickoff",
      }),
    ],
  },
  {
    id: "seed_compliance",
    name: "Compliance-Heavy",
    description: "For regulated industries needing extra documentation.",
    taskList: [
      task({
        title: "Company information",
        type: "client_facing",
        order: 1,
        assignedRole: "client",
        section: "Identity",
        formTemplateId: "seed_company_form",
      }),
      task({
        title: "Compliance questionnaire",
        type: "client_facing",
        order: 2,
        assignedRole: "client",
        section: "Identity",
        formTemplateId: "seed_compliance_form",
      }),
      task({
        title: "Upload certificate of incorporation",
        type: "client_facing",
        order: 3,
        assignedRole: "client",
        section: "Evidence",
        requiresUpload: true,
      }),
      task({
        title: "Upload insurance certificate",
        type: "client_facing",
        order: 4,
        assignedRole: "client",
        section: "Evidence",
        requiresUpload: true,
      }),
      task({
        title: "Upload beneficial ownership docs",
        type: "client_facing",
        order: 5,
        assignedRole: "client",
        section: "Evidence",
        requiresUpload: true,
      }),
      task({
        title: "Legal review",
        type: "internal",
        order: 6,
        assignedRole: "team",
        section: "Review",
      }),
      task({
        title: "Compliance approval",
        type: "internal",
        order: 7,
        assignedRole: "admin",
        section: "Review",
      }),
      task({
        title: "Client confirmation call",
        type: "client_facing",
        order: 8,
        assignedRole: "client",
        section: "Review",
      }),
    ],
  },
  {
    id: "seed_marine",
    name: "Marine / Vessel Client",
    description: "Boatship-oriented onboarding for vessel operators.",
    taskList: [
      task({
        title: "Operator welcome",
        type: "client_facing",
        order: 1,
        assignedRole: "client",
        section: "Fleet intake",
      }),
      task({
        title: "Company information",
        type: "client_facing",
        order: 2,
        assignedRole: "client",
        section: "Fleet intake",
        formTemplateId: "seed_company_form",
      }),
      task({
        title: "Vessel profile form",
        type: "client_facing",
        order: 3,
        assignedRole: "client",
        section: "Fleet intake",
        formTemplateId: "seed_vessel_form",
      }),
      task({
        title: "Upload registry certificate",
        type: "client_facing",
        order: 4,
        assignedRole: "client",
        section: "Certificates",
        requiresUpload: true,
      }),
      task({
        title: "Upload insurance / P&I",
        type: "client_facing",
        order: 5,
        assignedRole: "client",
        section: "Certificates",
        requiresUpload: true,
      }),
      task({
        title: "Upload crew manifest sample",
        type: "client_facing",
        order: 6,
        assignedRole: "client",
        section: "Certificates",
        requiresUpload: true,
      }),
      task({
        title: "Ops review",
        type: "internal",
        order: 7,
        assignedRole: "team",
        section: "Go-live",
      }),
      task({
        title: "Schedule sea-trial / kickoff",
        type: "client_facing",
        order: 8,
        assignedRole: "client",
        section: "Go-live",
      }),
    ],
  },
  {
    id: "seed_saas",
    name: "SaaS Product Onboarding",
    description: "Software rollout with integrations and admin setup.",
    taskList: [
      task({
        title: "Workspace owner designated",
        type: "client_facing",
        order: 1,
        assignedRole: "client",
        section: "Setup",
      }),
      task({
        title: "Company profile",
        type: "client_facing",
        order: 2,
        assignedRole: "client",
        section: "Setup",
        formTemplateId: "seed_company_form",
      }),
      task({
        title: "SSO / identity preferences",
        type: "client_facing",
        order: 3,
        assignedRole: "client",
        section: "Integrations",
      }),
      task({
        title: "Upload logo & brand kit",
        type: "client_facing",
        order: 4,
        assignedRole: "client",
        section: "Integrations",
        requiresUpload: true,
      }),
      task({
        title: "Integration checklist (internal)",
        type: "internal",
        order: 5,
        assignedRole: "team",
        section: "Integrations",
      }),
      task({
        title: "Admin training scheduled",
        type: "client_facing",
        order: 6,
        assignedRole: "client",
        section: "Enablement",
      }),
      task({
        title: "Go-live checklist signed off",
        type: "client_facing",
        order: 7,
        assignedRole: "client",
        section: "Enablement",
      }),
    ],
  },
]);
