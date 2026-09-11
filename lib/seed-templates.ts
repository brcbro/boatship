import type { FormField, FormTemplate, OnboardingTemplate, TemplateTask } from "@/types";

function task(partial: Omit<TemplateTask, "formTemplateId" | "requiresUpload" | "section"> & { section: string; formTemplateId?: string | null; requiresUpload?: boolean }): TemplateTask {
  return { ...partial, formTemplateId: partial.formTemplateId ?? null, requiresUpload: Boolean(partial.requiresUpload) };
}

function nativeForm(id: string, name: string, description: string, fields: FormField[]): FormTemplate {
  return { id, name, description, mode: "native", googleFormUrl: "", googleFormEmbedUrl: "", fields, createdAt: "", updatedAt: "" };
}

const text = (key: string, label: string, required = true): FormField => ({ key, label, type: "text", required });
const area = (key: string, label: string, required = true): FormField => ({ key, label, type: "textarea", required });
const select = (key: string, label: string, options: string[], required = true): FormField => ({ key, label, type: "dropdown", options, required });

export const SEED_FORM_TEMPLATES: FormTemplate[] = [
  nativeForm("seed_company_form", "Project Discovery Brief", "Tell us about your company, goals, audience, and the services you need.", [
    text("company_name", "Company name"), text("primary_contact", "Primary contact name"),
    { key: "contact_email", label: "Primary contact email", type: "email", required: true },
    select("services", "Services needed", ["Website building", "App building", "Marketing", "Content generation", "Paid ads", "Multiple services"]),
    area("business_goals", "What business outcome should this project achieve?"), area("target_audience", "Who is your target audience?"),
  ]),
  nativeForm("seed_banking_form", "Website Build Brief", "Capture requirements for a conversion-focused website or landing page.", [
    text("website_url", "Current website URL", false), select("website_type", "Website type", ["Business website", "E-commerce store", "Landing page", "Portfolio", "Web application", "Other"]),
    area("pages_needed", "Which pages or sections do you need?"), area("website_features", "Required features or integrations"),
    area("brand_assets", "Share links to your logo, brand guide, copy, and imagery", false), text("domain_access", "Domain or hosting access details", false),
  ]),
  nativeForm("seed_compliance_form", "App Development Brief", "Define the product, users, platforms, and priorities for your app build.", [
    select("app_type", "App type", ["Mobile app", "Web app", "SaaS platform", "Internal tool", "Marketplace", "Other"]), area("problem_to_solve", "What problem should the app solve?"),
    area("core_features", "List the must-have features for the first release"), select("platforms", "Platforms", ["iOS", "Android", "Web", "iOS and Android", "All platforms"]),
    area("integrations", "Required integrations, APIs, or existing systems", false), area("success_metrics", "How will you measure a successful launch?"),
  ]),
  nativeForm("seed_vessel_form", "Marketing, Content and Ads Brief", "Set campaign goals, channels, budget, content needs, and approval contacts.", [
    select("campaign_goal", "Primary goal", ["Leads", "Sales", "Brand awareness", "App installs", "Community growth", "Other"]), select("channels", "Channels", ["Google Ads", "Meta Ads", "LinkedIn", "Instagram", "SEO", "Email", "Multiple channels"]),
    area("offer_and_message", "What are you promoting and what is the key message?"), area("target_audience", "Target audience and locations"), text("monthly_budget", "Monthly advertising budget", false), area("content_needs", "Content deliverables needed", false),
  ]),
];

function stamp(templates: Array<Omit<OnboardingTemplate, "createdAt" | "updatedAt" | "version" | "publishStatus" | "parentTemplateId" | "industry">>): OnboardingTemplate[] {
  return templates.map((template) => ({ ...template, version: 1, publishStatus: "published", parentTemplateId: null, industry: "infotech", createdAt: "", updatedAt: "" }));
}

export const SEED_ONBOARDING_TEMPLATES: OnboardingTemplate[] = stamp([
  { id: "seed_standard", name: "Website Build and Launch", description: "From discovery and UX through development, QA, and launch.", taskList: [
    task({ title: "Complete project discovery brief", type: "client_facing", order: 1, assignedRole: "client", section: "Discovery", formTemplateId: "seed_company_form" }), task({ title: "Complete website build brief", type: "client_facing", order: 2, assignedRole: "client", section: "Discovery", formTemplateId: "seed_banking_form" }),
    task({ title: "Share brand assets and website content", type: "client_facing", order: 3, assignedRole: "client", section: "Assets", requiresUpload: true }), task({ title: "Approve sitemap and design direction", type: "client_facing", order: 4, assignedRole: "client", section: "Design" }),
    task({ title: "Build website and complete QA", type: "internal", order: 5, assignedRole: "team", section: "Development" }), task({ title: "Review staging site and approve launch", type: "client_facing", order: 6, assignedRole: "client", section: "Launch" }),
  ] },
  { id: "seed_quick_start", name: "Marketing Sprint", description: "A focused growth sprint for strategy, creative, launch, and reporting.", taskList: [
    task({ title: "Complete project discovery brief", type: "client_facing", order: 1, assignedRole: "client", section: "Strategy", formTemplateId: "seed_company_form" }), task({ title: "Define campaign goals and KPIs", type: "client_facing", order: 2, assignedRole: "client", section: "Strategy" }),
    task({ title: "Share analytics and channel access", type: "client_facing", order: 3, assignedRole: "client", section: "Access" }), task({ title: "Create sprint plan and campaign assets", type: "internal", order: 4, assignedRole: "team", section: "Production" }), task({ title: "Approve launch plan", type: "client_facing", order: 5, assignedRole: "client", section: "Launch" }),
  ] },
  { id: "seed_enterprise", name: "App Development", description: "A structured product delivery plan for web, mobile, SaaS, and internal applications.", taskList: [
    task({ title: "Complete project discovery brief", type: "client_facing", order: 1, assignedRole: "client", section: "Discovery", formTemplateId: "seed_company_form" }), task({ title: "Complete app development brief", type: "client_facing", order: 2, assignedRole: "client", section: "Discovery", formTemplateId: "seed_compliance_form" }),
    task({ title: "Approve product scope and user journeys", type: "client_facing", order: 3, assignedRole: "client", section: "Planning" }), task({ title: "Design product interface", type: "internal", order: 4, assignedRole: "team", section: "Design" }), task({ title: "Build, test, and prepare beta release", type: "internal", order: 5, assignedRole: "team", section: "Development" }), task({ title: "Review beta and provide launch approval", type: "client_facing", order: 6, assignedRole: "client", section: "Release" }),
  ] },
  { id: "seed_freelancer", name: "Content Studio", description: "For recurring content planning, production, review, and publishing.", taskList: [
    task({ title: "Complete content and campaign brief", type: "client_facing", order: 1, assignedRole: "client", section: "Brief", formTemplateId: "seed_vessel_form" }), task({ title: "Share brand voice, assets, and references", type: "client_facing", order: 2, assignedRole: "client", section: "Assets", requiresUpload: true }),
    task({ title: "Approve content pillars and calendar", type: "client_facing", order: 3, assignedRole: "client", section: "Strategy" }), task({ title: "Create content drafts", type: "internal", order: 4, assignedRole: "team", section: "Production" }), task({ title: "Review and approve content", type: "client_facing", order: 5, assignedRole: "client", section: "Approval" }),
  ] },
  { id: "seed_agency", name: "Paid Ads Campaign", description: "For performance campaigns across Google, Meta, LinkedIn, and other paid channels.", taskList: [
    task({ title: "Complete marketing, content and ads brief", type: "client_facing", order: 1, assignedRole: "client", section: "Campaign setup", formTemplateId: "seed_vessel_form" }), task({ title: "Grant ad account and analytics access", type: "client_facing", order: 2, assignedRole: "client", section: "Access" }),
    task({ title: "Approve campaign strategy and creative", type: "client_facing", order: 3, assignedRole: "client", section: "Creative" }), task({ title: "Configure tracking and launch campaigns", type: "internal", order: 4, assignedRole: "team", section: "Launch" }), task({ title: "Review performance report and next actions", type: "client_facing", order: 5, assignedRole: "client", section: "Optimisation" }),
  ] },
  { id: "seed_compliance", name: "SEO and Performance", description: "Technical SEO, content opportunities, and measurable website performance improvements.", taskList: [
    task({ title: "Complete website build brief", type: "client_facing", order: 1, assignedRole: "client", section: "Audit", formTemplateId: "seed_banking_form" }), task({ title: "Grant analytics and search console access", type: "client_facing", order: 2, assignedRole: "client", section: "Access" }),
    task({ title: "Approve technical and content priorities", type: "client_facing", order: 3, assignedRole: "client", section: "Strategy" }), task({ title: "Implement optimisation plan", type: "internal", order: 4, assignedRole: "team", section: "Implementation" }), task({ title: "Review monthly performance report", type: "client_facing", order: 5, assignedRole: "client", section: "Reporting" }),
  ] },
  { id: "seed_marine", name: "E-commerce Build", description: "Launch a conversion-ready online storefront with payments, products, and marketing foundations.", taskList: [
    task({ title: "Complete project discovery brief", type: "client_facing", order: 1, assignedRole: "client", section: "Discovery", formTemplateId: "seed_company_form" }), task({ title: "Share product catalogue, imagery, and policies", type: "client_facing", order: 2, assignedRole: "client", section: "Assets", requiresUpload: true }),
    task({ title: "Approve store structure and design", type: "client_facing", order: 3, assignedRole: "client", section: "Design" }), task({ title: "Build store, payments, and analytics", type: "internal", order: 4, assignedRole: "team", section: "Development" }), task({ title: "Complete launch review", type: "client_facing", order: 5, assignedRole: "client", section: "Launch" }),
  ] },
  { id: "seed_saas", name: "Digital Growth Retainer", description: "An ongoing plan spanning website optimisation, content, marketing, and advertising.", taskList: [
    task({ title: "Complete project discovery brief", type: "client_facing", order: 1, assignedRole: "client", section: "Planning", formTemplateId: "seed_company_form" }), task({ title: "Complete marketing, content and ads brief", type: "client_facing", order: 2, assignedRole: "client", section: "Planning", formTemplateId: "seed_vessel_form" }),
    task({ title: "Confirm access to tools and reporting", type: "client_facing", order: 3, assignedRole: "client", section: "Access" }), task({ title: "Build the first 90-day growth plan", type: "internal", order: 4, assignedRole: "team", section: "Strategy" }), task({ title: "Approve monthly priorities", type: "client_facing", order: 5, assignedRole: "client", section: "Approval" }),
  ] },
]);
