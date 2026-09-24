"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Button,
  Card,
  Dropdown,
  EmptyState,
  Input,
  Label,
  Modal,
  PageHeader,
  ProgressBar,
  Textarea,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDate, formatDateTime, statusLabel } from "@/lib/utils";
import { TaskBoard } from "@/components/shared/TaskBoard";
import { ClientWorkspaceNav } from "@/components/clients/ClientWorkspaceNav";
import type {
  ClientStatus,
  ClientWithProgress,
  DocumentRecord,
  DocumentStatus,
  FormSubmission,
  FormTemplate,
  PipelineStage,
  Task,
  TaskType,
  Vessel,
} from "@/types";

type TeamUser = { uid: string; name: string; email: string; role: string };
type Tab = "overview" | "tasks" | "documents" | "forms" | "vessels" | "activity";

type VesselForm = {
  name: string;
  imo: string;
  flag: string;
  vesselType: string;
  classSociety: string;
  notes: string;
};

const emptyVesselForm = (): VesselForm => ({
  name: "",
  imo: "",
  flag: "",
  vesselType: "",
  classSociety: "",
  notes: "",
});

const PIPELINE_STAGES: PipelineStage[] = [
  "intake",
  "kyc",
  "compliance",
  "kickoff",
  "go_live",
  "done",
];

type ActivityEntry = {
  id: string;
  clientId: string;
  actorId?: string;
  actorName: string;
  action: string;
  timestamp: string;
  meta?: Record<string, unknown>;
};

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "completed" || status === "approved" || status === "reviewed") return "success";
  if (status === "in_progress" || status === "pending_review" || status === "submitted") return "info";
  if (status === "on_hold" || status === "blocked" || status === "rejected") return "danger";
  if (status === "not_started" || status === "pending") return "warning";
  return "neutral";
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || "");
  const { token } = useAuth();

  const [tab, setTab] = useState<Tab>("overview");
  const [client, setClient] = useState<ClientWithProgress | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentCheckedAt, setDocumentCheckedAt] = useState(() => Date.now());
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [forms, setForms] = useState<FormSubmission[]>([]);
  const [formTemplates, setFormTemplates] = useState<FormTemplate[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    email: string;
  } | null>(null);

  // Clone modal
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneEmail, setCloneEmail] = useState("");

  // Pause modal
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");

  // Tags / custom fields (overview editors)
  const [tagsInput, setTagsInput] = useState("");
  const [vesselImo, setVesselImo] = useState("");
  const [flag, setFlag] = useState("");

  // Document review notes
  const [docNotes, setDocNotes] = useState<Record<string, string>>({});

  // Form review
  const [formNotes, setFormNotes] = useState<Record<string, string>>({});
  const [reviewFormId, setReviewFormId] = useState<string | null>(null);
  const [exportingForms, setExportingForms] = useState(false);

  // Vessels
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [vesselModalOpen, setVesselModalOpen] = useState(false);
  const [editingVesselId, setEditingVesselId] = useState<string | null>(null);
  const [vesselForm, setVesselForm] = useState<VesselForm>(emptyVesselForm);

  const templateMap = useMemo(
    () => new Map(formTemplates.map((t) => [t.id, t])),
    [formTemplates]
  );

  const reviewingForm = forms.find((f) => f.id === reviewFormId) || null;
  const reviewingTemplate = reviewingForm
    ? templateMap.get(reviewingForm.formTemplateId)
    : undefined;
  const reviewingFormUrl =
    reviewingTemplate?.googleFormUrl || reviewingTemplate?.googleFormEmbedUrl || "";

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const [c, t, d, f, ft, u, a, v] = await Promise.all([
        apiFetch<{ client: ClientWithProgress }>(`/api/clients/${id}`, { token }),
        apiFetch<{ tasks: Task[] }>(`/api/tasks?clientId=${encodeURIComponent(id)}`, { token }),
        apiFetch<{ documents: DocumentRecord[] }>(
          `/api/documents?clientId=${encodeURIComponent(id)}`,
          { token }
        ),
        apiFetch<{ forms: FormSubmission[] }>(`/api/forms?clientId=${encodeURIComponent(id)}`, {
          token,
        }),
        apiFetch<{ templates: FormTemplate[] }>("/api/forms/templates", { token }),
        apiFetch<{ users: TeamUser[] }>("/api/users", { token }),
        apiFetch<{ activity: ActivityEntry[] }>(
          `/api/activity?clientId=${encodeURIComponent(id)}`,
          { token }
        ),
        apiFetch<{ vessels: Vessel[] }>(
          `/api/vessels?clientId=${encodeURIComponent(id)}`,
          { token }
        ),
      ]);
      setClient(c.client);
      setTagsInput((c.client.tags || []).join(", "));
      setVesselImo(c.client.customFields?.["Vessel IMO"] || "");
      setFlag(c.client.customFields?.Flag || "");
      setTasks([...t.tasks].sort((x, y) => x.order - y.order));
      setDocuments(d.documents);
      setDocumentCheckedAt(Date.now());
      setSelectedDocs(new Set());
      setForms(f.forms);
      setFormTemplates(ft.templates);
      setUsers(u.users);
      setActivity(
        [...(a.activity || [])].sort((x, y) => y.timestamp.localeCompare(x.timestamp))
      );
      setVessels(v.vessels || []);
      const notes: Record<string, string> = {};
      for (const doc of d.documents) notes[doc.id] = doc.reviewNote || "";
      setDocNotes(notes);
      const fNotes: Record<string, string> = {};
      for (const form of f.forms) fNotes[form.id] = form.reviewNote || "";
      setFormNotes(fNotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client");
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function patchClient(patch: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const data = await apiFetch<{ client: ClientWithProgress }>(`/api/clients/${id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify(patch),
      });
      setClient((prev) => (prev ? { ...prev, ...data.client } : data.client));
      if (data.client.tags) setTagsInput(data.client.tags.join(", "));
      if (data.client.customFields) {
        setVesselImo(data.client.customFields["Vessel IMO"] || "");
        setFlag(data.client.customFields.Flag || "");
      }
      setMessage("Client updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveTagsAndFields() {
    const tagList = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const customFields: Record<string, string> = {
      ...(client?.customFields || {}),
    };
    if (vesselImo.trim()) customFields["Vessel IMO"] = vesselImo.trim();
    else delete customFields["Vessel IMO"];
    if (flag.trim()) customFields.Flag = flag.trim();
    else delete customFields.Flag;
    await patchClient({ tags: tagList, customFields });
  }

  async function inviteClient() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{
        user: { email: string };
      }>(`/api/clients/${id}/invite`, {
        method: "POST",
        token,
        body: JSON.stringify({}),
      });
      setInviteResult({
        email: data.user.email,
      });
      setInviteOpen(true);
      setMessage("Invite sent.");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function cloneClient() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body: { primaryContactEmail?: string } = {};
      if (cloneEmail.trim()) body.primaryContactEmail = cloneEmail.trim();
      const data = await apiFetch<{ client: ClientWithProgress }>(
        `/api/clients/${id}/clone`,
        {
          method: "POST",
          token,
          body: JSON.stringify(body),
        }
      );
      setCloneOpen(false);
      setCloneEmail("");
      setMessage("Client cloned.");
      router.push(`/clients/${data.client.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setBusy(false);
    }
  }

  async function pauseClient() {
    const reason = pauseReason.trim();
    if (!reason) {
      setError("Pause reason is required");
      return;
    }
    setPauseOpen(false);
    await patchClient({ paused: true, pauseReason: reason });
    setPauseReason("");
  }

  async function resumeClient() {
    await patchClient({ paused: false });
  }

  async function saveTask(taskId: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ task: Task }>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        token,
        body: JSON.stringify(patch),
      });
      setTasks((prev) =>
        [...prev.map((t) => (t.id === taskId ? data.task : t))].sort((a, b) => a.order - b.order)
      );
      setMessage("Task updated.");
      // refresh client progress
      const c = await apiFetch<{ client: ClientWithProgress }>(`/api/clients/${id}`, { token });
      setClient(c.client);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task update failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTask(taskId: string) {
    if (!confirm("Delete this task?")) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/tasks/${taskId}`, { method: "DELETE", token });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setMessage("Task deleted.");
      const c = await apiFetch<{ client: ClientWithProgress }>(`/api/clients/${id}`, { token });
      setClient(c.client);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function createTaskFromBoard(input: {
    title: string;
    description: string;
    type: TaskType;
    section: string;
  }) {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ task: Task }>("/api/tasks", {
        method: "POST",
        token,
        body: JSON.stringify({
          clientId: id,
          title: input.title,
          description: input.description,
          type: input.type,
          section: input.section,
        }),
      });
      setTasks((prev) => [...prev, data.task].sort((a, b) => a.order - b.order));
      setMessage("Task added.");
      const c = await apiFetch<{ client: ClientWithProgress }>(`/api/clients/${id}`, { token });
      setClient(c.client);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add task");
    } finally {
      setBusy(false);
    }
  }

  async function moveTask(task: Task, direction: -1 | 1) {
    const sorted = [...tasks].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((t) => t.id === task.id);
    const swapWith = sorted[idx + direction];
    if (!swapWith) return;
    setBusy(true);
    setError("");
    try {
      const [a, b] = await Promise.all([
        apiFetch<{ task: Task }>(`/api/tasks/${task.id}`, {
          method: "PATCH",
          token,
          body: JSON.stringify({ order: swapWith.order }),
        }),
        apiFetch<{ task: Task }>(`/api/tasks/${swapWith.id}`, {
          method: "PATCH",
          token,
          body: JSON.stringify({ order: task.order }),
        }),
      ]);
      setTasks((prev) =>
        [...prev.map((t) => {
          if (t.id === a.task.id) return a.task;
          if (t.id === b.task.id) return b.task;
          return t;
        })].sort((x, y) => x.order - y.order)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewDocument(docId: string, status: DocumentStatus) {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ document: DocumentRecord }>(`/api/documents/${docId}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status, reviewNote: docNotes[docId] || "" }),
      });
      setDocuments((prev) => prev.map((d) => (d.id === docId ? data.document : d)));
      setMessage(`Document ${statusLabel(status).toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Document review failed");
    } finally {
      setBusy(false);
    }
  }

  async function bulkReviewDocuments(status: DocumentStatus) {
    if (!selectedDocs.size) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ updated: number; documents: DocumentRecord[] }>(
        "/api/documents/bulk",
        {
          method: "POST",
          token,
          body: JSON.stringify({
            ids: Array.from(selectedDocs),
            status,
          }),
        }
      );
      const byId = new Map(data.documents.map((d) => [d.id, d]));
      setDocuments((prev) => prev.map((d) => byId.get(d.id) || d));
      setSelectedDocs(new Set());
      setMessage(`Updated ${data.updated} document(s) to ${statusLabel(status).toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk review failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewForm(formId: string) {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ form: FormSubmission }>(`/api/forms/${formId}/review`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ reviewNote: formNotes[formId] || "", status: "reviewed" }),
      });
      setForms((prev) => prev.map((f) => (f.id === formId ? data.form : f)));
      setMessage("Form marked as reviewed.");
      setReviewFormId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Form review failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportFormsCsv() {
    if (!id) return;
    setExportingForms(true);
    setError("");
    try {
      const res = await fetch(`/api/forms/export?clientId=${encodeURIComponent(id)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `boatship-forms-${id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Form export failed");
    } finally {
      setExportingForms(false);
    }
  }

  function openNewVessel() {
    setEditingVesselId(null);
    setVesselForm(emptyVesselForm());
    setVesselModalOpen(true);
  }

  function openEditVessel(vessel: Vessel) {
    setEditingVesselId(vessel.id);
    setVesselForm({
      name: vessel.name,
      imo: vessel.imo,
      flag: vessel.flag,
      vesselType: vessel.vesselType,
      classSociety: vessel.classSociety,
      notes: vessel.notes,
    });
    setVesselModalOpen(true);
  }

  async function saveVessel() {
    if (!vesselForm.name.trim()) {
      setError("Vessel name is required");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        name: vesselForm.name.trim(),
        imo: vesselForm.imo.trim(),
        flag: vesselForm.flag.trim(),
        vesselType: vesselForm.vesselType.trim(),
        classSociety: vesselForm.classSociety.trim(),
        notes: vesselForm.notes.trim(),
      };
      if (editingVesselId) {
        const data = await apiFetch<{ vessel: Vessel }>(`/api/vessels/${editingVesselId}`, {
          method: "PATCH",
          token,
          body: JSON.stringify(payload),
        });
        setVessels((prev) =>
          [...prev.map((v) => (v.id === editingVesselId ? data.vessel : v))].sort((a, b) =>
            a.name.localeCompare(b.name)
          )
        );
        setMessage("Vessel updated.");
      } else {
        const data = await apiFetch<{ vessel: Vessel }>("/api/vessels", {
          method: "POST",
          token,
          body: JSON.stringify({ clientId: id, ...payload }),
        });
        setVessels((prev) => [...prev, data.vessel].sort((a, b) => a.name.localeCompare(b.name)));
        setMessage("Vessel added.");
      }
      setVesselModalOpen(false);
      setEditingVesselId(null);
      setVesselForm(emptyVesselForm());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save vessel");
    } finally {
      setBusy(false);
    }
  }

  async function deleteVessel(vesselId: string) {
    if (!confirm("Delete this vessel?")) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/vessels/${vesselId}`, { method: "DELETE", token });
      setVessels((prev) => prev.filter((v) => v.id !== vesselId));
      setMessage("Vessel deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading client…</p>;
  }

  if (error && !client) {
    return (
      <EmptyState
        title="Client not found"
        description={error}
        action={
          <Link href="/clients">
            <Button type="button" variant="secondary">
              Back to clients
            </Button>
          </Link>
        }
      />
    );
  }

  if (!client) return null;

  return (
    <div>
      <div className="mb-4">
        <Link href="/clients" className="text-sm text-[var(--accent)] hover:underline">
          ← Back to clients
        </Link>
      </div>

      <PageHeader
        title={client.name}
        description={`${client.companyName} · ${client.primaryContactEmail}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setCloneEmail("");
                setCloneOpen(true);
              }}
            >
              Clone
            </Button>
            {client.pausedAt || client.pauseReason ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void resumeClient()}>
                Resume
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setPauseReason("");
                  setPauseOpen(true);
                }}
              >
                Pause
              </Button>
            )}
            <Button type="button" onClick={() => void inviteClient()} disabled={busy}>
              Invite client
            </Button>
          </div>
        }
      />

      {message ? (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <ClientWorkspaceNav active={tab} onChange={(next) => setTab(next as Tab)} />

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg">Status & assignee</h2>
            <div className="space-y-4">
              <div>
                <Label>Status</Label>
                <Dropdown
                  value={client.status}
                  disabled={busy}
                  onChange={(v) => void patchClient({ status: v as ClientStatus })}
                  options={(
                    ["not_started", "in_progress", "completed", "on_hold"] as ClientStatus[]
                  ).map((s) => ({ value: s, label: statusLabel(s) }))}
                />
              </div>
              <div>
                <Label>Pipeline stage</Label>
                <Dropdown
                  value={client.pipelineStage || "intake"}
                  disabled={busy}
                  onChange={(v) => void patchClient({ pipelineStage: v as PipelineStage })}
                  options={PIPELINE_STAGES.map((s) => ({
                    value: s,
                    label: statusLabel(s),
                  }))}
                />
              </div>
              <div>
                <Label>Assigned team member</Label>
                <Dropdown
                  value={client.assignedTeamMemberId || ""}
                  disabled={busy}
                  onChange={(v) => void patchClient({ assignedTeamMemberId: v || null })}
                  options={[
                    { value: "", label: "Unassigned" },
                    ...users.map((u) => ({ value: u.uid, label: u.name })),
                  ]}
                />
              </div>
              {client.pauseReason || client.pausedAt ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p className="font-medium">Paused</p>
                  {client.pauseReason ? <p className="mt-0.5">{client.pauseReason}</p> : null}
                  {client.pausedAt ? (
                    <p className="mt-1 text-xs opacity-80">
                      Since {formatDateTime(client.pausedAt)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg">Progress</h2>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-[var(--ink-muted)]">
                {client.completedTasks} of {client.totalTasks} tasks complete
              </span>
              <span className="font-medium">{client.progress}%</span>
            </div>
            <ProgressBar value={client.progress} />
            <dl className="mt-6 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--ink-muted)]">Company</dt>
                <dd>{client.companyName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--ink-muted)]">Email</dt>
                <dd className="truncate">{client.primaryContactEmail}</dd>
              </div>
              {client.driveFolderUrl ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--ink-muted)]">Drive folder</dt>
                  <dd>
                    <a
                      href={client.driveFolderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent)] underline-offset-2 hover:underline"
                    >
                      Open in Drive
                    </a>
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--ink-muted)]">Created</dt>
                <dd>{formatDate(client.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--ink-muted)]">Updated</dt>
                <dd>{formatDate(client.updatedAt)}</dd>
              </div>
            </dl>
          </Card>

          <Card className="lg:col-span-2">
            <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg">
              Tags & custom fields
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-3">
                <Label htmlFor="tags">Tags</Label>
                <Input
                  id="tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="Comma-separated tags"
                  disabled={busy}
                />
                {(client.tags || []).length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {client.tags.map((t) => (
                      <Badge key={t} tone="neutral">
                        {t}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              <div>
                <Label htmlFor="vesselImo">Vessel IMO</Label>
                <Input
                  id="vesselImo"
                  value={vesselImo}
                  onChange={(e) => setVesselImo(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div>
                <Label htmlFor="flag">Flag</Label>
                <Input
                  id="flag"
                  value={flag}
                  onChange={(e) => setFlag(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button type="button" disabled={busy} onClick={() => void saveTagsAndFields()}>
                Save tags & fields
              </Button>
            </div>
            {Object.entries(client.customFields || {}).some(([key]) => key !== "Vessel IMO" && key !== "Flag") ? (
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                  Details from client forms
                </p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(client.customFields || {})
                    .filter(([key]) => key !== "Vessel IMO" && key !== "Flag")
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-xs text-[var(--ink-muted)]">{key}</dt>
                        <dd className="text-sm font-medium text-[var(--ink)]">{value || "—"}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <TaskBoard
          mode="admin"
          tasks={tasks}
          busy={busy}
          users={users}
          onUpdate={saveTask}
          onDelete={deleteTask}
          onCreate={createTaskFromBoard}
          onReorder={moveTask}
        />
      ) : null}

      {tab === "documents" ? (
        documents.length === 0 ? (
          <EmptyState
            title="No documents"
            description="Documents uploaded by the client will appear here for review."
          />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={documents.length > 0 && documents.every((d) => selectedDocs.has(d.id))}
                  onChange={() => {
                    if (documents.every((d) => selectedDocs.has(d.id))) {
                      setSelectedDocs(new Set());
                    } else {
                      setSelectedDocs(new Set(documents.map((d) => d.id)));
                    }
                  }}
                />
                Select all
              </label>
              <Button
                type="button"
                size="sm"
                disabled={busy || !selectedDocs.size}
                onClick={() => void bulkReviewDocuments("approved")}
              >
                Approve selected ({selectedDocs.size})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={busy || !selectedDocs.size}
                onClick={() => void bulkReviewDocuments("rejected")}
              >
                Reject selected
              </Button>
            </div>
            {documents.map((doc) => (
              <Card key={doc.id}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedDocs.has(doc.id)}
                      onChange={() => {
                        setSelectedDocs((prev) => {
                          const next = new Set(prev);
                          if (next.has(doc.id)) next.delete(doc.id);
                          else next.add(doc.id);
                          return next;
                        });
                      }}
                      aria-label={`Select ${doc.fileName}`}
                    />
                    <div>
                      <p className="font-medium text-[var(--ink)]">{doc.fileName}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        Uploaded {formatDateTime(doc.uploadedAt)} · {(doc.size / 1024).toFixed(1)} KB
                        {doc.versions && doc.versions.length > 1
                          ? ` · ${doc.versions.length} versions`
                          : ""}
                      </p>
                      {(doc.documentType || doc.expiresAt) && (
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          {doc.documentType ? (
                            <span className="mr-3">Type: {doc.documentType}</span>
                          ) : null}
                          {doc.expiresAt ? (
                            <span
                              className={
                                new Date(doc.expiresAt).getTime() < documentCheckedAt
                                  ? "text-[var(--danger,#b91c1c)]"
                                  : undefined
                              }
                            >
                              Expires {formatDate(doc.expiresAt)}
                            </span>
                          ) : null}
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge tone={statusTone(doc.status)}>{statusLabel(doc.status)}</Badge>
                </div>
                <div className="mb-3">
                  <Label htmlFor={`note-${doc.id}`}>Review note</Label>
                  <Textarea
                    id={`note-${doc.id}`}
                    rows={2}
                    value={docNotes[doc.id] || ""}
                    onChange={(e) =>
                      setDocNotes((prev) => ({ ...prev, [doc.id]: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void reviewDocument(doc.id, "approved")}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => void reviewDocument(doc.id, "rejected")}
                  >
                    Reject
                  </Button>
                  {doc.status !== "pending_review" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void reviewDocument(doc.id, "pending_review")}
                    >
                      Reset to pending
                    </Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === "forms" ? (
        forms.length === 0 ? (
          <EmptyState
            title="No forms"
            description="Form submissions for this client will show up here."
          />
        ) : (
          <>
            <div className="mb-3 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={exportingForms}
                onClick={() => void exportFormsCsv()}
              >
                {exportingForms ? "Exporting…" : "Export CSV"}
              </Button>
            </div>
            <Card className="p-2">
              <ul className="divide-y divide-[var(--border)]">
                {forms.map((form) => {
                  const tmpl = templateMap.get(form.formTemplateId);
                  return (
                    <li key={form.id}>
                      <button
                        type="button"
                        onClick={() => setReviewFormId(form.id)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]/70"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[var(--ink)]">
                            {tmpl?.name || form.formTemplateId}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                            {form.submittedAt
                              ? `Submitted ${formatDateTime(form.submittedAt)}`
                              : "Not submitted"}
                            {form.reviewedAt
                              ? ` · Reviewed ${formatDateTime(form.reviewedAt)}`
                              : ""}
                            {typeof form.riskScore === "number" ? ` · Risk ${form.riskScore}` : ""}
                          </span>
                        </span>
                        <Badge tone={statusTone(form.status)}>{statusLabel(form.status)}</Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Modal
              open={!!reviewingForm}
              onClose={() => setReviewFormId(null)}
              title={reviewingTemplate?.name || "Form review"}
              description={
                reviewingForm
                  ? reviewingForm.submittedAt
                    ? `Submitted ${formatDateTime(reviewingForm.submittedAt)}`
                    : "Client has not marked this form as submitted yet."
                  : undefined
              }
              size="lg"
              footer={
                reviewingForm ? (
                  <>
                    {reviewingFormUrl ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          window.open(reviewingFormUrl, "_blank", "noopener,noreferrer")
                        }
                      >
                        Open Google Form
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setReviewFormId(null)}
                    >
                      Close
                    </Button>
                    <Button
                      type="button"
                      disabled={busy || reviewingForm.status === "reviewed"}
                      onClick={() => void reviewForm(reviewingForm.id)}
                    >
                      {reviewingForm.status === "reviewed" ? "Reviewed" : "Mark reviewed"}
                    </Button>
                  </>
                ) : null
              }
            >
              {reviewingForm ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone(reviewingForm.status)}>
                      {statusLabel(reviewingForm.status)}
                    </Badge>
                    {typeof reviewingForm.riskScore === "number" ? (
                      <Badge tone={reviewingForm.riskScore > 0 ? "warning" : "neutral"}>
                        Risk {reviewingForm.riskScore}
                      </Badge>
                    ) : null}
                    {reviewingForm.reviewedAt ? (
                      <span className="text-xs text-[var(--ink-muted)]">
                        Reviewed {formatDateTime(reviewingForm.reviewedAt)}
                      </span>
                    ) : null}
                  </div>

                  {reviewingTemplate?.description ? (
                    <p className="text-sm text-[var(--ink-muted)]">
                      {reviewingTemplate.description}
                    </p>
                  ) : null}

                  {reviewingTemplate?.fields?.length ||
                  Object.keys(reviewingForm.responses || {}).length > 0 ? (
                    <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)]/40 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                        Responses
                      </p>
                      {(reviewingTemplate?.fields?.length
                        ? reviewingTemplate.fields
                        : Object.keys(reviewingForm.responses || {}).map((key) => ({
                            key,
                            label: key,
                          }))
                      ).map((field) => {
                        const raw = reviewingForm.responses?.[field.key];
                        const display =
                          raw === null || raw === undefined || raw === ""
                            ? "—"
                            : typeof raw === "boolean"
                              ? raw
                                ? "Yes"
                                : "No"
                              : String(raw);
                        return (
                          <div key={field.key} className="text-sm">
                            <p className="font-medium text-[var(--ink)]">{field.label}</p>
                            <p className="text-[var(--ink-muted)]">{display}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--ink-muted)]">
                      Responses live in Google Forms. Use the link above to view answers, then add a
                      review note here.
                    </p>
                  )}

                  <div>
                    <Label htmlFor={`fnote-${reviewingForm.id}`}>Review note</Label>
                    <Textarea
                      id={`fnote-${reviewingForm.id}`}
                      rows={3}
                      value={formNotes[reviewingForm.id] || ""}
                      onChange={(e) =>
                        setFormNotes((prev) => ({
                          ...prev,
                          [reviewingForm.id]: e.target.value,
                        }))
                      }
                      disabled={reviewingForm.status === "reviewed"}
                    />
                  </div>
                </div>
              ) : null}
            </Modal>
          </>
        )
      ) : null}

      {tab === "vessels" ? (
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--ink-muted)]">
              {vessels.length} vessel{vessels.length === 1 ? "" : "s"} registered
            </p>
            <Button type="button" size="sm" onClick={openNewVessel} disabled={busy}>
              Add vessel
            </Button>
          </div>

          {vessels.length === 0 ? (
            <EmptyState
              title="No vessels yet"
              description="Add vessels with IMO, flag, type, and class society."
              action={
                <Button type="button" onClick={openNewVessel}>
                  Add vessel
                </Button>
              }
            />
          ) : (
            <>
              <div className="space-y-3 sm:hidden">
                {vessels.map((vessel) => (
                  <Card key={vessel.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-medium text-[var(--ink)]">{vessel.name}</h3>
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          {vessel.vesselType || "Type not set"} · {vessel.flag || "Flag not set"}
                        </p>
                      </div>
                      {vessel.imo ? <Badge tone="neutral">IMO {vessel.imo}</Badge> : null}
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-[var(--ink-muted)]">Class society</dt>
                        <dd className="truncate text-[var(--ink)]">{vessel.classSociety || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--ink-muted)]">Notes</dt>
                        <dd className="truncate text-[var(--ink)]">{vessel.notes || "—"}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => openEditVessel(vessel)}>
                        Edit
                      </Button>
                      <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void deleteVessel(vessel.id)}>
                        Delete
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
              <Card className="hidden overflow-hidden p-0 sm:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-[var(--surface-2)] text-[var(--ink-muted)]">
                    <tr>
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">IMO</th>
                      <th className="px-5 py-3 font-medium">Flag</th>
                      <th className="px-5 py-3 font-medium">Type</th>
                      <th className="px-5 py-3 font-medium">Class society</th>
                      <th className="px-5 py-3 font-medium">Notes</th>
                      <th className="px-5 py-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {vessels.map((vessel) => (
                      <tr key={vessel.id} className="border-t border-[var(--border)]">
                        <td className="px-5 py-3 font-medium text-[var(--ink)]">{vessel.name}</td>
                        <td className="px-5 py-3 text-[var(--ink-muted)]">{vessel.imo || "—"}</td>
                        <td className="px-5 py-3 text-[var(--ink-muted)]">{vessel.flag || "—"}</td>
                        <td className="px-5 py-3 text-[var(--ink-muted)]">
                          {vessel.vesselType || "—"}
                        </td>
                        <td className="px-5 py-3 text-[var(--ink-muted)]">
                          {vessel.classSociety || "—"}
                        </td>
                        <td className="max-w-[200px] truncate px-5 py-3 text-[var(--ink-muted)]">
                          {vessel.notes || "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => openEditVessel(vessel)}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() => void deleteVessel(vessel.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          <Modal
            open={vesselModalOpen}
            onClose={() => setVesselModalOpen(false)}
            title={editingVesselId ? "Edit vessel" : "Add vessel"}
            description="IMO, flag, type, class society, and notes."
            footer={
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setVesselModalOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="button" disabled={busy} onClick={() => void saveVessel()}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="v-name">Name</Label>
                <Input
                  id="v-name"
                  value={vesselForm.name}
                  onChange={(e) => setVesselForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={busy}
                />
              </div>
              <div>
                <Label htmlFor="v-imo">IMO</Label>
                <Input
                  id="v-imo"
                  value={vesselForm.imo}
                  onChange={(e) => setVesselForm((f) => ({ ...f, imo: e.target.value }))}
                  disabled={busy}
                />
              </div>
              <div>
                <Label htmlFor="v-flag">Flag</Label>
                <Input
                  id="v-flag"
                  value={vesselForm.flag}
                  onChange={(e) => setVesselForm((f) => ({ ...f, flag: e.target.value }))}
                  disabled={busy}
                />
              </div>
              <div>
                <Label htmlFor="v-type">Type</Label>
                <Input
                  id="v-type"
                  value={vesselForm.vesselType}
                  onChange={(e) => setVesselForm((f) => ({ ...f, vesselType: e.target.value }))}
                  disabled={busy}
                />
              </div>
              <div>
                <Label htmlFor="v-class">Class society</Label>
                <Input
                  id="v-class"
                  value={vesselForm.classSociety}
                  onChange={(e) =>
                    setVesselForm((f) => ({ ...f, classSociety: e.target.value }))
                  }
                  disabled={busy}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="v-notes">Notes</Label>
                <Textarea
                  id="v-notes"
                  rows={3}
                  value={vesselForm.notes}
                  onChange={(e) => setVesselForm((f) => ({ ...f, notes: e.target.value }))}
                  disabled={busy}
                />
              </div>
            </div>
          </Modal>
        </div>
      ) : null}

      {tab === "activity" ? (
        activity.length === 0 ? (
          <EmptyState
            title="No recent activity"
            description="Actions on this client will appear in the activity timeline."
          />
        ) : (
          <Card className="p-0">
            <ul className="divide-y divide-[var(--border)]">
              {activity.map((entry) => (
                <li key={entry.id} className="px-5 py-4">
                  <p className="text-sm text-[var(--ink)]">
                    <span className="font-medium">{entry.actorName}</span>{" "}
                    <span className="text-[var(--ink-muted)]">{entry.action}</span>
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {formatDateTime(entry.timestamp)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : null}

      {inviteOpen && inviteResult ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close invite dialog"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setInviteOpen(false)}
          />
          <Card className="relative z-10 w-full max-w-md">
            <h3 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
              Client invited
            </h3>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              An invite email was sent to <strong>{inviteResult.email}</strong>. They can use its
              one-time link to set their password and open the portal.
            </p>
            <div className="mt-5 flex justify-end">
              <Button type="button" onClick={() => setInviteOpen(false)}>
                Done
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <Modal
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        title="Clone client"
        description="Creates a new client with the same tags and fields, regenerates tasks from the template, and resets pipeline to intake."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setCloneOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void cloneClient()}>
              {busy ? "Cloning…" : "Clone"}
            </Button>
          </>
        }
      >
        <div>
          <Label htmlFor="cloneEmail">Primary contact email (optional)</Label>
          <Input
            id="cloneEmail"
            type="email"
            value={cloneEmail}
            onChange={(e) => setCloneEmail(e.target.value)}
            placeholder="Leave blank to auto-suffix +clone…"
          />
        </div>
      </Modal>

      <Modal
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        title="Pause onboarding"
        description="Client status will move to On Hold until resumed."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setPauseOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !pauseReason.trim()} onClick={() => void pauseClient()}>
              Pause
            </Button>
          </>
        }
      >
        <div>
          <Label htmlFor="pauseReason">Reason</Label>
          <Textarea
            id="pauseReason"
            rows={3}
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            placeholder="Why is this client paused?"
          />
        </div>
      </Modal>
    </div>
  );
}
