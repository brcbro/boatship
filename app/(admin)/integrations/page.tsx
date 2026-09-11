"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
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
  PageHeader,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";

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
};

function IntegrationsContent() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [testChannel, setTestChannel] = useState("");
  const [testing, setTesting] = useState(false);
  const [testingDrive, setTestingDrive] = useState(false);

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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    if (connected) {
      setMessage(`${connected} connected successfully. You can disconnect anytime below.`);
      void load();
    }
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
        window.location.href = res.redirectUrl;
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
          tool: "SLACK_SENDS_A_MESSAGE",
          arguments: {
            channel: testChannel.trim(),
            text: "Boatship connected — onboarding events can post here.",
          },
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
    try {
      await apiFetch("/api/integrations/execute", {
        method: "POST",
        token,
        body: JSON.stringify({
          tool: "GOOGLEDRIVE_LIST_FILES",
          arguments: { pageSize: 5 },
        }),
      });
      setMessage("Drive OK — listed recent files for your account. Open Drive Agent to chat.");
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
        title="Integrations"
        description="Each team member connects their own accounts via Composio. Start with Google Drive, then use Drive Agent to create client folders and search files."
      />

      {error ? (
        <p className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md border border-[var(--brand)]/20 bg-[var(--brand)]/5 px-3 py-2 text-sm text-[var(--ink)]">
          {message}
        </p>
      ) : null}

      {!loading && data && !data.configured ? (
        <Card className="space-y-3 p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">
            Set up Composio
          </h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {data.message || "Add your Composio API key to enable app connections."}
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--ink)]">
            <li>
              Create an account at{" "}
              <a
                className="underline"
                href="https://app.composio.dev"
                target="_blank"
                rel="noreferrer"
              >
                app.composio.dev
              </a>
            </li>
            <li>
              Copy your API key into <code className="text-xs">.env.local</code> as{" "}
              <code className="text-xs">COMPOSIO_API_KEY</code>
            </li>
            <li>
              Set <code className="text-xs">OPENAI_API_KEY</code> for the Drive Agent chat
            </li>
            <li>
              Optional: set <code className="text-xs">COMPOSIO_SLACK_CHANNEL</code> for automatic
              onboarding notifications
            </li>
            <li>Restart the dev server and refresh this page</li>
          </ol>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading integrations…</p>
      ) : data?.toolkits.length ? (
        <div className="space-y-3">
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
                    onClick={() => void disconnect(tk)}
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
        <EmptyState title="No toolkits" description="No curated integrations available." />
      )}

      {driveConnected ? (
        <Card className="space-y-3 p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">
            Google Drive
          </h2>
          <p className="text-sm text-[var(--ink-muted)]">
            This connection is only for your Boatship user. Teammates connect their own Drive
            separately. Use Drive Agent to create client folders and search files in natural
            language.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={testingDrive} onClick={() => void testDrive()}>
              {testingDrive ? "Testing…" : "Test list files"}
            </Button>
            <Link
              href="/agent"
              className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-2)]"
            >
              Open Drive Agent
            </Link>
          </div>
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
