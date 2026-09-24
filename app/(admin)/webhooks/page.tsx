"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";
import type { WebhookDelivery, WebhookEvent } from "@/types";
import type { PublicWebhook } from "@/lib/webhook-security";

type WebhooksResponse = {
  webhooks: PublicWebhook[];
  deliveries: WebhookDelivery[];
  events: WebhookEvent[];
};

const EMPTY_FORM = {
  name: "",
  url: "",
  secret: "",
  events: [] as WebhookEvent[],
  active: true,
};

export default function WebhooksPage() {
  const { token, session } = useAuth();
  const [webhooks, setWebhooks] = useState<PublicWebhook[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const isAdmin = session?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<WebhooksResponse>("/api/webhooks", { token });
      setWebhooks(res.webhooks);
      setDeliveries(res.deliveries);
      setEvents(res.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isAdmin) void load();
      else setLoading(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [isAdmin, load]);

  const selectedDeliveries = useMemo(() => {
    if (!selectedId) return deliveries.slice(0, 20);
    return deliveries.filter((d) => d.webhookId === selectedId).slice(0, 20);
  }, [deliveries, selectedId]);

  const hookName = useMemo(() => {
    const map = new Map(webhooks.map((w) => [w.id, w.name]));
    return (id: string) => map.get(id) || id.slice(0, 8);
  }, [webhooks]);

  function startCreate() {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      events: [...events],
    });
    setMessage("");
    setError("");
  }

  function startEdit(hook: PublicWebhook) {
    setEditingId(hook.id);
    setForm({
      name: hook.name,
      url: hook.url,
      secret: "",
      events: [...hook.events],
      active: hook.active,
    });
    setSelectedId(hook.id);
    setMessage("");
    setError("");
  }

  function toggleEvent(event: WebhookEvent) {
    setForm((prev) => {
      const has = prev.events.includes(event);
      return {
        ...prev,
        events: has ? prev.events.filter((e) => e !== event) : [...prev.events, event],
      };
    });
  }

  async function saveWebhook() {
    if (!form.name.trim() || !form.url.trim()) {
      setError("Name and URL are required");
      return;
    }
    if (!form.events.length) {
      setError("Select at least one event");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        name: form.name.trim(),
        url: form.url.trim(),
        events: form.events,
        active: form.active,
        ...(form.secret.trim() ? { secret: form.secret.trim() } : {}),
      };
      if (editingId) {
        await apiFetch(`/api/webhooks/${editingId}`, {
          method: "PATCH",
          token,
          body: JSON.stringify(payload),
        });
        setMessage("Webhook updated.");
      } else {
        const created = await apiFetch<{ generatedSecret?: string }>("/api/webhooks", {
          method: "POST",
          token,
          body: JSON.stringify(payload),
        });
        setMessage(created.generatedSecret
          ? `Webhook created. Save this signing secret now; it is shown only once: ${created.generatedSecret}`
          : "Webhook created.");
        setForm(EMPTY_FORM);
        setEditingId(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeWebhook(id: string) {
    if (!confirm("Delete this webhook endpoint?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/api/webhooks/${id}`, { method: "DELETE", token });
      if (editingId === id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      if (selectedId === id) setSelectedId(null);
      setMessage("Webhook deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(hook: PublicWebhook) {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/webhooks/${hook.id}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ active: !hook.active }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Webhooks" description="Outbound webhook endpoints." />
        <EmptyState
          title="Admin only"
          description="Webhook management is restricted to administrators."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Send Boatship events to external HTTP endpoints."
        actions={
          <Button type="button" size="sm" onClick={startCreate} disabled={busy}>
            New endpoint
          </Button>
        }
      />

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      {(editingId !== null || form.name || form.url) && (
        <Card>
          <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
            {editingId ? "Edit endpoint" : "Create endpoint"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="wh-name">Name</Label>
              <Input
                id="wh-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ops Slack bridge"
              />
            </div>
            <div>
              <Label htmlFor="wh-url">URL</Label>
              <Input
                id="wh-url"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://example.com/hooks/boatship"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="wh-secret">
                Secret {editingId ? "(leave blank to keep)" : "(optional — auto-generated)"}
              </Label>
              <Input
                id="wh-secret"
                value={form.secret}
                onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
                placeholder={editingId ? "••••••••" : "Auto-generated if empty"}
              />
            </div>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-[var(--ink)]">Events</p>
            <div className="flex flex-wrap gap-2">
              {events.map((event) => {
                const on = form.events.includes(event);
                return (
                  <button
                    key={event}
                    type="button"
                    onClick={() => toggleEvent(event)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      on
                        ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]"
                        : "border-[var(--border)] text-[var(--ink-muted)] hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    {event}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-[var(--ink)]">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            Active
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void saveWebhook()}>
              {editingId ? "Save changes" : "Create"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
      ) : webhooks.length === 0 ? (
        <EmptyState
          title="No webhooks yet"
          description="Create an endpoint to receive client, task, document, and form events."
        />
      ) : (
        <div className="space-y-3">
          {webhooks.map((hook) => (
            <Card key={hook.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="font-medium text-[var(--ink)]">{hook.name}</p>
                    <Badge tone={hook.active ? "success" : "neutral"}>
                      {hook.active ? "Active" : "Paused"}
                    </Badge>
                  </div>
                  <p className="truncate text-sm text-[var(--ink-muted)]">{hook.url}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {hook.events.join(", ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setSelectedId(hook.id);
                      void (async () => {
                        try {
                          const res = await apiFetch<{
                            deliveries: WebhookDelivery[];
                          }>(`/api/webhooks/${hook.id}`, { token });
                          setDeliveries((prev) => {
                            const others = prev.filter((d) => d.webhookId !== hook.id);
                            return [...res.deliveries, ...others].sort((a, b) =>
                              b.createdAt.localeCompare(a.createdAt)
                            );
                          });
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : "Failed to load deliveries"
                          );
                        }
                      })();
                    }}
                  >
                    Deliveries
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => startEdit(hook)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void toggleActive(hook)}
                  >
                    {hook.active ? "Pause" : "Activate"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => void removeWebhook(hook.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
            Recent deliveries
          </h2>
          {selectedId ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setSelectedId(null)}
            >
              Show all
            </Button>
          ) : null}
        </div>
        {selectedDeliveries.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">No deliveries yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {selectedDeliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--ink)]">
                    {d.event}
                    <span className="ml-2 font-normal text-[var(--ink-muted)]">
                      · {hookName(d.webhookId)}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {formatDateTime(d.createdAt)}
                    {d.statusCode != null ? ` · HTTP ${d.statusCode}` : ""}
                    {d.error ? ` · ${d.error}` : ""}
                  </p>
                </div>
                <Badge tone={d.success ? "success" : "danger"}>
                  {d.success ? "OK" : "Failed"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
