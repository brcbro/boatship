"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatDate, statusLabel } from "@/lib/utils";
import type { ClientStatus, ClientWithProgress, SavedSmartList } from "@/types";

type TeamUser = { uid: string; name: string; email: string; role: string };
type OnboardingHealth = {
  clientId: string;
  state: "on_track" | "waiting_on_client" | "blocked_internally" | "ready_to_launch";
  score: number;
  blockers: unknown[];
};

const healthLabels: Record<OnboardingHealth["state"], string> = {
  on_track: "On track",
  waiting_on_client: "Waiting on client",
  blocked_internally: "Blocked internally",
  ready_to_launch: "Ready to launch",
};

function healthTone(state: OnboardingHealth["state"]): "success" | "warning" | "danger" | "info" {
  if (state === "ready_to_launch") return "success";
  if (state === "waiting_on_client") return "warning";
  if (state === "blocked_internally") return "danger";
  return "info";
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "on_hold") return "danger";
  if (status === "not_started") return "warning";
  return "neutral";
}

export default function ClientsPage() {
  const { token } = useAuth();
  const [clients, setClients] = useState<ClientWithProgress[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [healthByClientId, setHealthByClientId] = useState<Record<string, OnboardingHealth>>({});
  const [smartLists, setSmartLists] = useState<SavedSmartList[]>([]);
  const [smartListId, setSmartListId] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [assignee, setAssignee] = useState("");
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [saveListOpen, setSaveListOpen] = useState(false);
  const [saveListName, setSaveListName] = useState("");
  const [csvText, setCsvText] = useState(
    "name,companyName,primaryContactEmail,tags,imo,flag\n"
  );
  const [importResult, setImportResult] = useState<{
    created: number;
    errors: { row: number; error: string }[];
  } | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (assignee) params.set("assignedTeamMemberId", assignee);
    if (q.trim()) params.set("q", q.trim());
    if (tag.trim()) params.set("tag", tag.trim());
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [status, assignee, q, tag]);

  const loadSmartLists = useCallback(async () => {
    try {
      const data = await apiFetch<{ smartLists: SavedSmartList[] }>("/api/smart-lists", {
        token,
      });
      setSmartLists(data.smartLists || []);
    } catch {
      /* ignore */
    }
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [c, u, h] = await Promise.all([
        apiFetch<{ clients: ClientWithProgress[] }>(`/api/clients${queryString}`, { token }),
        apiFetch<{ users: TeamUser[] }>("/api/users", { token }),
        apiFetch<{ health: OnboardingHealth[] }>("/api/onboarding-health", { token }),
      ]);
      setClients(c.clients);
      setUsers(u.users);
      setHealthByClientId(Object.fromEntries(h.health.map((item) => [item.clientId, item])));
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }, [token, queryString]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadSmartLists(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadSmartLists]);

  function applySmartList(id: string) {
    setSmartListId(id);
    if (!id) return;
    const list = smartLists.find((s) => s.id === id);
    if (!list) return;
    setStatus(list.filter.status || "");
    setAssignee(list.filter.assignedTeamMemberId || "");
    setTag(list.filter.tag || "");
    setQ(list.filter.q || "");
  }

  async function saveSmartList() {
    if (!saveListName.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiFetch<{ smartList: SavedSmartList }>("/api/smart-lists", {
        method: "POST",
        token,
        body: JSON.stringify({
          name: saveListName.trim(),
          filter: {
            status: status || null,
            assignedTeamMemberId: assignee || null,
            tag: tag.trim() || null,
            q: q.trim() || null,
          },
        }),
      });
      setSaveListOpen(false);
      setSaveListName("");
      setMessage("Smart list saved.");
      await loadSmartLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save smart list");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSmartList(id: string) {
    if (!confirm("Delete this smart list?")) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/smart-lists/${id}`, { method: "DELETE", token });
      if (smartListId === id) setSmartListId("");
      setMessage("Smart list deleted.");
      await loadSmartLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete smart list");
    } finally {
      setBusy(false);
    }
  }
  const allSelected = clients.length > 0 && clients.every((c) => selected.has(c.id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(clients.map((c) => c.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(patch: {
    status?: ClientStatus;
    assignedTeamMemberId?: string | null;
  }) {
    if (!selected.size) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ updated: number }>("/api/clients/bulk", {
        method: "POST",
        token,
        body: JSON.stringify({ ids: Array.from(selected), ...patch }),
      });
      setMessage(`Updated ${data.updated} client(s).`);
      setBulkStatus("");
      setBulkAssignee("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk update failed");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setError("");
    setMessage("");
    setImportResult(null);
    try {
      const data = await apiFetch<{
        created: number;
        errors: { row: number; error: string }[];
      }>("/api/clients/import", {
        method: "POST",
        token,
        body: JSON.stringify({ csv: csvText }),
      });
      setImportResult(data);
      setMessage(`Imported ${data.created} client(s).`);
      if (data.created > 0) await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function onCsvFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ""));
      setImportResult(null);
    };
    reader.readAsText(file);
  }

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Search, filter, and manage onboarding clients."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setImportOpen(true);
                setImportResult(null);
              }}
            >
              Import CSV
            </Button>
            <Link href="/clients/new">
              <Button type="button">New client</Button>
            </Link>
          </div>
        }
      />

      <Card className="mb-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <Input
              placeholder="Search name, company, email…"
              value={q}
              onChange={(e) => {
                setSmartListId("");
                setQ(e.target.value);
              }}
              aria-label="Search clients"
            />
          </div>
          <div>
            <Dropdown
              value={status}
              onChange={(v) => {
                setSmartListId("");
                setStatus(v);
              }}
              placeholder="All statuses"
              options={[
                { value: "", label: "All statuses" },
                ...(
                  ["not_started", "in_progress", "completed", "on_hold"] as ClientStatus[]
                ).map((s) => ({ value: s, label: statusLabel(s) })),
              ]}
            />
          </div>
          <div>
            <Dropdown
              value={assignee}
              onChange={(v) => {
                setSmartListId("");
                setAssignee(v);
              }}
              placeholder="All team members"
              options={[
                { value: "", label: "All team members" },
                ...users.map((u) => ({ value: u.uid, label: u.name })),
              ]}
            />
          </div>
          <div>
            <Input
              placeholder="Filter by tag…"
              value={tag}
              onChange={(e) => {
                setSmartListId("");
                setTag(e.target.value);
              }}
              aria-label="Filter by tag"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-3">
          <div className="min-w-[200px] flex-1">
            <Label className="mb-1.5 block text-xs">Smart lists</Label>
            <Dropdown
              value={smartListId}
              onChange={applySmartList}
              placeholder="Load smart list…"
              options={[
                { value: "", label: "Load smart list…" },
                ...smartLists.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setSaveListName("");
              setSaveListOpen(true);
            }}
          >
            Save as smart list
          </Button>
          {smartListId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void deleteSmartList(smartListId)}
            >
              Delete list
            </Button>
          ) : null}
        </div>
      </Card>

      {message ? (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}

      {selected.size > 0 ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <p className="text-sm text-[var(--ink-muted)]">
              {selected.size} selected
            </p>
            <div className="min-w-[160px] flex-1">
              <Dropdown
                value={bulkStatus}
                onChange={setBulkStatus}
                placeholder="Set status…"
                options={[
                  { value: "", label: "Set status…" },
                  ...(
                    ["not_started", "in_progress", "completed", "on_hold"] as ClientStatus[]
                  ).map((s) => ({ value: s, label: statusLabel(s) })),
                ]}
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={busy || !bulkStatus}
              onClick={() => void runBulk({ status: bulkStatus as ClientStatus })}
            >
              Apply status
            </Button>
            <div className="min-w-[160px] flex-1">
              <Dropdown
                value={bulkAssignee}
                onChange={setBulkAssignee}
                placeholder="Assign to…"
                options={[
                  { value: "", label: "Assign to…" },
                  { value: "__unassign__", label: "Unassigned" },
                  ...users.map((u) => ({ value: u.uid, label: u.name })),
                ]}
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={busy || !bulkAssignee}
              onClick={() =>
                void runBulk({
                  assignedTeamMemberId:
                    bulkAssignee === "__unassign__" ? null : bulkAssignee,
                })
              }
            >
              Apply assignee
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading clients…</p>
      ) : error ? (
        <EmptyState
          title="Couldn’t load clients"
          description={error}
          action={
            <Button type="button" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : clients.length === 0 ? (
        <EmptyState
          title="No clients found"
          description="Try adjusting filters or create a new client."
          action={
            <Link href="/clients/new">
              <Button type="button">New client</Button>
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-0 text-left text-sm sm:min-w-[680px] lg:min-w-[900px]">
              <thead className="bg-[var(--surface-2)] text-[var(--ink-muted)]">
                <tr>
                  <th className="px-5 py-3 font-medium">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all clients"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="hidden px-5 py-3 font-medium sm:table-cell">Company</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="hidden px-5 py-3 font-medium xl:table-cell">Health</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Tags</th>
                  <th className="hidden px-5 py-3 font-medium md:table-cell">Assignee</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Vessels</th>
                  <th className="hidden px-5 py-3 font-medium sm:table-cell">Progress</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Updated</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-[var(--border)] hover:bg-slate-50/80"
                  >
                    <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        aria-label={`Select ${c.name}`}
                      />
                    </td>
                    <td className="px-5 py-3 font-medium text-[var(--ink)]">
                      <Link
                        href={`/clients/${c.id}`}
                        className="hover:text-[var(--accent)] hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="hidden px-5 py-3 text-[var(--ink-muted)] sm:table-cell">{c.companyName}</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                    </td>
                    <td className="hidden px-5 py-3 xl:table-cell">
                      {healthByClientId[c.id] ? (
                        <div className="flex items-center gap-2">
                          <Badge tone={healthTone(healthByClientId[c.id].state)}>
                            {healthLabels[healthByClientId[c.id].state]}
                          </Badge>
                          <span className="text-xs text-[var(--ink-muted)]">
                            {healthByClientId[c.id].blockers.length} blocker{healthByClientId[c.id].blockers.length === 1 ? "" : "s"}
                          </span>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="hidden px-5 py-3 lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(c.tags || []).length ? (
                          c.tags.map((t) => (
                            <Badge key={t} tone="neutral">
                              {t}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-[var(--ink-muted)]">—</span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-5 py-3 text-[var(--ink-muted)] md:table-cell">
                      {c.assignedTeamMemberName || "—"}
                    </td>
                    <td className="hidden px-5 py-3 text-[var(--ink-muted)] lg:table-cell">
                      {typeof c.vesselCount === "number" ? c.vesselCount : "—"}
                    </td>
                    <td className="hidden px-5 py-3 sm:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="w-24">
                          <ProgressBar value={c.progress} />
                        </div>
                        <span className="text-xs text-[var(--ink-muted)]">{c.progress}%</span>
                      </div>
                    </td>
                    <td className="hidden px-5 py-3 text-[var(--ink-muted)] lg:table-cell">{formatDate(c.updatedAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/clients/${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[var(--accent)] hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import clients from CSV"
        description="Columns: name, companyName, primaryContactEmail, tags, imo, flag. Tasks are generated from the standard template."
        size="lg"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setImportOpen(false)}>
              Close
            </Button>
            <Button type="button" disabled={busy || !csvText.trim()} onClick={() => void runImport()}>
              {busy ? "Importing…" : "Import"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="csvFile">Upload file</Label>
            <input
              id="csvFile"
              type="file"
              accept=".csv,text/csv,text/plain"
              className="mt-1 block w-full text-sm text-[var(--ink-muted)]"
              onChange={(e) => onCsvFile(e.target.files?.[0] || null)}
            />
          </div>
          <div>
            <Label htmlFor="csvText">Or paste CSV</Label>
            <Textarea
              id="csvText"
              rows={10}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setImportResult(null);
              }}
              className="font-mono text-xs"
            />
          </div>
          {importResult ? (
            <div className="rounded-md bg-[var(--surface-2)] px-3 py-2 text-sm">
              <p>
                Created <strong>{importResult.created}</strong> client(s).
                {importResult.errors.length
                  ? ` ${importResult.errors.length} row error(s).`
                  : ""}
              </p>
              {importResult.errors.length ? (
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-red-700">
                  {importResult.errors.map((e) => (
                    <li key={`${e.row}-${e.error}`}>
                      Row {e.row}: {e.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={saveListOpen}
        onClose={() => setSaveListOpen(false)}
        title="Save smart list"
        description="Save the current search and filters for quick reuse."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setSaveListOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || !saveListName.trim()}
              onClick={() => void saveSmartList()}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div>
          <Label htmlFor="smartListName">List name</Label>
          <Input
            id="smartListName"
            value={saveListName}
            onChange={(e) => setSaveListName(e.target.value)}
            placeholder="e.g. On hold — compliance"
            disabled={busy}
          />
        </div>
      </Modal>
    </div>
  );
}
