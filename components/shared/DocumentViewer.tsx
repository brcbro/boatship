"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Download, Eye, RefreshCw } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";
import type { DocumentRecord } from "@/types";

const PREVIEW_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"]);
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

async function responseError(response: Response) {
  const data = await response.json().catch(() => ({})) as { error?: string };
  return data.error || (response.status === 404 ? "This file is unavailable. Ask your team to upload a replacement." : "Unable to retrieve this file. Try again.");
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to read this file."));
    reader.onerror = () => reject(new Error("Unable to read this file."));
    reader.readAsDataURL(file);
  });
}

/** Binary content is requested only after an explicit view/download action. */
export function DocumentViewer({ document: record, token, canReplace = false, onReplaced }: {
  document: DocumentRecord;
  token: string | null;
  canReplace?: boolean;
  onReplaced?: (document: DocumentRecord) => void;
}) {
  const id = useId();
  const [version, setVersion] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<{ url: string; contentType: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [replacing, setReplacing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const requestKey = useRef(0);
  const chosen = version === "" ? record : record.versions[Number(version)];
  const missingContent = chosen?.contentAvailable === false;
  const endpoint = `/api/documents/${encodeURIComponent(record.id)}/content${version === "" ? "" : `?version=${version}`}`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!expanded || missingContent) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    // A changed authenticated file request must clear the old blob while its replacement loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(null);
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!response.ok) throw new Error(await responseError(response));
        const contentType = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() || "";
        if (!PREVIEW_TYPES.has(contentType)) throw new Error("This file cannot be previewed here. Download it to open it on your device.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ url: objectUrl, contentType });
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to preview this file.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [expanded, endpoint, token, retry, record.uploadedAt, missingContent]);

  async function download() {
    const currentRequest = ++requestKey.current;
    setDownloading(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}disposition=attachment`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(await responseError(response));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = chosen?.fileName || record.fileName;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      if (mounted.current && currentRequest === requestKey.current) setError(err instanceof Error ? err.message : "Download failed. Try again.");
    } finally {
      if (mounted.current && currentRequest === requestKey.current) setDownloading(false);
    }
  }

  async function replace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const contentType = file.type || ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" } as Record<string, string>)[extension];
    if (!PREVIEW_TYPES.has(contentType) || file.size === 0 || file.size > 10 * 1024 * 1024) {
      setUploadError("Choose a PDF, PNG, JPG, or WebP file under 10 MB.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const location = await apiFetch<{ storagePath: string }>("/api/documents/upload-url", { token, method: "POST", body: JSON.stringify({ clientId: record.clientId, fileName: file.name, contentType, size: file.size }) });
      const result = await apiFetch<{ document: DocumentRecord }>("/api/documents/upload", { token, method: "POST", body: JSON.stringify({ clientId: record.clientId, documentId: record.id, fileName: file.name, contentType, size: file.size, base64: await toBase64(file), storagePath: location.storagePath }) });
      onReplaced?.(result.document);
      setVersion("");
      setFile(null);
      setReplacing(false);
      setNotice("Replacement uploaded and waiting for team review. The previous file is kept in version history.");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Replacement failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mb-4 mt-3 min-w-0 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        {record.versions?.length ? <div className="w-full sm:w-auto sm:min-w-64 sm:max-w-sm"><Label htmlFor={`${id}-version`}>File version</Label><Select id={`${id}-version`} value={version} onChange={(event) => { setVersion(event.target.value); setError(""); }} disabled={uploading || downloading}>
          <option value="">Current · {formatDateTime(record.uploadedAt)}</option>
          {record.versions.map((previous, index) => <option key={`${previous.storagePath}-${index}`} value={String(index)}>Version {index + 1} · {formatDateTime(previous.uploadedAt)}</option>)}
        </Select></div> : null}
        <Button type="button" variant="secondary" size="sm" disabled={missingContent && !expanded} aria-expanded={expanded} aria-controls={`${id}-preview`} onClick={() => setExpanded((value) => !value)}><Eye className="h-4 w-4" aria-hidden="true" />{expanded ? "Close preview" : "View file"}</Button>
        <Button type="button" variant="secondary" size="sm" disabled={downloading || missingContent} onClick={() => void download()}><Download className="h-4 w-4" aria-hidden="true" />{downloading ? "Downloading…" : "Download"}</Button>
        {canReplace ? <Button type="button" variant="ghost" size="sm" disabled={uploading} aria-expanded={replacing} aria-controls={`${id}-replace`} onClick={() => { setReplacing((value) => !value); setUploadError(""); setNotice(""); }}><RefreshCw className="h-4 w-4" aria-hidden="true" />Replace file</Button> : null}
      </div>
      {missingContent ? <p className="text-sm text-[var(--danger)]">{version === "" ? "The current file content is missing." : "This previous file version is unavailable."} {canReplace && version === "" ? "Upload a replacement to restore it." : "Choose another version or ask your team for the file."}</p> : null}
      {version !== "" ? <p className="text-sm text-[var(--ink-muted)]">A previous version is selected. Review status and replacement apply to the current file.</p> : null}
      {notice ? <p role="status" className="text-sm text-[var(--success)]">{notice}</p> : null}
      {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--danger)]"><p>{error}</p>{expanded ? <Button type="button" variant="secondary" size="sm" onClick={() => setRetry((value) => value + 1)}>Try preview again</Button> : null}</div> : null}
      {expanded ? <section id={`${id}-preview`} aria-label={`Preview of ${chosen?.fileName || record.fileName}`} aria-busy={loading} className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <p className="border-b border-[var(--border)] px-3 py-2 text-sm break-words text-[var(--ink-muted)]">{chosen?.fileName || record.fileName}{version === "" ? " · Current file" : ` · Previous version ${Number(version) + 1}`}</p>
        {loading && !missingContent ? <div role="status" className="flex min-h-48 items-center justify-center px-4 text-sm text-[var(--ink-muted)]">Loading file preview…</div> : preview && !missingContent ? preview.contentType === "application/pdf" ? <><iframe src={preview.url} title={`PDF preview: ${chosen?.fileName || record.fileName}`} className="h-[min(60vh,560px)] min-h-72 w-full" /><p className="px-3 py-2 text-sm text-[var(--ink-muted)]">If your browser does not show the PDF, use Download to open it.</p></> : (
          // Blob URLs contain only the allowlisted image types returned by the authenticated content route.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={`Uploaded document: ${chosen?.fileName || record.fileName}`} className="mx-auto max-h-[60vh] max-w-full object-contain p-3" />
        ) : null}
      </section> : null}
      {replacing && canReplace ? <form id={`${id}-replace`} onSubmit={(event) => void replace(event)} className="space-y-3 border-t border-[var(--border)] pt-3">
        <div><Label htmlFor={`${id}-file`}>Replacement file</Label><Input id={`${id}-file`} type="file" accept={ACCEPT} required disabled={uploading} aria-describedby={`${id}-help`} onChange={(event) => setFile(event.target.files?.[0] || null)} /><p id={`${id}-help`} className="mt-1 text-sm text-[var(--ink-muted)]">PDF, PNG, JPG, or WebP · Max 10 MB. Replacing this file keeps its history and resets review status.</p></div>
        {uploadError ? <p role="alert" className="text-sm text-[var(--danger)]">{uploadError}</p> : null}
        <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={uploading || !file}>{uploading ? "Uploading replacement…" : "Upload replacement"}</Button><Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={() => { setReplacing(false); setFile(null); }}>Cancel replacement</Button></div>
      </form> : null}
    </div>
  );
}
