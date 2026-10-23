"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/shared/AuthProvider";
import { Button, Card, Dropdown, Input, Label } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { isValidEmail } from "@/lib/form-fields";
import { discardSessionDraft, readSessionDraft, sessionDraftKey, writeSessionDraft } from "@/lib/session-drafts";
import type { ClientWithProgress, OnboardingTemplate } from "@/types";

type TeamUser = { uid: string; name: string; email: string; role: string };
type Service = "website" | "app" | "marketing" | "content" | "ads" | "ecommerce";
type IntakeDraft = {
  step: number;
  service: Service;
  name: string;
  companyName: string;
  email: string;
  projectGoal: string;
  website: string;
  timeline: string;
  assignee: string;
  templateId: string;
};

const services: { id: Service; title: string; description: string; keywords: string[] }[] = [
  { id: "website", title: "Website", description: "Websites, landing pages, and redesigns.", keywords: ["website", "web", "seo"] },
  { id: "app", title: "App", description: "Web, mobile, SaaS, and product builds.", keywords: ["app", "product", "software"] },
  { id: "marketing", title: "Marketing", description: "Strategy, growth, and campaign planning.", keywords: ["marketing", "growth", "brand"] },
  { id: "content", title: "Content", description: "Content systems, creative, and social media.", keywords: ["content", "social", "creative"] },
  { id: "ads", title: "Paid ads", description: "Google, Meta, and performance advertising.", keywords: ["ads", "paid", "campaign"] },
  { id: "ecommerce", title: "E-commerce", description: "Stores, catalogues, and conversion work.", keywords: ["e-commerce", "ecommerce", "shop", "store"] },
];

function emptyDraft(assignee: string): IntakeDraft {
  return { step: 1, service: "website", name: "", companyName: "", email: "", projectGoal: "", website: "", timeline: "", assignee, templateId: "" };
}

function decodeDraft(value: unknown): IntakeDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  if (![1, 2, 3].includes(draft.step as number) || !services.some((item) => item.id === draft.service)) return null;
  const fields = ["name", "companyName", "email", "projectGoal", "website", "timeline", "assignee", "templateId"] as const;
  if (fields.some((key) => typeof draft[key] !== "string" || (draft[key] as string).length > 2000)) return null;
  return draft as unknown as IntakeDraft;
}

function briefErrors(draft: IntakeDraft) {
  const errors: Record<string, string> = {};
  if (!draft.name.trim()) errors.name = "Enter the contact name.";
  if (!draft.companyName.trim()) errors.companyName = "Enter the company name.";
  if (!isValidEmail(draft.email)) errors.email = "Enter a valid primary contact email.";
  return errors;
}

export function IntakeWizard({ token, users, templates, defaultAssigneeId }: { token: string | null; users: TeamUser[]; templates: OnboardingTemplate[]; defaultAssigneeId: string }) {
  const router = useRouter();
  const { session } = useAuth();
  const [draft, setDraft] = useState<IntakeDraft>(() => emptyDraft(defaultAssigneeId));
  const [readyUserId, setReadyUserId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState("");
  const [draftPersisted, setDraftPersisted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(false);
  const userId = session?.uid || "";
  const storageKey = sessionDraftKey({ userId, area: "intake", resourceId: "new-client" });
  const { step, service, name, companyName, email, projectGoal, website, timeline, assignee, templateId } = draft;
  const hasDraft = !created && Boolean(name || companyName || email || projectGoal || website || timeline || templateId || service !== "website" || assignee !== defaultAssigneeId);

  useEffect(() => {
    if (!userId || readyUserId === userId) return;
    const timer = setTimeout(() => {
      const saved = readSessionDraft(storageKey, decodeDraft);
      const restored = saved?.value || emptyDraft(defaultAssigneeId);
      // A removed playbook or staff member must not remain a hidden selection.
      if (restored.templateId && !templates.some((item) => item.id === restored.templateId)) restored.templateId = "";
      if (restored.assignee && !users.some((item) => item.uid === restored.assignee)) restored.assignee = defaultAssigneeId;
      setDraft(restored);
      setDraftPersisted(Boolean(saved));
      setDraftStatus(saved ? "Draft restored. It stays in this tab for up to 24 hours and clears on sign-out." : "");
      setReadyUserId(userId);
    }, 0);
    return () => clearTimeout(timer);
  }, [userId, readyUserId, storageKey, defaultAssigneeId, users, templates]);

  useEffect(() => {
    if (!hasDraft) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDraft]);

  const suggestedTemplate = useMemo(() => {
    const match = services.find((item) => item.id === service)!;
    return templates.find((template) => {
      const label = `${template.name} ${template.description || ""}`.toLowerCase();
      return match.keywords.some((keyword) => label.includes(keyword));
    }) || templates[0];
  }, [service, templates]);
  const resolvedTemplateId = templateId || suggestedTemplate?.id || "";

  function updateDraft(changes: Partial<IntakeDraft>) {
    if (saving || created) return;
    const next = { ...draft, ...changes };
    setDraft(next);
    setFieldErrors((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !Object.hasOwn(changes, key))));
    const saved = writeSessionDraft(storageKey, next);
    setDraftPersisted((previous) => previous || saved);
    setDraftStatus(saved ? "Draft saved in this tab. It expires after 24 hours and clears on sign-out." : "Browser draft storage is unavailable. Copy your brief before leaving this page.");
  }

  function continueToPlan() {
    const errors = briefErrors(draft);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      document.getElementById(`intake-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    updateDraft({ step: 3 });
  }

  function discardDraft() {
    if (!window.confirm("Discard this client brief and start again?")) return;
    const removed = discardSessionDraft(storageKey);
    if (!removed && draftPersisted) {
      setError("Couldn’t remove the saved brief. Try again before leaving.");
      return;
    }
    setDraft(emptyDraft(defaultAssigneeId));
    setFieldErrors({});
    setError("");
    setDraftPersisted(false);
    setDraftStatus("Draft discarded.");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || created || step !== 3) return;
    const errors = briefErrors(draft);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      updateDraft({ step: 2 });
      setError("Check the contact details before creating the workspace.");
      return;
    }
    if (!templates.some((item) => item.id === resolvedTemplateId) || (assignee && !users.some((item) => item.uid === assignee))) {
      setError("Choose a current workspace owner and playbook.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const customFields: Record<string, string> = { Service: services.find((item) => item.id === service)?.title || service };
      if (projectGoal.trim()) customFields["Project goal"] = projectGoal.trim();
      if (website.trim()) customFields.Website = website.trim();
      if (timeline.trim()) customFields.Timeline = timeline.trim();
      const data = await apiFetch<{ client: ClientWithProgress }>("/api/clients", {
        method: "POST", token,
        body: JSON.stringify({ name: name.trim(), companyName: companyName.trim(), primaryContactEmail: email.trim().toLowerCase(), assignedTeamMemberId: assignee || null, templateId: resolvedTemplateId, tags: [service], customFields }),
      });
      setCreated(true);
      discardSessionDraft(storageKey);
      router.push(`/clients/${data.client.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
      setSaving(false);
    }
  }

  if (!userId || readyUserId !== userId) return <p className="text-sm text-[var(--ink-muted)]">Loading your brief…</p>;

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--ink-muted)]" aria-label={`Step ${step} of 3`}>
        {["Service", "Project brief", "Launch plan"].map((label, index) => (
          <div key={label} className="flex items-center gap-2" aria-current={step === index + 1 ? "step" : undefined}>
            <span className={`grid h-6 w-6 place-items-center rounded-full ${step >= index + 1 ? "bg-[var(--brand)] text-[var(--on-brand)]" : "bg-[var(--surface-2)]"}`}>{index + 1}</span>
            <span className="hidden sm:inline">{label}</span>
            {index < 2 ? <span className="h-px w-6 bg-[var(--border)] sm:w-12" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
      {step === 1 ? (
        <Card>
          <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">What are we onboarding?</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Choose the service so Boatship can start the right playbook.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2" role="group" aria-label="Service">
            {services.map((item) => (
              <button type="button" key={item.id} aria-pressed={service === item.id} onClick={() => updateDraft({ service: item.id })} className={`rounded-[var(--radius-md)] border p-4 text-left transition ${service === item.id ? "border-[var(--brand)] bg-[var(--surface-2)]" : "border-[var(--border)] hover:border-[var(--brand)]/50"}`}>
                <p className="font-medium text-[var(--ink)]">{item.title}</p>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">{item.description}</p>
              </button>
            ))}
          </div>
          <div className="mt-6 flex justify-end"><Button type="button" onClick={() => updateDraft({ step: 2 })}>Continue</Button></div>
        </Card>
      ) : null}
      {step === 2 ? (
        <Card>
          <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Start the brief</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Enough context to assign work and make the kickoff useful.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="intake-name">Contact name</Label>
              <Input id="intake-name" value={name} onChange={(event) => updateDraft({ name: event.target.value })} required maxLength={2000} autoComplete="name" aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "intake-name-error" : undefined} />
              {fieldErrors.name ? <p id="intake-name-error" className="mt-1 text-sm text-[var(--danger)]">{fieldErrors.name}</p> : null}
            </div>
            <div>
              <Label htmlFor="intake-companyName">Company</Label>
              <Input id="intake-companyName" value={companyName} onChange={(event) => updateDraft({ companyName: event.target.value })} required maxLength={2000} autoComplete="organization" aria-invalid={Boolean(fieldErrors.companyName)} aria-describedby={fieldErrors.companyName ? "intake-company-error" : undefined} />
              {fieldErrors.companyName ? <p id="intake-company-error" className="mt-1 text-sm text-[var(--danger)]">{fieldErrors.companyName}</p> : null}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="intake-email">Primary contact email</Label>
              <Input id="intake-email" type="email" value={email} onChange={(event) => updateDraft({ email: event.target.value })} required maxLength={254} autoComplete="email" aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "intake-email-error" : undefined} />
              {fieldErrors.email ? <p id="intake-email-error" className="mt-1 text-sm text-[var(--danger)]">{fieldErrors.email}</p> : null}
            </div>
            <div className="sm:col-span-2"><Label htmlFor="intake-goal">Primary outcome</Label><Input id="intake-goal" value={projectGoal} onChange={(event) => updateDraft({ projectGoal: event.target.value })} maxLength={2000} placeholder="What does success look like?" /></div>
            <div><Label htmlFor="intake-website">Current website or product</Label><Input id="intake-website" value={website} onChange={(event) => updateDraft({ website: event.target.value })} maxLength={2000} placeholder="https://" /></div>
            <div><Label htmlFor="intake-timeline">Target launch</Label><Input id="intake-timeline" value={timeline} onChange={(event) => updateDraft({ timeline: event.target.value })} maxLength={2000} placeholder="e.g. End of October" /></div>
          </div>
          <div className="mt-6 flex justify-between"><Button type="button" variant="secondary" onClick={() => updateDraft({ step: 1 })}>Back</Button><Button type="button" onClick={continueToPlan}>Continue</Button></div>
        </Card>
      ) : null}
      {step === 3 ? (
        <Card>
          <h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Set the launch plan</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">We matched a playbook to the service. You can adjust it before creating the workspace.</p>
          <div className="mt-5 space-y-4">
            <div><Label htmlFor="intake-owner">Workspace owner</Label><Dropdown id="intake-owner" value={assignee} onChange={(value) => updateDraft({ assignee: value })} disabled={saving} options={[{ value: "", label: "Unassigned" }, ...users.map((user) => ({ value: user.uid, label: user.name }))]} /></div>
            <div><Label htmlFor="intake-playbook">Onboarding playbook</Label><Dropdown id="intake-playbook" value={resolvedTemplateId} onChange={(value) => updateDraft({ templateId: value })} disabled={saving} options={templates.map((template) => ({ value: template.id, label: `${template.name} (${template.taskList.length} tasks)` }))} /><p className="mt-2 text-xs text-[var(--ink-muted)]">{templates.find((template) => template.id === resolvedTemplateId)?.description || "Tasks will be generated from this playbook."}</p></div>
          </div>
          <div className="mt-6 flex justify-between"><Button type="button" variant="secondary" onClick={() => updateDraft({ step: 2 })} disabled={saving}>Back</Button><Button type="submit" disabled={saving || created || !resolvedTemplateId}>{saving ? "Creating workspace…" : "Create client workspace"}</Button></div>
        </Card>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p role="status" className="max-w-prose text-sm text-[var(--ink-muted)]">{draftStatus || "Your unfinished brief stays in this tab for up to 24 hours. It clears on sign-out."}</p>
        {hasDraft ? <Button type="button" variant="ghost" disabled={saving} onClick={discardDraft}>Discard draft</Button> : null}
      </div>
      <Link href="/clients" onClick={(event) => {
        if (saving || (hasDraft && !window.confirm(draftPersisted ? "Leave this brief? Your draft will remain in this tab until it expires or you sign out." : "Leave this brief? Browser storage is unavailable and your answers will be lost."))) event.preventDefault();
      }} className="flex min-h-11 items-center justify-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]">Cancel</Link>
    </form>
  );
}
