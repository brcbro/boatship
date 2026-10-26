"use client";

import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Link2, Unplug } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import type { IntegrationJobKind, IntegrationJobStatus } from "@/lib/integration-job-policy";

type JobRow = {
  id: string; clientId: string; clientName: string; kind: IntegrationJobKind; status: IntegrationJobStatus;
  attempts: number; nextAttemptAt: string; error: string | null; retryable: boolean; createdAt: string; updatedAt: string;
};

const JOB_NAMES: Record<IntegrationJobKind, string> = { "drive.folder": "Drive client folder", "slack.event": "Slack update", "hubspot.contact": "HubSpot contact" };
const JOB_STATUSES: Record<IntegrationJobStatus, string> = { pending: "Queued", processing: "Sending", succeeded: "Complete", skipped: "Needs connection", failed: "Stopped" };

type ToolkitRow = {
  slug: string;
  name: string;
  description: string;
  connected: boolean;
  connectedAccountId: string | null;
  status: string | null;
  testTool: string | null;
};

type IntegrationsResponse = {
  configured: boolean;
  toolkits: ToolkitRow[];
  message?: string;
  slackChannel?: string | null;
  workflows: Array<{
    title: string;
    tools: readonly string[];
    outcome: string;
    status: "available" | "not_enabled";
  }>;
};

type SecretProvider = "composio" | "openrouter";

type SecretStatus = {
  provider: SecretProvider;
  configured: boolean;
  last4?: string | null;
  updatedAt?: string | null;
};

type SecretStatusResponse = {
  secrets: SecretStatus[];
};

type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
};

function getDriveFiles(result: unknown): DriveFile[] {
  if (!result || typeof result !== "object") return [];
  const record = result as Record<string, unknown>;
  const data = record.data && typeof record.data === "object"
    ? (record.data as Record<string, unknown>)
    : record;
  const items = data.files ?? data.items;
  if (!Array.isArray(items)) return [];

  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const file = item as Record<string, unknown>;
    const name = typeof file.name === "string" ? file.name : null;
    if (!name) return [];
    return [{
      id: typeof file.id === "string" ? file.id : name,
      name,
      mimeType: typeof file.mimeType === "string" ? file.mimeType : undefined,
      webViewLink: typeof file.webViewLink === "string" ? file.webViewLink : undefined,
    }];
  });
}

function IntegrationsContent() {
  const { token, session } = useAuth();
  // Workspace credentials are admin-only; team members never load or see them.
  const isAdmin = session?.role === "admin";
  const searchParams = useSearchParams();
  const [confirmDisconnect, setConfirmDisconnect] = useState<ToolkitRow | null>(null);
  const [confirmRemoveSecret, setConfirmRemoveSecret] = useState<SecretProvider | null>(null);
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [testChannel, setTestChannel] = useState("");
  const [testing, setTesting] = useState(false);
  const [testingDrive, setTestingDrive] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);
  const [secretStatuses, setSecretStatuses] = useState<SecretStatus[]>([]);
  const [secretsLoading, setSecretsLoading] = useState(true);
  const [secretBusy, setSecretBusy] = useState<SecretProvider | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState("");
  const [retryingJob, setRetryingJob] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError("");
    try {
      const response = await apiFetch<{ jobs: JobRow[] }>("/api/integrations/jobs", { token });
      setJobs(response.jobs);
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "Integration work could not be loaded.");
    } finally { setJobsLoading(false); }
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<IntegrationsResponse>("/api/integrations", { token });
      setData(res);
      setTestChannel((prev) => prev || res.slackChannel || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadSecretStatuses = useCallback(async () => {
    if (!isAdmin) {
      setSecretStatuses([]);
      setSecretsLoading(false);
      return;
    }
    setSecretsLoading(true);
    try {
      const response = await apiFetch<SecretStatusResponse>("/api/settings/secrets", { token });
      setSecretStatuses(response.secrets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load credential status");
    } finally {
      setSecretsLoading(false);
    }
  }, [token, isAdmin]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
      void loadSecretStatuses();
      void loadJobs();
    }, 0);
    return () => clearTimeout(timer);
  }, [load, loadSecretStatuses, loadJobs]);

  useEffect(() => {
    if (!jobs.some((job) => job.status === "pending" || job.status === "processing")) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void loadJobs(); }, 60_000);
    return () => clearInterval(timer);
  }, [jobs, loadJobs]);

  async function retryJob(id: string) {
    setRetryingJob(id);
    setJobsError("");
    try {
      await apiFetch("/api/integrations/jobs", { method: "POST", token, body: JSON.stringify({ id }) });
      setMessage("Integration work queued; delivery starts shortly.");
      await loadJobs();
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "This work could not be queued again.");
    } finally { setRetryingJob(null); }
  }

  useEffect(() => {
    const connected = searchParams.get("connected");
    if (!connected) return;
    const timer = setTimeout(() => {
      setMessage(`${connected} connected successfully. You can disconnect anytime below.`);
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [searchParams, load]);

  async function connect(slug: string) {
    setBusySlug(slug);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch<{ redirectUrl: string }>("/api/integrations", {
        method: "POST",
        token,
        body: JSON.stringify({ toolkit: slug }),
      });
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl);
        return;
      }
      setError("No connect URL returned");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start connect");
    } finally {
      setBusySlug(null);
    }
  }

  async function disconnect(row: ToolkitRow) {
    if (!row.connectedAccountId) return;
    setBusySlug(row.slug);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/api/integrations/${row.connectedAccountId}`, {
        method: "DELETE",
        token,
      });
      setMessage(`${row.name} disconnected.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setBusySlug(null);
    }
  }

  async function saveSecret(provider: SecretProvider, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("secret") as HTMLInputElement | null;
    const value = input?.value.trim() || "";
    if (!value) {
      setError("Enter a credential before saving.");
      return;
    }

    setSecretBusy(provider);
    setError("");
    setMessage("");
    try {
      await apiFetch("/api/settings/secrets", {
        method: "POST",
        token,
        body: JSON.stringify({ provider, value }),
      });
      setMessage(`${provider === "composio" ? "Composio" : "OpenRouter"} credential saved securely.`);
      form.reset();
      await Promise.all([loadSecretStatuses(), load()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save credential");
      form.reset();
    } finally {
      setSecretBusy(null);
    }
  }

  async function removeSecret(provider: SecretProvider) {
    setSecretBusy(provider);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/api/settings/secrets/${encodeURIComponent(provider)}`, {
        method: "DELETE",
        token,
      });
      setMessage(`${provider === "composio" ? "Composio" : "OpenRouter"} credential removed.`);
      await Promise.all([loadSecretStatuses(), load()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove credential");
    } finally {
      setSecretBusy(null);
    }
  }

  async function testSlack() {
    if (!testChannel.trim()) {
      setError("Enter a Slack channel id or name (e.g. #general or C01234567)");
      return;
    }
    setTesting(true);
    setError("");
    setMessage("");
    try {
      await apiFetch("/api/integrations/execute", {
        method: "POST",
        token,
        body: JSON.stringify({
          tool: "SLACK_SEND_MESSAGE",
          channel: testChannel.trim(),
        }),
      });
      setMessage("Test message sent to Slack.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Slack test failed");
    } finally {
      setTesting(false);
    }
  }

  async function testDrive() {
    setTestingDrive(true);
    setError("");
    setMessage("");
    setDriveFiles(null);
    try {
      const response = await apiFetch<{ result: unknown }>("/api/integrations/execute", {
        method: "POST",
        token,
        // The server fixes the test arguments (five files with the fields this list renders).
        body: JSON.stringify({ tool: "GOOGLEDRIVE_FIND_FILE" }),
      });
      const files = getDriveFiles(response.result);
      setDriveFiles(files);
      setMessage(
        files.length
          ? `Found ${files.length} recent Drive file${files.length === 1 ? "" : "s"}.`
          : "Drive responded, but no files were found."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drive test failed");
    } finally {
      setTestingDrive(false);
    }
  }

  const slackConnected = data?.toolkits.some((t) => t.slug === "slack" && t.connected);
  const driveConnected = data?.toolkits.some((t) => t.slug === "googledrive" && t.connected);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="Client workspace integrations"
        description="Connect the systems that support client delivery. Connections belong to the signed-in team member, and Hodi can use their connected tools for client work."
      />

      {error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-[var(--radius-sm)] border border-[var(--brand)]/20 bg-[var(--brand)]/5 px-3 py-2 text-sm text-[var(--ink)]">
          {message}
        </p>
      ) : null}

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">Recent integration work</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Client folders, team updates, and CRM contacts are tracked here. Queued work starts as soon as it is added; an hourly run retries anything that was interrupted.</p>
          </div>
          <Button type="button" size="sm" variant="secondary" disabled={jobsLoading} onClick={() => void loadJobs()}>{jobsLoading ? "Refreshing…" : "Refresh"}</Button>
        </div>
        {jobsError ? <p role="alert" className="text-sm text-[var(--danger)]">{jobsError}</p> : null}
        {jobsLoading && !jobs.length ? <p role="status" className="text-sm text-[var(--ink-muted)]">Loading recent work…</p> : jobs.length ? (
          <ul className="divide-y divide-[var(--border)]" aria-label="Integration work">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--ink)]">{JOB_NAMES[job.kind]} <span className="font-normal text-[var(--ink-muted)]">· {job.clientName}</span></p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">{job.attempts} {job.attempts === 1 ? "attempt" : "attempts"} · {new Date(job.updatedAt).toLocaleString()}</p>
                  {job.error ? <p className="mt-1 text-sm text-[var(--ink-muted)]">{job.error}</p> : null}
                  {job.status === "pending" && job.error ? <p className="mt-1 text-xs text-[var(--ink-muted)]">Retry after {new Date(job.nextAttemptAt).toLocaleString()}</p> : null}
                  {job.status === "failed" ? <p className="mt-1 text-xs text-[var(--ink-muted)]">Retrying an unconfirmed delivery can create a repeated team update.</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={job.status === "succeeded" ? "success" : job.status === "failed" ? "danger" : "neutral"}>{JOB_STATUSES[job.status]}</Badge>
                  {job.retryable ? <Button type="button" size="sm" variant="secondary" disabled={retryingJob !== null} onClick={() => void retryJob(job.id)} aria-label={`Retry ${JOB_NAMES[job.kind]} for ${job.clientName}`}>{retryingJob === job.id ? "Queuing…" : "Retry"}</Button> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : !jobsError ? <p className="text-sm text-[var(--ink-muted)]">No integration work has been queued yet. New client and task events will appear here.</p> : null}
      </Card>

      {isAdmin ? <Card className="space-y-5 border-[var(--brand)]/30 bg-[var(--surface-raised)] p-5">
        <div className="space-y-1">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">
            AI & integration credentials
          </h2>
          <p className="text-sm text-[var(--ink-muted)]">
            Add credentials for this workspace without exposing them to clients, browsers, or source control.
            Hosted deployments store them encrypted on the server and only return configured status afterward.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {(["composio", "openrouter"] as const).map((provider) => {
            const status = secretStatuses.find((item) => item.provider === provider);
            const label = provider === "composio" ? "Composio" : "OpenRouter";
            return (
              <div key={provider} className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-[var(--ink)]">{label}</h3>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {secretsLoading ? "Checking status…" : status?.configured ? (status.last4 ? `Configured · ends in ${status.last4}` : "Configured · hidden") : "Not configured"}
                    </p>
                  </div>
                  <Badge tone={status?.configured ? "success" : "neutral"}>
                    {status?.configured ? "Configured" : "Not set"}
                  </Badge>
                </div>
                <form className="space-y-2" onSubmit={(event) => void saveSecret(provider, event)}>
                  <label className="sr-only" htmlFor={`${provider}-secret`}>{label} credential</label>
                  <Input
                    id={`${provider}-secret`}
                    name="secret"
                    type="password"
                    autoComplete="new-password"
                    placeholder={status?.configured ? "Enter a new credential to replace it" : `Paste your ${label} credential`}
                    spellCheck={false}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={secretBusy !== null}>
                      {secretBusy === provider ? "Saving…" : status?.configured ? "Replace" : "Save securely"}
                    </Button>
                    {status?.configured ? (
                      <Button type="button" size="sm" variant="secondary" disabled={secretBusy !== null} onClick={() => setConfirmRemoveSecret(provider)}>
                        {secretBusy === provider ? "Removing…" : "Remove"}
                      </Button>
                    ) : null}
                  </div>
                </form>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-[var(--ink-muted)]">
          Credentials are sent over HTTPS to the server secret API. They are never placed in URLs, local storage, rendered HTML, or client-visible responses. Connected app accounts below continue to use Composio&apos;s secure authorization flow.
        </p>
      </Card> : null}

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading integrations…</p>
      ) : data ? (
        <>
          <Card className="space-y-4 p-5">
            <div className="space-y-1">
              <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">
                Client workflow coverage
              </h2>
              <p className="text-sm text-[var(--ink-muted)]">
                Connect the available tools below. Categories marked &quot;Not enabled&quot; describe the next integrations to add; they are not connected to Boatship yet.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.workflows.map((workflow) => (
                <div key={workflow.title} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium text-[var(--ink)]">{workflow.title}</h3>
                    <Badge tone={workflow.status === "available" ? "success" : "neutral"}>
                      {workflow.status === "available" ? "Available now" : "Not enabled"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-[var(--ink-muted)]">{workflow.outcome}</p>
                  <p className="mt-3 text-xs font-medium text-[var(--ink)]">
                    {workflow.tools.join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {data.toolkits.length ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">
              Available connections
            </h2>
            <p className="text-sm text-[var(--ink-muted)]">
              These are the only connections currently enabled through Composio. A connected account can be used for its supported provider actions.
            </p>
          </div>
          {data.toolkits.map((tk) => (
            <Card
              key={tk.slug}
              className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-[var(--ink)]">{tk.name}</h3>
                  <Badge tone={tk.connected ? "success" : "neutral"}>
                    {tk.connected ? "Connected" : "Not connected"}
                  </Badge>
                </div>
                <p className="text-sm text-[var(--ink-muted)]">{tk.description}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {tk.connected ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busySlug === tk.slug}
                    onClick={() => setConfirmDisconnect(tk)}
                  >
                    <Unplug className="h-4 w-4" />
                    {busySlug === tk.slug ? "…" : "Disconnect"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!data.configured || busySlug === tk.slug}
                    onClick={() => void connect(tk.slug)}
                  >
                    <Link2 className="h-4 w-4" />
                    {busySlug === tk.slug ? "Opening…" : "Connect"}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
          ) : (
            <EmptyState title="No enabled connections" description="No curated Composio connections are enabled for this workspace." />
          )}
        </>
      ) : null}

      {driveConnected ? (
        <Card className="space-y-3 p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">
            Google Drive
          </h2>
          <p className="text-sm text-[var(--ink-muted)]">
            This connection is only for your Boatship user. Teammates connect their own Drive
            separately. Use Hodi to create client folders and search files in natural
            language.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={testingDrive} onClick={() => void testDrive()}>
              {testingDrive ? "Testing…" : "Test list files"}
            </Button>
            <Link
              href="/agent"
              className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-2)]"
            >
              Open Hodi
            </Link>
          </div>
          {driveFiles ? (
            <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-sm)] border border-[var(--border)]">
              {driveFiles.length ? (
                driveFiles.map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-[var(--ink)]">{file.name}</span>
                    {file.webViewLink ? (
                      <a
                        href={file.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 underline text-[var(--brand)]"
                      >
                        Open
                      </a>
                    ) : null}
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-sm text-[var(--ink-muted)]">No files found.</li>
              )}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {slackConnected ? (
        <Card className="space-y-3 p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">
            Test Slack
          </h2>
          <p className="text-sm text-[var(--ink-muted)]">
            Send a test message. For auto-notify on client/task events, also set{" "}
            <code className="text-xs">COMPOSIO_SLACK_CHANNEL</code> in env.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Slack test channel"
              placeholder="#general or C01234567"
              value={testChannel}
              onChange={(e) => setTestChannel(e.target.value)}
            />
            <Button disabled={testing} onClick={() => void testSlack()}>
              {testing ? "Sending…" : "Send test"}
            </Button>
          </div>
        </Card>
      ) : null}

      <Modal
        open={confirmDisconnect !== null}
        onClose={() => setConfirmDisconnect(null)}
        title={`Disconnect ${confirmDisconnect?.name ?? "this app"}?`}
        description="Hodi and automatic updates will stop using this account until you connect it again."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setConfirmDisconnect(null)}>Cancel</Button>
            <Button
              type="button"
              variant="danger"
              disabled={busySlug !== null}
              onClick={() => {
                const row = confirmDisconnect;
                setConfirmDisconnect(null);
                if (row) void disconnect(row);
              }}
            >
              Disconnect
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--ink-muted)]">Only your own connection is removed. Teammates keep theirs.</p>
      </Modal>

      <Modal
        open={confirmRemoveSecret !== null}
        onClose={() => setConfirmRemoveSecret(null)}
        title={`Remove the ${confirmRemoveSecret === "openrouter" ? "OpenRouter" : "Composio"} credential?`}
        description="This affects everyone in the workspace."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setConfirmRemoveSecret(null)}>Cancel</Button>
            <Button
              type="button"
              variant="danger"
              disabled={secretBusy !== null}
              onClick={() => {
                const provider = confirmRemoveSecret;
                setConfirmRemoveSecret(null);
                if (provider) void removeSecret(provider);
              }}
            >
              Remove credential
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--ink-muted)]">
          {confirmRemoveSecret === "openrouter" ? "Hodi stops answering until a model credential is added again." : "Connected apps and Hodi tools stop working until a Composio credential is added again."}
        </p>
      </Modal>
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl">
          <p className="text-sm text-[var(--ink-muted)]">Loading integrations…</p>
        </div>
      }
    >
      <IntegrationsContent />
    </Suspense>
  );
}
