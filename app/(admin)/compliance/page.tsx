"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Button,
  Card,
  Dropdown,
  EmptyState,
  PageHeader,
} from "@/components/shared/ui";
import { apiFetch, getStoredToken } from "@/lib/api-client";
import type { ClientWithProgress } from "@/types";

export default function CompliancePage() {
  const { token, session } = useAuth();
  const isAdmin = session?.role === "admin";
  const [clients, setClients] = useState<ClientWithProgress[]>([]);
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ clients: ClientWithProgress[] }>("/api/clients", { token });
      setClients(data.clients);
      setClientId((prev) => prev || data.clients[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function downloadGdprExport() {
    if (!clientId) {
      setError("Select a client first");
      return;
    }
    setBusy("gdpr-export");
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<Record<string, unknown>>(
        `/api/gdpr/export?clientId=${encodeURIComponent(clientId)}`,
        { token }
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gdpr-export-${clientId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("GDPR export downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function downloadAuditCsv() {
    setBusy("audit");
    setError("");
    setMessage("");
    try {
      const authToken = token || getStoredToken();
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
      const res = await fetch(`/api/audit/export${qs}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = clientId
        ? `audit-${clientId}.csv`
        : `audit-all.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Audit CSV downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit export failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteClientData() {
    if (!isAdmin) return;
    if (!clientId) {
      setError("Select a client first");
      return;
    }
    const client = clients.find((c) => c.id === clientId);
    const label = client?.companyName || clientId;
    if (
      !window.confirm(
        `Permanently delete all data for "${label}"? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy("gdpr-delete");
    setError("");
    setMessage("");
    try {
      await apiFetch("/api/gdpr/delete", {
        method: "POST",
        token,
        body: JSON.stringify({ clientId, confirm: true }),
      });
      setMessage(`Deleted data for ${label}.`);
      setClientId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function seedDemo() {
    if (!isAdmin) return;
    setBusy("seed");
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ created: boolean; client: { companyName: string } }>(
        "/api/demo/seed",
        { method: "POST", token }
      );
      setMessage(
        data.created
          ? `Created sample client "${data.client.companyName}".`
          : `Sample client "${data.client.companyName}" already exists.`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading compliance…</p>;
  }

  if (error && clients.length === 0) {
    return (
      <EmptyState
        title="Couldn’t load compliance tools"
        description={error}
        action={
          <Button type="button" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Compliance"
        description="GDPR export/delete, audit logs, and demo seed data."
      />

      {message ? (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-[family-name:var(--font-display)] text-lg">Client data</h2>
          <p className="mb-4 text-sm text-[var(--ink-muted)]">
            Export a client’s personal data as JSON, or permanently erase it (admin).
          </p>
          <div className="mb-4">
            <Dropdown
              value={clientId}
              onChange={setClientId}
              options={[
                { value: "", label: "Select client…" },
                ...clients.map((c) => ({
                  value: c.id,
                  label: c.companyName || c.name,
                })),
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!clientId || busy !== null}
              onClick={() => void downloadGdprExport()}
            >
              {busy === "gdpr-export" ? "Exporting…" : "GDPR export (JSON)"}
            </Button>
            {isAdmin ? (
              <Button
                type="button"
                variant="danger"
                disabled={!clientId || busy !== null}
                onClick={() => void deleteClientData()}
              >
                {busy === "gdpr-delete" ? "Deleting…" : "GDPR delete"}
              </Button>
            ) : null}
          </div>
        </Card>

        <Card>
          <h2 className="mb-2 font-[family-name:var(--font-display)] text-lg">Audit log</h2>
          <p className="mb-4 text-sm text-[var(--ink-muted)]">
            Download activity as CSV. If a client is selected above, the export is filtered to that
            client; otherwise all activity is included.
          </p>
          <Button
            type="button"
            disabled={busy !== null}
            onClick={() => void downloadAuditCsv()}
          >
            {busy === "audit" ? "Downloading…" : "Download audit CSV"}
          </Button>
        </Card>

        {isAdmin ? (
          <Card>
            <h2 className="mb-2 font-[family-name:var(--font-display)] text-lg">Demo seed</h2>
            <p className="mb-4 text-sm text-[var(--ink-muted)]">
              Create a sample “Harbor Demo” client with tags if it does not already exist.
            </p>
            <Button type="button" disabled={busy !== null} onClick={() => void seedDemo()}>
              {busy === "seed" ? "Seeding…" : "Seed Harbor Demo"}
            </Button>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
