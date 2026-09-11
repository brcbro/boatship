"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Dropdown, Input, Label } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import type { ClientWithProgress, OnboardingTemplate } from "@/types";

type TeamUser = { uid: string; name: string; email: string; role: string };
type Service = "website" | "app" | "marketing" | "content" | "ads" | "ecommerce";

const services: { id: Service; title: string; description: string; keywords: string[] }[] = [
  { id: "website", title: "Website", description: "Websites, landing pages, and redesigns.", keywords: ["website", "web", "seo"] },
  { id: "app", title: "App", description: "Web, mobile, SaaS, and product builds.", keywords: ["app", "product", "software"] },
  { id: "marketing", title: "Marketing", description: "Strategy, growth, and campaign planning.", keywords: ["marketing", "growth", "brand"] },
  { id: "content", title: "Content", description: "Content systems, creative, and social media.", keywords: ["content", "social", "creative"] },
  { id: "ads", title: "Paid ads", description: "Google, Meta, and performance advertising.", keywords: ["ads", "paid", "campaign"] },
  { id: "ecommerce", title: "E-commerce", description: "Stores, catalogues, and conversion work.", keywords: ["e-commerce", "ecommerce", "shop", "store"] },
];

export function IntakeWizard({ token, users, templates, defaultAssigneeId }: { token: string | null; users: TeamUser[]; templates: OnboardingTemplate[]; defaultAssigneeId: string }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [service, setService] = useState<Service>("website");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [projectGoal, setProjectGoal] = useState("");
  const [website, setWebsite] = useState("");
  const [timeline, setTimeline] = useState("");
  const [assignee, setAssignee] = useState(defaultAssigneeId);
  const [templateId, setTemplateId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const suggestedTemplate = useMemo(() => {
    const match = services.find((item) => item.id === service)!;
    return templates.find((template) => {
      const label = `${template.name} ${template.description || ""}`.toLowerCase();
      return match.keywords.some((keyword) => label.includes(keyword));
    }) || templates[0];
  }, [service, templates]);
  const resolvedTemplateId = templateId || suggestedTemplate?.id || "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const customFields: Record<string, string> = {
        Service: services.find((item) => item.id === service)?.title || service,
      };
      if (projectGoal.trim()) customFields["Project goal"] = projectGoal.trim();
      if (website.trim()) customFields.Website = website.trim();
      if (timeline.trim()) customFields.Timeline = timeline.trim();
      const data = await apiFetch<{ client: ClientWithProgress }>("/api/clients", {
        method: "POST", token,
        body: JSON.stringify({ name: name.trim(), companyName: companyName.trim(), primaryContactEmail: email.trim(), assignedTeamMemberId: assignee || null, templateId: resolvedTemplateId || null, tags: [service], customFields }),
      });
      router.push(`/clients/${data.client.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
      setSaving(false);
    }
  }

  return <form onSubmit={submit} className="space-y-6">
    <div className="flex items-center gap-2 text-xs font-medium text-[var(--ink-muted)]">
      {["Service", "Project brief", "Launch plan"].map((label, index) => <div key={label} className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-full ${step >= index + 1 ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-2)]"}`}>{index + 1}</span><span className="hidden sm:inline">{label}</span>{index < 2 ? <span className="h-px w-6 bg-[var(--border)] sm:w-12" /> : null}</div>)}
    </div>
    {step === 1 ? <Card><h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">What are we onboarding?</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Choose the service so Boatship can start the right playbook.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{services.map((item) => <button type="button" key={item.id} onClick={() => setService(item.id)} className={`rounded-lg border p-4 text-left transition ${service === item.id ? "border-[var(--brand)] bg-[var(--surface-2)]" : "border-[var(--border)] hover:border-[var(--brand)]/50"}`}><p className="font-medium text-[var(--ink)]">{item.title}</p><p className="mt-1 text-sm text-[var(--ink-muted)]">{item.description}</p></button>)}</div><div className="mt-6 flex justify-end"><Button type="button" onClick={() => setStep(2)}>Continue</Button></div></Card> : null}
    {step === 2 ? <Card><h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Start the brief</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Enough context to assign work and make the kickoff useful.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><Label htmlFor="contact">Contact name</Label><Input id="contact" value={name} onChange={(e) => setName(e.target.value)} required /></div><div><Label htmlFor="company">Company</Label><Input id="company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required /></div><div className="sm:col-span-2"><Label htmlFor="email">Primary contact email</Label><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div><div className="sm:col-span-2"><Label htmlFor="goal">Primary outcome</Label><Input id="goal" value={projectGoal} onChange={(e) => setProjectGoal(e.target.value)} placeholder="What does success look like?" /></div><div><Label htmlFor="website">Current website or product</Label><Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></div><div><Label htmlFor="timeline">Target launch</Label><Input id="timeline" value={timeline} onChange={(e) => setTimeline(e.target.value)} placeholder="e.g. End of October" /></div></div><div className="mt-6 flex justify-between"><Button type="button" variant="secondary" onClick={() => setStep(1)}>Back</Button><Button type="button" onClick={() => setStep(3)} disabled={!name.trim() || !companyName.trim() || !email.trim()}>Continue</Button></div></Card> : null}
    {step === 3 ? <Card><h2 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Set the launch plan</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">We matched a playbook to the service. You can adjust it before creating the workspace.</p><div className="mt-5 space-y-4"><div><Label>Workspace owner</Label><Dropdown value={assignee} onChange={setAssignee} options={[{ value: "", label: "Unassigned" }, ...users.map((user) => ({ value: user.uid, label: user.name }))]} /></div><div><Label>Onboarding playbook</Label><Dropdown value={resolvedTemplateId} onChange={setTemplateId} options={templates.map((template) => ({ value: template.id, label: `${template.name} (${template.taskList.length} tasks)` }))} /><p className="mt-2 text-xs text-[var(--ink-muted)]">{templates.find((template) => template.id === resolvedTemplateId)?.description || "Tasks will be generated from this playbook."}</p></div></div>{error ? <p className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}<div className="mt-6 flex justify-between"><Button type="button" variant="secondary" onClick={() => setStep(2)} disabled={saving}>Back</Button><Button type="submit" disabled={saving || !resolvedTemplateId}>{saving ? "Creating workspace..." : "Create client workspace"}</Button></div></Card> : null}
    <Link href="/clients" className="block text-center text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]">Cancel</Link>
  </form>;
}
