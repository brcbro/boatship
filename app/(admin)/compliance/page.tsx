"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Button,
  Card,
  ConfirmDialog,
  Dropdown,
  EmptyState,
  Input,
  Label,
  PageHeader,
} from "@/components/shared/ui";
import { apiFetch, getStoredToken } from "@/lib/api-client";
import { hasPermission } from "@/lib/rbac";
import type { ClientWithProgress } from "@/types";

/**
 * The demo seed writes a sample client, so it is offered only outside
 * production builds unless NEXT_PUBLIC_BOATSHIP_DEMO_SEED is "true".
 */
const DEMO_SEED_ENABLED = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_BOATSHIP_DEMO_SEED === "true";

function clientLabel(client: ClientWithProgress) {
  return client.companyName || client.name;
}

export default function CompliancePage() {
  const { token, session } = useAuth();
  const isAdmin = session?.role === "admin";
  const canExport = !!session && hasPermission(session, "audit.export");
  const confirmInputId = useId();
  const [clients, setClients] = useState<ClientWithProgress[]>([]);
  // Never preselect a client: GDPR actions must act on a deliberate choice.
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const selectedClient = clients.find((client) => client.id === clientId) || null;
  const selectedLabel = selectedClient ? clientLabel(selectedClient) : "";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ clients: ClientWithProgress[] }>("/api/clients", { token });
      setClients(data.clients);
      // Drop a selection whose client no longer exists.
      setClientId((prev) => (data.clients.some((client) => client.id === prev) ? prev : ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
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
      setMessage(`GDPR export for ${selectedLabel} downloaded.`);
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
      setMessage(clientId ? `Audit CSV for ${selectedLabel} downloaded.` : "Audit CSV for all clients downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit export failed");
    } finally {
      setBusy(null);
    }
  }

  function openDeleteConfirm() {
    if (!isAdmin || !selectedClient) {
      setError("Select a client first");
      return;
    }
    setConfirmText("");
    setConfirmOpen(true);
  }

  function closeDeleteConfirm() {
    setConfirmOpen(false);
    setConfirmText("");
  }

  async function deleteClientData() {
    // Capture the target now; the dropdown cannot change while the dialog is open.
    const target = selectedClient;
    if (!isAdmin || !target || confirmText.trim() !== clientLabel(target)) return;
    const label = clientLabel(target);
    setBusy("gdpr-delete");
    setError("");
    setMessage("");
    try {
      await apiFetch("/api/gdpr/delete", {
        method: "POST",
        token,
        body: JSON.stringify({ clientId: target.id, confirm: true }),
      });
      setMessage(`Deleted data for ${label}.`);
      closeDeleteConfirm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      // Clear the selection either way so a second click cannot reuse it unseen.
      setClientId("");
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
    return <p role="status" className="text-sm text-[var(--ink-muted)]">Loading compliance…</p>;
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

  const confirmMatches = !!selectedClient && confirmText.trim() === selectedLabel;

  return (
    <div>
      <PageHeader
        title="Compliance"
        description={DEMO_SEED_ENABLED ? "GDPR export/delete, audit logs, and demo seed data." : "GDPR export/delete and audit logs."}
      />

      {message ? (
        <p role="status" className="mb-4 rounded-[var(--radius-sm)] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">{message}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
      ) : null}
      {!canExport ? (
        <p role="status" className="mb-4 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink-muted)]">
          GDPR and audit exports need the audit export permission. Ask an admin to grant it.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {canExport ? (
          <Card>
            <h2 className="mb-2 font-[family-name:var(--font-display)] text-lg">Client data</h2>
            <p className="mb-4 text-sm text-[var(--ink-muted)]">
              Export a client’s personal data as JSON, or permanently erase it (admin).
            </p>
            <div className="mb-4">
              <Dropdown
                value={clientId}
                onChange={(value) => { setClientId(value); setMessage(""); }}
                ariaLabel="Client"
                options={[
                  { value: "", label: "Select client…" },
                  ...clients.map((c) => ({
                    value: c.id,
                    label: clientLabel(c),
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
                  onClick={openDeleteConfirm}
                >
                  GDPR delete
                </Button>
              ) : null}
            </div>
          </Card>
        ) : null}

        {canExport ? (
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
              {busy === "audit" ? "Downloading…" : selectedClient ? `Download audit CSV for ${selectedLabel}` : "Download audit CSV (all clients)"}
            </Button>
          </Card>
        ) : null}

        {isAdmin && DEMO_SEED_ENABLED ? (
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

      <ConfirmDialog
        open={confirmOpen && !!selectedClient}
        title="Permanently delete client data?"
        description="This erases the client record and its personal data. It cannot be undone."
        tone="danger"
        confirmLabel="Delete permanently"
        busyLabel="Deleting…"
        busy={busy === "gdpr-delete"}
        confirmDisabled={!confirmMatches}
        onCancel={closeDeleteConfirm}
        onConfirm={() => void deleteClientData()}
      >
        <Label htmlFor={confirmInputId}>
          Type <strong className="font-semibold text-[var(--ink)]">{selectedLabel}</strong> to confirm
        </Label>
        <Input
          id={confirmInputId}
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={confirmText.length > 0 && !confirmMatches}
        />
      </ConfirmDialog>
    </div>
  );
}
