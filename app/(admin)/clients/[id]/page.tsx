"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
  ProgressBar,
  RecordHeader,
  Tabs,
  Textarea,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDate, formatDateTime, statusLabel } from "@/lib/utils";
import { TaskBoard } from "@/components/shared/TaskBoard";
import { DocumentViewer } from "@/components/shared/DocumentViewer";
import { hasPermission } from "@/lib/rbac";
import { ClientMessagesPanel } from "@/components/clients/ClientMessagesPanel";
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
const TABS = [
  ["overview", "Overview"],
  ["engagements", "Engagements"],
  ["tasks", "Tasks"],
  ["forms", "Forms"],
  ["documents", "Documents"],
  ["messages", "Messages"],
  ["billing", "Billing"],
  ["vessels", "Vessels"],
] as const;
type Tab = (typeof TABS)[number][0];
function parseTab(value: string | null): Tab {
  return (TABS.find(([id]) => id === value)?.[0] as Tab | undefined) || "overview";
}
type Contact = { id: string; clientId: string; name: string; email: string; role: "account_admin" | "contributor" | "viewer" };
type Engagement = {
  id: string;
  clientId: string;
  name: string;
  type: "onboarding" | "project" | "ongoing_service";
  status: "planned" | "active" | "paused" | "completed" | "cancelled";
  ownerId: string | null;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  taskCount: number;
  completedTaskCount: number;
  progress: number;
};

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

const PIPELINE_STAGES: PipelineStage[] = ["intake", "kyc", "compliance", "kickoff", "go_live", "done"];

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

function ClientDetailInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = String(params.id || "");
  const { token, session } = useAuth();
  const canManageClient = !!session && hasPermission(session, "clients.manage");
  const canReviewDocuments = !!session && hasPermission(session, "documents.review");
  const canReviewForms = !!session && hasPermission(session, "forms.review");

  // The open tab lives in the URL (?tab=) so links from the Inbox, notifications
  // and Hodi land on the right section and the browser back button works.
  const tab = parseTab(searchParams.get("tab"));
  const setTab = useCallback((next: Tab) => router.replace(`/clients/${id}?tab=${next}`, { scroll: false }), [router, id]);
  const [client, setClient] = useState<ClientWithProgress | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selectedEngagementId, setSelectedEngagementId] = useState("");
  const [engagementOpen, setEngagementOpen] = useState(false);
  const [engagementName, setEngagementName] = useState("");
  const [engagementType, setEngagementType] = useState<Engagement["type"]>("project");
  const [engagementTargetDate, setEngagementTargetDate] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactRole, setContactRole] = useState<Contact["role"]>("contributor");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentScope, setDocumentScope] = useState("all");
  const [includeAccountDocuments, setIncludeAccountDocuments] = useState(true);
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
  const visibleDocuments = documents.filter((document) => documentScope === "all" || (documentScope === "account" ? !document.engagementId : document.engagementId === documentScope || includeAccountDocuments && !document.engagementId));

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
  const selectedEngagement = engagements.find((engagement) => engagement.id === selectedEngagementId);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const [c, t, d, f, ft, u, a, v, e, people] = await Promise.all([
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
        apiFetch<{ engagements: Engagement[] }>(`/api/clients/${id}/engagements`, { token }),
        apiFetch<{ contacts: Contact[] }>(`/api/clients/${id}/contacts`, { token }),
      ]);
      setClient(c.client);
      setTagsInput((c.client.tags || []).join(", "));
      setVesselImo(c.client.customFields?.["Vessel IMO"] || "");
      setFlag(c.client.customFields?.Flag || "");
      setTasks([...t.tasks].sort((x, y) => x.order - y.order));
      setEngagements(e.engagements);
      setContacts(people.contacts);
      setSelectedEngagementId((previous) =>
        e.engagements.some((engagement) => engagement.id === previous)
          ? previous
          : e.engagements.find((engagement) => engagement.status === "active")?.id || e.engagements[0]?.id || ""
      );
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

  async function refreshEngagements() {
    const data = await apiFetch<{ engagements: Engagement[] }>(`/api/clients/${id}/engagements`, { token });
    setEngagements(data.engagements);
  }

  async function createEngagement() {
    if (!engagementName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ engagement: Engagement }>(`/api/clients/${id}/engagements`, {
        method: "POST",
        token,
        body: JSON.stringify({
          name: engagementName.trim(),
          type: engagementType,
          targetDate: engagementTargetDate || null,
        }),
      });
      await refreshEngagements();
      setSelectedEngagementId(data.engagement.id);
      setEngagementOpen(false);
      setEngagementName("");
      setEngagementTargetDate("");
      setMessage("Engagement created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create engagement");
    } finally {
      setBusy(false);
    }
  }

  async function updateEngagement(engagementId: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ engagement: Engagement }>(`/api/engagements/${engagementId}`, {
        method: "PATCH",
        token,
        body: JSON.stringify(patch),
      });
      setEngagements((current) => current.map((item) => item.id === engagementId ? data.engagement : item));
      setMessage("Engagement updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update engagement");
    } finally {
      setBusy(false);
    }
  }

  async function createContact() {
    if (!contactName.trim() || !contactEmail.trim()) return;
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ contact: Contact }>(`/api/clients/${id}/contacts`, {
        method: "POST",
        token,
        body: JSON.stringify({ name: contactName.trim(), email: contactEmail.trim(), role: contactRole }),
      });
      setContacts((current) => [...current, data.contact]);
      setContactOpen(false);
      setContactName("");
      setContactEmail("");
      setMessage("Contact added to the directory.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add contact");
    } finally {
      setBusy(false);
    }
  }

  async function updateContact(contactId: string, role: Contact["role"]) {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ contact: Contact }>(`/api/clients/${id}/contacts/${contactId}`, {
        method: "PATCH", token, body: JSON.stringify({ role }),
      });
      setContacts((current) => current.map((contact) => contact.id === contactId ? data.contact : contact));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update contact");
    } finally {
      setBusy(false);
    }
  }

  async function deleteContact(contactId: string) {
    if (!confirm("Remove this contact from the directory?")) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/clients/${id}/contacts/${contactId}`, { method: "DELETE", token });
      setContacts((current) => current.filter((contact) => contact.id !== contactId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove contact");
    } finally {
      setBusy(false);
    }
  }

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
      if ("status" in patch || "pipelineStage" in patch) await refreshEngagements();
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
      await refreshEngagements();
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
      await refreshEngagements();
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
          engagementId: selectedEngagementId,
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
      await refreshEngagements();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add task");
    } finally {
      setBusy(false);
    }
  }

  async function moveTask(task: Task, direction: -1 | 1) {
    const sorted = tasks.filter((item) => item.engagementId === selectedEngagementId).sort((a, b) => a.order - b.order);
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

  const upcomingEngagement = [...engagements]
    .filter((engagement) => engagement.targetDate && engagement.status !== "completed" && engagement.status !== "cancelled")
    .sort((a, b) => (a.targetDate || "").localeCompare(b.targetDate || ""))[0];
  const upcomingTask = [...tasks]
    .filter((task) => task.dueDate && task.status !== "completed")
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))[0];
  const nextMilestone = upcomingEngagement
    ? `${upcomingEngagement.name} · ${formatDate(upcomingEngagement.targetDate!)}`
    : upcomingTask
      ? `${upcomingTask.title} · ${formatDate(upcomingTask.dueDate!)}`
      : "Nothing scheduled";

  return (
    <div>
      <RecordHeader
        back={{ href: "/clients", label: "Clients" }}
        title={client.name}
        subtitle={`${client.companyName} · ${client.primaryContactEmail}`}
        badges={<>
          <Badge tone={statusTone(client.status)}>{statusLabel(client.status)}</Badge>
          {client.pausedAt || client.pauseReason ? <Badge tone="warning">Paused</Badge> : null}
        </>}
        meta={[
          { label: "Owner", value: client.assignedTeamMemberName || users.find((user) => user.uid === client.assignedTeamMemberId)?.name || "Unassigned" },
          { label: "Next milestone", value: nextMilestone },
          { label: "Progress", value: `${client.completedTasks} of ${client.totalTasks} tasks` },
        ]}
        actions={canManageClient ?
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setCloneEmail("");
                setCloneOpen(true);
              }}
            >
              Clone
            </Button>
            {client.pausedAt || client.pauseReason ? (
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void resumeClient()}>
                Resume
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setPauseReason("");
                  setPauseOpen(true);
                }}
              >
                Pause
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => void inviteClient()} disabled={busy}>
              Invite client
            </Button>
          </> : undefined
        }
      >
        <Tabs
          variant="pills"
          ariaLabel="Client record sections"
          pathname={`/clients/${id}?tab=${tab}`}
          items={TABS.map(([value, label]) => ({ href: `/clients/${id}?tab=${value}`, label, exact: true, count: value === "forms" ? forms.filter((form) => form.status === "submitted").length || undefined : value === "documents" ? documents.filter((document) => document.status === "pending_review").length || undefined : undefined }))}
        />
      </RecordHeader>

      {message ? (
        <p role="status" className="mb-4 rounded-[var(--radius-sm)] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">{message}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg">Account owner</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="account-owner">Assigned team member</Label>
                <Dropdown
                  id="account-owner"
                  value={client.assignedTeamMemberId || ""}
                  disabled={busy || !canManageClient}
                  onChange={(v) => void patchClient({ assignedTeamMemberId: v || null })}
                  options={[
                    { value: "", label: "Unassigned" },
                    ...users.map((u) => ({ value: u.uid, label: u.name })),
                  ]}
                />
              </div>
              {client.pauseReason || client.pausedAt ? (
                <div className="rounded-[var(--radius-sm)] border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
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
            <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg">Work across engagements</h2>
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
                      className="text-[var(--brand)] underline-offset-2 hover:underline"
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
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-lg">Engagements</h2>
                <p className="text-sm text-[var(--ink-muted)]">{engagements.filter((item) => item.status === "active").length} active · {engagements.length} total</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => setTab("engagements")}>View engagements</Button>
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <h2 className="font-[family-name:var(--font-display)] text-lg">Legacy onboarding controls</h2>
            <p className="mb-4 text-sm text-[var(--ink-muted)]">These fields describe the original onboarding record. Use engagement status for newer work.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Dropdown label="Status" value={client.status} disabled={busy || !canManageClient} onChange={(status) => void patchClient({ status: status as ClientStatus })} options={(["not_started", "in_progress", "completed", "on_hold"] as ClientStatus[]).map((status) => ({ value: status, label: statusLabel(status) }))} /></div>
              <div><Dropdown label="Pipeline stage" value={client.pipelineStage || "intake"} disabled={busy || !canManageClient} onChange={(pipelineStage) => void patchClient({ pipelineStage: pipelineStage as PipelineStage })} options={PIPELINE_STAGES.map((stage) => ({ value: stage, label: statusLabel(stage) }))} /></div>
            </div>
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
                  readOnly={!canManageClient}
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
                  readOnly={!canManageClient}
                  value={vesselImo}
                  onChange={(e) => setVesselImo(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div>
                <Label htmlFor="flag">Flag</Label>
                <Input
                  id="flag"
                  readOnly={!canManageClient}
                  value={flag}
                  onChange={(e) => setFlag(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
            {canManageClient ? <div className="mt-4">
              <Button type="button" disabled={busy} onClick={() => void saveTagsAndFields()}>
                Save tags & fields
              </Button>
            </div> : null}
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

      {tab === "engagements" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--ink-muted)]">Separate projects and ongoing service for this account.</p>
            {canManageClient ? <Button type="button" disabled={busy} onClick={() => setEngagementOpen(true)}>New engagement</Button> : null}
          </div>
          {engagements.length === 0 ? <EmptyState title="No engagements yet" description="Create an engagement to organize this client’s work." /> : (
            <div className="grid gap-4 lg:grid-cols-2">
              {engagements.map((engagement) => (
                <Card key={engagement.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-[var(--ink)]">{engagement.name}</h2>
                      <p className="text-sm text-[var(--ink-muted)]">{statusLabel(engagement.type)}</p>
                    </div>
                    <Badge tone={engagement.status === "completed" ? "success" : engagement.status === "paused" || engagement.status === "cancelled" ? "warning" : engagement.status === "active" ? "info" : "neutral"}>{statusLabel(engagement.status)}</Badge>
                  </div>
                  <div className="mt-4 flex justify-between text-sm"><span>{engagement.completedTaskCount} of {engagement.taskCount} tasks</span><span>{engagement.progress}%</span></div>
                  <ProgressBar value={engagement.progress} />
                  <p className="mt-3 text-xs text-[var(--ink-muted)]">Owner: {users.find((user) => user.uid === engagement.ownerId)?.name || "Unassigned"}{engagement.targetDate ? ` · Target ${formatDate(engagement.targetDate)}` : ""}</p>
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <div className="min-w-40 flex-1">{engagement.id === `onboarding_${id}` ? <p className="text-sm text-[var(--ink-muted)]">Onboarding status is managed in the legacy controls on the Overview tab.</p> : <><Dropdown label="Status" value={engagement.status} disabled={busy || !canManageClient} onChange={(status) => void updateEngagement(engagement.id, { status })} options={(["planned", "active", "paused", "completed", "cancelled"] as Engagement["status"][]).map((status) => ({ value: status, label: statusLabel(status) }))} /></>}</div>
                    <Button type="button" variant="secondary" onClick={() => { setSelectedEngagementId(engagement.id); setTab("tasks"); }}>Open tasks</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "overview" ? (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-[family-name:var(--font-display)] text-lg">People</h2><p className="text-sm text-[var(--ink-muted)]">Account contact directory. Adding a contact does not create portal access.</p><p className="text-xs text-[var(--ink-muted)]">Use Invite client in the header to send a portal invitation to the primary contact.</p></div>
            {canManageClient ? <Button type="button" disabled={busy} onClick={() => setContactOpen(true)}>Add contact</Button> : null}
          </div>
          {contacts.length === 0 ? <EmptyState title="No contacts yet" description="Add a contact to keep account details together." /> : (
            <div className="grid gap-3 lg:grid-cols-2">
              {contacts.map((contact) => <Card key={contact.id}>
                <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{contact.name}</h2><p className="break-all text-sm text-[var(--ink-muted)]">{contact.email}</p></div>{canManageClient ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void deleteContact(contact.id)}>Remove</Button> : null}</div>
                <div className="mt-4"><Dropdown label="Directory role" value={contact.role} disabled={busy || !canManageClient} onChange={(role) => void updateContact(contact.id, role as Contact["role"])} options={[{ value: "account_admin", label: "Account admin" }, { value: "contributor", label: "Contributor" }, { value: "viewer", label: "Viewer" }]} /></div>
              </Card>)}
            </div>
          )}
        </div>
      ) : null}

      {tab === "tasks" ? (
        <div className="space-y-4">
          <div className="max-w-md"><Dropdown label="Engagement" value={selectedEngagementId} onChange={setSelectedEngagementId} options={engagements.map((engagement) => ({ value: engagement.id, label: `${engagement.name} · ${statusLabel(engagement.status)}` }))} /></div>
          <TaskBoard
          mode="admin"
          canEdit={canManageClient}
          tasks={tasks.filter((task) => task.engagementId === selectedEngagementId)}
          busy={busy}
          users={users}
          onUpdate={saveTask}
          onDelete={deleteTask}
          onCreate={selectedEngagement && selectedEngagement.status !== "completed" && selectedEngagement.status !== "cancelled" ? createTaskFromBoard : undefined}
          onReorder={moveTask}
        />
        </div>
      ) : null}

      {tab === "documents" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3"><div className="w-full sm:max-w-md"><Label htmlFor="document-scope">Show documents for</Label><Dropdown id="document-scope" value={documentScope} onChange={(value) => { setDocumentScope(value); setSelectedDocs(new Set()); }} options={[{ value: "all", label: "All engagements and account files" }, { value: "account", label: "Account-wide files" }, ...engagements.map((engagement) => ({ value: engagement.id, label: engagement.name }))]} /></div>{documentScope !== "all" && documentScope !== "account" ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeAccountDocuments} onChange={(event) => { setIncludeAccountDocuments(event.target.checked); setSelectedDocs(new Set()); }} />Include account-wide files</label> : null}</div>
        {visibleDocuments.length === 0 ? (
          <EmptyState
            title="No documents"
            description="Documents uploaded by the client will appear here for review."
          />
        ) : (
          <div className="space-y-4">
            {canReviewDocuments ? <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={visibleDocuments.length > 0 && visibleDocuments.every((d) => selectedDocs.has(d.id))}
                  onChange={() => {
                    if (visibleDocuments.every((d) => selectedDocs.has(d.id))) {
                      setSelectedDocs(new Set());
                    } else {
                      setSelectedDocs(new Set(visibleDocuments.map((d) => d.id)));
                    }
                  }}
                />
                Select visible files
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
            </div> : <p className="text-sm text-[var(--ink-muted)]">You can view files and review notes. Document review permission is required to approve or reject files.</p>}
            {visibleDocuments.map((doc) => (
              <Card key={doc.id}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    {canReviewDocuments ? <input
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
                    /> : null}
                    <div className="min-w-0">
                      <p className="break-words font-medium text-[var(--ink)]">{doc.fileName}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        Uploaded {formatDateTime(doc.uploadedAt)} · {(doc.size / 1024).toFixed(1)} KB
                        {doc.versions && doc.versions.length > 0
                          ? ` · ${doc.versions.length + 1} versions`
                          : ""}
                      </p>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{doc.engagementId ? engagements.find((engagement) => engagement.id === doc.engagementId)?.name || "Historical engagement" : "Account-wide file"}</p>
                      {(doc.documentType || doc.expiresAt) && (
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          {doc.documentType ? (
                            <span className="mr-3">Type: {doc.documentType}</span>
                          ) : null}
                          {doc.expiresAt ? (
                            <span
                              className={
                                new Date(doc.expiresAt).getTime() < documentCheckedAt
                                  ? "text-[var(--danger)]"
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
                <DocumentViewer document={doc} token={token} canReplace={canManageClient} onReplaced={(replacement) => { setDocuments((previous) => previous.map((document) => document.id === replacement.id ? replacement : document)); setDocNotes((previous) => ({ ...previous, [replacement.id]: "" })); }} />
                {canReviewDocuments ? <div className="mb-3">
                  <Label htmlFor={`note-${doc.id}`}>Review note</Label>
                  <Textarea
                    id={`note-${doc.id}`}
                    rows={2}
                    value={docNotes[doc.id] || ""}
                    onChange={(e) =>
                      setDocNotes((prev) => ({ ...prev, [doc.id]: e.target.value }))
                    }
                  />
                </div> : doc.reviewNote ? <p className="mb-3 text-sm text-[var(--ink-muted)]">Review note: {doc.reviewNote}</p> : null}
                {canReviewDocuments ? <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void reviewDocument(doc.id, "approved")}
                  >
                    Approve current file
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => void reviewDocument(doc.id, "rejected")}
                  >
                    Reject current file
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
                </div> : null}
              </Card>
            ))}
          </div>
        )}
        </div>
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
                    {canReviewForms ? <Button
                      type="button"
                      disabled={busy || reviewingForm.status === "reviewed"}
                      onClick={() => void reviewForm(reviewingForm.id)}
                    >
                      {reviewingForm.status === "reviewed" ? "Reviewed" : "Mark reviewed"}
                    </Button> : null}
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
                    <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)]/40 p-3">
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
                      disabled={!canReviewForms || reviewingForm.status === "reviewed"}
                    />
                  </div>
                </div>
              ) : null}
            </Modal>
          </>
        )
      ) : null}

      {tab === "messages" ? (
        <ClientMessagesPanel clientId={id} clientName={client.name} engagements={engagements} />
      ) : null}

      {tab === "billing" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg">Engagement summary</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-[var(--ink-muted)]">Active engagements</dt><dd>{engagements.filter((item) => item.status === "active").length}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--ink-muted)]">Completed engagements</dt><dd>{engagements.filter((item) => item.status === "completed").length}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--ink-muted)]">Work complete</dt><dd>{client.completedTasks} of {client.totalTasks} tasks ({client.progress}%)</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[var(--ink-muted)]">Client since</dt><dd>{formatDate(client.createdAt)}</dd></div>
            </dl>
          </Card>
          <Card>
            <h2 className="mb-2 font-[family-name:var(--font-display)] text-lg">Invoices and ledger</h2>
            <p className="text-sm leading-6 text-[var(--ink-muted)]">Boatship does not yet keep invoices per client. Money in and out is recorded in the workspace ledger{session?.role === "admin" ? "" : ", which administrators maintain"}.</p>
            {session?.role === "admin" ? <div className="mt-4"><Link href="/accounting" prefetch={false} className="text-sm font-semibold text-[var(--brand)] hover:underline">Open the ledger</Link></div> : null}
            {client.driveFolderUrl ? <p className="mt-4 text-sm text-[var(--ink-muted)]">Contracts and signed documents live in the client&apos;s <a href={client.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--brand)] hover:underline">Drive folder</a>.</p> : null}
          </Card>
        </div>
      ) : null}

      {tab === "vessels" ? (
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--ink-muted)]">
              {vessels.length} vessel{vessels.length === 1 ? "" : "s"} registered
            </p>
            {canManageClient ? <Button type="button" size="sm" onClick={openNewVessel} disabled={busy}>
              Add vessel
            </Button> : null}
          </div>

          {vessels.length === 0 ? (
            <EmptyState
              title="No vessels yet"
              description="Add vessels with IMO, flag, type, and class society."
              action={canManageClient ?
                <Button type="button" onClick={openNewVessel}>
                  Add vessel
                </Button> : undefined
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
                    {canManageClient ? <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => openEditVessel(vessel)}>
                        Edit
                      </Button>
                      <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void deleteVessel(vessel.id)}>
                        Delete
                      </Button>
                    </div> : null}
                  </Card>
                ))}
              </div>
              <Card className="hidden overflow-hidden p-0 sm:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Name</th>
                      <th className="px-5 py-3 font-semibold">IMO</th>
                      <th className="px-5 py-3 font-semibold">Flag</th>
                      <th className="px-5 py-3 font-semibold">Type</th>
                      <th className="px-5 py-3 font-semibold">Class society</th>
                      <th className="px-5 py-3 font-semibold">Notes</th>
                      <th className="px-5 py-3 font-semibold" />
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
                            {canManageClient ? <><Button
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
                            </Button></> : null}
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
            open={vesselModalOpen && canManageClient}
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

      {tab === "overview" ? (
        <div className="mt-6">
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg">Timeline</h2>
        {activity.length === 0 ? (
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
        )}
        </div>
      ) : null}

      {inviteOpen && inviteResult ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close invite dialog"
            className="absolute inset-0 bg-[var(--scrim)]"
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
        open={contactOpen && canManageClient}
        onClose={() => setContactOpen(false)}
        title="Add contact"
        description="Directory entries do not grant portal access."
        footer={<><Button type="button" variant="ghost" onClick={() => setContactOpen(false)}>Cancel</Button><Button type="button" disabled={busy || !contactName.trim() || !contactEmail.trim()} onClick={() => void createContact()}>{busy ? "Adding…" : "Add contact"}</Button></>}
      >
        <div className="space-y-4">
          <div><Label htmlFor="contact-name">Name</Label><Input id="contact-name" value={contactName} onChange={(event) => setContactName(event.target.value)} maxLength={160} /></div>
          <div><Label htmlFor="contact-email">Email</Label><Input id="contact-email" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></div>
          <div><Dropdown label="Directory role" value={contactRole} onChange={(role) => setContactRole(role as Contact["role"])} options={[{ value: "account_admin", label: "Account admin" }, { value: "contributor", label: "Contributor" }, { value: "viewer", label: "Viewer" }]} /></div>
        </div>
      </Modal>

      <Modal
        open={engagementOpen && canManageClient}
        onClose={() => setEngagementOpen(false)}
        title="New engagement"
        description="Add another piece of work under this client account."
        footer={<><Button type="button" variant="ghost" onClick={() => setEngagementOpen(false)}>Cancel</Button><Button type="button" disabled={busy || !engagementName.trim()} onClick={() => void createEngagement()}>{busy ? "Creating…" : "Create engagement"}</Button></>}
      >
        <div className="space-y-4">
          <div><Label htmlFor="engagement-name">Name</Label><Input id="engagement-name" value={engagementName} onChange={(event) => setEngagementName(event.target.value)} maxLength={160} placeholder="e.g. Website relaunch" /></div>
          <div><Dropdown label="Type" value={engagementType} onChange={(value) => setEngagementType(value as Engagement["type"])} options={[{ value: "onboarding", label: "Onboarding" }, { value: "project", label: "Project" }, { value: "ongoing_service", label: "Ongoing service" }]} /></div>
          <div><Label htmlFor="engagement-target">Target date (optional)</Label><Input id="engagement-target" type="date" value={engagementTargetDate} onChange={(event) => setEngagementTargetDate(event.target.value)} /></div>
        </div>
      </Modal>

      <Modal
        open={cloneOpen && canManageClient}
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
        open={pauseOpen && canManageClient}
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

export default function ClientDetailPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--ink-muted)]">Loading client…</p>}>
      <ClientDetailInner />
    </Suspense>
  );
}
