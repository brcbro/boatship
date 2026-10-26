"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { DocumentViewer } from "@/components/shared/DocumentViewer";
import { formatDateTime, formatDate, formatDueDate, statusLabel } from "@/lib/utils";
import type { DocumentRecord, Task } from "@/types";

const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const MAX_BYTES = 25 * 1024 * 1024;
type Engagement = { id: string; name: string; status: string };

function docStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "pending_review") return "warning";
  return "neutral";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function validateFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXT.has(ext)) {
    return "File type must be pdf, png, jpg, jpeg, or webp.";
  }
  const type = (file.type || "").toLowerCase();
  if (type && !ALLOWED_TYPES.has(type)) {
    return "File type must be pdf, png, jpg, jpeg, or webp.";
  }
  if (file.size > MAX_BYTES) {
    return "File size must be 25MB or less.";
  }
  return null;
}

function DocumentsPageInner() {
  const searchParams = useSearchParams();
  const taskIdFromQuery = searchParams.get("taskId") || "";
  const engagementIdFromQuery = searchParams.get("engagementId") || "";
  const { session, token, loading: authLoading } = useAuth();
  const clientId = session?.clientId;

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [engagementId, setEngagementId] = useState(engagementIdFromQuery);
  const [documentScope, setDocumentScope] = useState(engagementIdFromQuery || "all");
  const [includeAccountWide, setIncludeAccountWide] = useState(true);
  const [taskId, setTaskId] = useState(taskIdFromQuery);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");


  const uploadTasks = useMemo(
    () =>
      allTasks.filter(
        (t) => t.type === "client_facing" && t.requiresUpload && t.status !== "completed"
      ),
    [allTasks]
  );

  const taskMap = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of allTasks) map.set(t.id, t);
    return map;
  }, [allTasks]);
  const selectedTask = taskMap.get(taskId);
  const uploadEngagementId = selectedTask?.engagementId || engagementId;
  const visibleDocuments = documents.filter((document) => documentScope === "all" || (documentScope === "account" ? !document.engagementId : document.engagementId === documentScope || includeAccountWide && !document.engagementId));

  const load = useCallback(async () => {
    if (!clientId) {
      setError("No client account is linked to this user.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [docsRes, tasksRes, engagementRes] = await Promise.all([
        apiFetch<{ documents: DocumentRecord[] }>(
          `/api/documents?clientId=${encodeURIComponent(clientId)}`,
          { token }
        ),
        apiFetch<{ tasks: Task[] }>(`/api/tasks?clientId=${encodeURIComponent(clientId)}`, {
          token,
        }),
        apiFetch<{ engagements: Engagement[] }>(`/api/clients/${encodeURIComponent(clientId)}/engagements`, { token }),
      ]);
      setDocuments(
        [...docsRes.documents].sort(
          (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
        )
      );
      setAllTasks(tasksRes.tasks.filter((t) => t.type === "client_facing"));
      setEngagements(engagementRes.engagements);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [clientId, token]);

  useEffect(() => {
    if (authLoading) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, load]);

  useEffect(() => {
    if (!taskIdFromQuery) return;
    const timer = window.setTimeout(() => setTaskId(taskIdFromQuery), 0);
    return () => window.clearTimeout(timer);
  }, [taskIdFromQuery]);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!session?.clientId || !file) {
      setError("Choose a file to upload.");
      return;
    }

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setUploading(true);
    setError("");
    setSuccess("");
    try {
      const contentType =
        file.type ||
        (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");

      const urlRes = await apiFetch<{ storagePath: string; uploadMode: string }>(
        "/api/documents/upload-url",
        {
          method: "POST",
          token,
          body: JSON.stringify({
            clientId: session.clientId,
            fileName: file.name,
            contentType,
            size: file.size,
          }),
        }
      );

      const base64 = await fileToBase64(file);
      const uploadRes = await apiFetch<{ document: DocumentRecord }>("/api/documents/upload", {
        method: "POST",
        token,
        body: JSON.stringify({
          clientId: session.clientId,
          taskId: taskId || null,
          engagementId: uploadEngagementId || null,
          fileName: file.name,
          contentType,
          size: file.size,
          base64,
          storagePath: urlRes.storagePath,
        }),
      });

      setDocuments((prev) => [uploadRes.document, ...prev]);
      setFile(null);
      setSuccess(`Uploaded ${uploadRes.document.fileName}`);
      const input = window.document.getElementById("document-file") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div>
        <PageHeader title="Documents" description="Loading your uploads…" />
        <Card>
          <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
        </Card>
      </div>
    );
  }

  if (!session?.clientId) {
    return (
      <div>
        <PageHeader title="Documents" />
        <Card><h2 className="text-lg font-semibold text-[var(--ink)]">Your account needs a client workspace</h2><p className="mt-2 max-w-prose text-sm leading-6 text-[var(--ink-muted)]">Ask your Boatship workspace administrator to connect your account. Share your sign-in email: <span className="font-medium text-[var(--ink)]">{session?.email || "the email you used to sign in"}</span>.</p></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Documents"
        description="See what your team has requested and track every file through review."
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-[var(--radius-sm)] border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="mb-4 rounded-[var(--radius-sm)] border border-[var(--success)]/30 bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
          {success}
        </p>
      ) : null}

      {uploadTasks.length > 0 ? <section aria-labelledby="requested-files-heading" className="mb-8"><div className="mb-3"><h2 id="requested-files-heading" className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">Files your team needs</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Choose a request to attach your upload to the right task.</p></div><div className="space-y-3">{uploadTasks.map((task) => { const related = documents.filter((doc) => doc.taskId === task.id); const latest = related[0]; return <Card key={task.id} className="p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-sm font-semibold text-[var(--ink)]">{task.title}</h3>{task.description ? <p className="mt-1 max-w-prose text-sm leading-6 text-[var(--ink-muted)]">{task.description}</p> : null}<p className="mt-2 text-sm text-[var(--ink-muted)]">{task.engagementId ? `${engagements.find((engagement) => engagement.id === task.engagementId)?.name || "Historical engagement"} · ` : ""}{task.dueDate ? `Due ${formatDueDate(task.dueDate)} · ` : ""}{latest ? `Latest upload: ${statusLabel(latest.status)}` : "No file uploaded yet"}</p>{latest?.reviewNote ? <p className="mt-2 text-sm text-[var(--danger)]">Team feedback: {latest.reviewNote}</p> : null}</div><Button type="button" variant="secondary" onClick={() => { if (latest?.status === "rejected") { setDocumentScope("all"); window.requestAnimationFrame(() => window.document.getElementById(`uploaded-${latest.id}`)?.focus()); } else { setTaskId(task.id); setEngagementId(task.engagementId || ""); window.document.getElementById("document-file")?.focus(); } }}>{latest?.status === "rejected" ? "View file and replace" : "Upload for this task"}</Button></div></Card>; })}</div></section> : null}

      <Card className="mb-8">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
          {selectedTask ? `Upload for ${selectedTask.title}` : "Upload another document"}
        </h2>
        {selectedTask ? <p className="mb-4 text-sm leading-6 text-[var(--ink-muted)]">{selectedTask.description || "Attach a file requested for this task."}{selectedTask.dueDate ? ` Due ${formatDueDate(selectedTask.dueDate)}.` : ""}</p> : <p className="mb-4 text-sm text-[var(--ink-muted)]">Use this for files your team has not specifically requested.</p>}
        <form onSubmit={(e) => void onUpload(e)} className="space-y-4">
          <div>
            <Label htmlFor="document-file">File</Label>
            <Input
              id="document-file"
              type="file"
              aria-describedby="document-file-help"
              accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                setFile(next);
                setSuccess("");
                if (next) {
                  const msg = validateFile(next);
                  setError(msg || "");
                }
              }}
              required
            />
            <p id="document-file-help" className="mt-1 text-xs text-[var(--ink-muted)]">
              Accepted: pdf, png, jpg, jpeg, webp · Max 25MB
            </p>
          </div>

          <div>
            <Label htmlFor="task-select">Related task (optional)</Label>
            <Select
              id="task-select"
              value={taskId}
              onChange={(e) => { setTaskId(e.target.value); setEngagementId(taskMap.get(e.target.value)?.engagementId || ""); }}
            >
              <option value="">No related task</option>
              {uploadTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
              {taskId && !uploadTasks.some((t) => t.id === taskId) ? (
                <option value={taskId}>Selected task</option>
              ) : null}
            </Select>
          </div>

          <div><Label htmlFor="upload-engagement">Engagement (optional)</Label><Select id="upload-engagement" value={uploadEngagementId} disabled={!!selectedTask} onChange={(event) => setEngagementId(event.target.value)} aria-describedby="upload-engagement-help"><option value="">Account-wide file</option>{engagements.map((engagement) => <option key={engagement.id} value={engagement.id}>{engagement.name}</option>)}</Select><p id="upload-engagement-help" className="mt-1 text-sm text-[var(--ink-muted)]">{selectedTask ? "This file follows the selected task’s engagement." : "Use account-wide for files shared across your engagements."}</p></div>

          <Button type="submit" disabled={uploading || !file} className="w-full sm:w-auto">
            {uploading ? "Uploading…" : "Upload document"}
          </Button>
        </form>
      </Card>

      <div className="mb-4 flex flex-wrap items-end gap-3"><div className="w-full sm:max-w-md"><Label htmlFor="portal-document-scope">Show uploads for</Label><Select id="portal-document-scope" value={documentScope} onChange={(event) => setDocumentScope(event.target.value)}><option value="all">All engagements and account files</option><option value="account">Account-wide files</option>{engagements.map((engagement) => <option key={engagement.id} value={engagement.id}>{engagement.name}</option>)}{documentScope !== "all" && documentScope !== "account" && !engagements.some((engagement) => engagement.id === documentScope) ? <option value={documentScope}>Historical engagement</option> : null}</Select></div>{documentScope !== "all" && documentScope !== "account" ? <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={includeAccountWide} onChange={(event) => setIncludeAccountWide(event.target.checked)} />Include account-wide files</label> : null}</div>
      {visibleDocuments.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Uploaded files will appear here with review status."
        />
      ) : (
        <div className="space-y-3">
          {visibleDocuments.map((doc) => (
            <Card key={doc.id} id={`uploaded-${doc.id}`} tabIndex={-1}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-words font-medium text-[var(--ink)]">{doc.fileName}</p>
                    <Badge tone={docStatusTone(doc.status)}>{statusLabel(doc.status)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    Uploaded {formatDateTime(doc.uploadedAt)}
                    {doc.taskId
                      ? ` · Task: ${taskMap.get(doc.taskId)?.title || doc.taskId}`
                      : ""}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{doc.engagementId ? engagements.find((engagement) => engagement.id === doc.engagementId)?.name || "Historical engagement" : "Account-wide file"}</p>
                  {doc.reviewNote ? (
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">
                      Review note: {doc.reviewNote}
                    </p>
                  ) : null}
                </div>
                <p className="text-xs text-[var(--ink-muted)]">
                  {(doc.size / 1024).toFixed(1)} KB · {formatDate(doc.uploadedAt)}
                </p>
              </div>
              <DocumentViewer document={doc} token={token} canReplace onReplaced={(replacement) => setDocuments((previous) => previous.map((document) => document.id === replacement.id ? replacement : document))} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PortalDocumentsPage() {
  return (
    <Suspense
      fallback={
        <div>
          <PageHeader title="Documents" description="Loading your uploads…" />
          <Card>
            <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
          </Card>
        </div>
      }
    >
      <DocumentsRoute />
    </Suspense>
  );
}

function DocumentsRoute() {
  const query = useSearchParams();
  return <DocumentsPageInner key={`${query.get("taskId") || ""}:${query.get("engagementId") || ""}`} />;
}
