"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Button,
  Card,
  Dropdown,
  EmptyState,
  Input,
  Label,
  PageHeader,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import type { ClientWithProgress, OnboardingTemplate } from "@/types";

type TeamUser = { uid: string; name: string; email: string; role: string };

export default function NewClientPage() {
  const { token, session } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [primaryContactEmail, setPrimaryContactEmail] = useState("");
  const [assignedTeamMemberId, setAssignedTeamMemberId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [tags, setTags] = useState("");
  const [vesselImo, setVesselImo] = useState("");
  const [flag, setFlag] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setError("");
    try {
      const [u, t] = await Promise.all([
        apiFetch<{ users: TeamUser[] }>("/api/users", { token }),
        apiFetch<{ templates: OnboardingTemplate[] }>("/api/templates", { token }),
      ]);
      setUsers(u.users);
      setTemplates(t.templates);
      setAssignedTeamMemberId(session?.uid || u.users[0]?.uid || "");
      setTemplateId(
        t.templates.find((x) => x.id === "seed_standard")?.id || t.templates[0]?.id || ""
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load form data");
    } finally {
      setLoadingMeta(false);
    }
  }, [token, session?.uid]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const assigneeOptions = useMemo(
    () => [
      { value: "", label: "Unassigned" },
      ...users.map((u) => ({ value: u.uid, label: u.name })),
    ],
    [users]
  );

  const templateOptions = useMemo(
    () =>
      templates.map((t) => ({
        value: t.id,
        label: `${t.name} (${t.taskList.length} tasks)`,
      })),
    [templates]
  );

  const selectedTemplate = templates.find((t) => t.id === templateId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const customFields: Record<string, string> = {};
      if (vesselImo.trim()) customFields["Vessel IMO"] = vesselImo.trim();
      if (flag.trim()) customFields.Flag = flag.trim();

      const data = await apiFetch<{ client: ClientWithProgress }>("/api/clients", {
        method: "POST",
        token,
        body: JSON.stringify({
          name: name.trim(),
          companyName: companyName.trim(),
          primaryContactEmail: primaryContactEmail.trim(),
          assignedTeamMemberId: assignedTeamMemberId || null,
          templateId: templateId || null,
          tags: tagList,
          customFields,
        }),
      });
      router.push(`/clients/${data.client.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
      setSaving(false);
    }
  }

  if (loadingMeta) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading…</p>;
  }

  if (error && users.length === 0 && templates.length === 0) {
    return (
      <EmptyState
        title="Couldn’t load form"
        description={error}
        action={
          <Button type="button" onClick={() => void loadMeta()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="New client"
        description="Create a client and generate onboarding tasks from a template."
      />

      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Contact name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="companyName">Company</Label>
            <Input
              id="companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="email">Primary contact email</Label>
            <Input
              id="email"
              type="email"
              value={primaryContactEmail}
              onChange={(e) => setPrimaryContactEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Assigned team member</Label>
            <Dropdown
              value={assignedTeamMemberId}
              onChange={setAssignedTeamMemberId}
              options={assigneeOptions}
              placeholder="Select assignee"
            />
          </div>
          <div>
            <Label>Onboarding template</Label>
            <Dropdown
              value={templateId}
              onChange={setTemplateId}
              options={templateOptions}
              placeholder="Select template"
            />
            {selectedTemplate?.description ? (
              <p className="mt-2 text-xs text-[var(--ink-muted)]">{selectedTemplate.description}</p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. fleet, priority, tanker"
            />
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Comma-separated</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="vesselImo">Vessel IMO</Label>
              <Input
                id="vesselImo"
                value={vesselImo}
                onChange={(e) => setVesselImo(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label htmlFor="flag">Flag</Label>
              <Input
                id="flag"
                value={flag}
                onChange={(e) => setFlag(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create client"}
            </Button>
            <Link href="/clients">
              <Button type="button" variant="secondary" disabled={saving}>
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
