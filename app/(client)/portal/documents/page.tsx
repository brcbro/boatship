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
import { formatDateTime, formatDate, statusLabel } from "@/lib/utils";
import type { DocumentRecord, Task } from "@/types";

const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

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
    return "File size must be 10MB or less.";
  }
  return null;
}

function DocumentsPageInner() {
  const searchParams = useSearchParams();
  const taskIdFromQuery = searchParams.get("taskId") || "";
  const { session, token, loading: authLoading } = useAuth();

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
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

  const load = useCallback(async () => {
    if (!session?.clientId) {
      setError("No client account is linked to this user.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const clientId = session.clientId;
      const [docsRes, tasksRes] = await Promise.all([
        apiFetch<{ documents: DocumentRecord[] }>(
          `/api/documents?clientId=${encodeURIComponent(clientId)}`,
          { token }
        ),
        apiFetch<{ tasks: Task[] }>(`/api/tasks?clientId=${encodeURIComponent(clientId)}`, {
          token,
        }),
      ]);
      setDocuments(
        [...docsRes.documents].sort(
          (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
        )
      );
      setAllTasks(tasksRes.tasks.filter((t) => t.type === "client_facing"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [session?.clientId, token]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  useEffect(() => {
    if (taskIdFromQuery) setTaskId(taskIdFromQuery);
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
        <EmptyState
          title="No client linked"
          description="No client account is linked to this user."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Upload required files for review. PDF and images up to 10MB."
      />

      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      <Card className="mb-8">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
          Upload a document
        </h2>
        <form onSubmit={(e) => void onUpload(e)} className="space-y-4">
          <div>
            <Label htmlFor="document-file">File</Label>
            <Input
              id="document-file"
              type="file"
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
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Accepted: pdf, png, jpg, jpeg, webp · Max 10MB
            </p>
          </div>

          <div>
            <Label htmlFor="task-select">Related task (optional)</Label>
            <Select
              id="task-select"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
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

          <Button type="submit" disabled={uploading || !file}>
            {uploading ? "Uploading…" : "Upload document"}
          </Button>
        </form>
      </Card>

      {documents.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Uploaded files will appear here with review status."
        />
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <Card key={doc.id}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-[var(--ink)]">{doc.fileName}</p>
                    <Badge tone={docStatusTone(doc.status)}>{statusLabel(doc.status)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    Uploaded {formatDateTime(doc.uploadedAt)}
                    {doc.taskId
                      ? ` · Task: ${taskMap.get(doc.taskId)?.title || doc.taskId}`
                      : ""}
                  </p>
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
      <DocumentsPageInner />
    </Suspense>
  );
}
