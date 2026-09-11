"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
  Textarea,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { canManageTemplates } from "@/lib/rbac";
import { formatDate, statusLabel } from "@/lib/utils";
import type { AssignedRole, FormTemplate, OnboardingTemplate, TemplateTask, TaskType } from "@/types";

const TYPE_OPTIONS = [
  { value: "client_facing", label: "Client facing" },
  { value: "internal", label: "Internal" },
] as const;

const ROLE_OPTIONS: { value: AssignedRole; label: string }[] = (
  ["admin", "team", "client"] as AssignedRole[]
).map((r) => ({ value: r, label: statusLabel(r) }));

function emptyTask(order: number): TemplateTask {
  return {
    title: "",
    description: "",
    type: "client_facing",
    order,
    assignedRole: "client",
    section: "General",
    formTemplateId: null,
    requiresUpload: false,
  };
}

function typeLabel(type: TaskType) {
  return type === "internal" ? "Internal" : "Client facing";
}

function publishTone(
  status: string
): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "published") return "success";
  if (status === "draft") return "warning";
  if (status === "archived") return "neutral";
  return "info";
}

export default function TemplatesPage() {
  const { token, session } = useAuth();
  const canEdit = session ? canManageTemplates(session.role) : false;

  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [formTemplates, setFormTemplates] = useState<FormTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [taskList, setTaskList] = useState<TemplateTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);

  const [modalIndex, setModalIndex] = useState<number | null>(null);

  const selected = templates.find((t) => t.id === selectedId) || null;
  const editingTask = modalIndex !== null ? taskList[modalIndex] ?? null : null;

  const formTemplateOptions = useMemo(
    () => [
      { value: "", label: "None" },
      ...formTemplates.map((ft) => ({ value: ft.id, label: ft.name })),
    ],
    [formTemplates]
  );

  const formNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ft of formTemplates) map.set(ft.id, ft.name);
    return map;
  }, [formTemplates]);

  const sortedTasks = useMemo(() => {
    return taskList
      .map((task, index) => ({ task, index }))
      .sort((a, b) => (a.task.order || 0) - (b.task.order || 0) || a.index - b.index);
  }, [taskList]);

  const sectionGroups = useMemo(() => {
    const groups: { section: string; items: { task: TemplateTask; index: number }[] }[] = [];
    const seen = new Map<string, number>();
    for (const item of sortedTasks) {
      const section = (item.task.section || "General").trim() || "General";
      const existing = seen.get(section);
      if (existing === undefined) {
        seen.set(section, groups.length);
        groups.push({ section, items: [item] });
      } else {
        groups[existing].items.push(item);
      }
    }
    return groups;
  }, [sortedTasks]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [t, ft] = await Promise.all([
        apiFetch<{ templates: OnboardingTemplate[] }>("/api/templates", { token }),
        apiFetch<{ templates: FormTemplate[] }>("/api/forms/templates", { token }),
      ]);
      setTemplates(t.templates);
      setFormTemplates(ft.templates);
      if (!selectedId && t.templates[0]) {
        setSelectedId(t.templates[0].id);
        setName(t.templates[0].name);
        setIndustry(t.templates[0].industry || "");
        setTaskList(t.templates[0].taskList.map((x) => ({ ...x })));
      } else if (selectedId) {
        const current = t.templates.find((x) => x.id === selectedId);
        if (current) {
          setName(current.name);
          setIndustry(current.industry || "");
          setTaskList(current.taskList.map((x) => ({ ...x })));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [token, selectedId]);

  useEffect(() => {
    void load();
    // intentionally only on mount / token — selection changes handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function selectTemplate(t: OnboardingTemplate) {
    setSelectedId(t.id);
    setName(t.name);
    setIndustry(t.industry || "");
    setTaskList(t.taskList.map((x) => ({ ...x })));
    setCreating(false);
    setMessage("");
    setError("");
    setModalIndex(null);
  }

  function startCreate() {
    setCreating(true);
    setSelectedId(null);
    setName("");
    setIndustry("");
    setTaskList([emptyTask(1)]);
    setMessage("");
    setError("");
    setModalIndex(0);
  }

  function updateTask(index: number, patch: Partial<TemplateTask>) {
    setTaskList((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function addTaskRow() {
    const nextIndex = taskList.length;
    setTaskList((prev) => [...prev, emptyTask(prev.length + 1)]);
    setModalIndex(nextIndex);
  }

  function removeTaskRow(index: number) {
    setTaskList((prev) =>
      prev.filter((_, i) => i !== index).map((t, i) => ({ ...t, order: i + 1 }))
    );
    setModalIndex(null);
  }

  function closeTaskModal() {
    setModalIndex(null);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        name: name.trim(),
        industry: industry.trim() || null,
        taskList: taskList.map((t, i) => ({
          ...t,
          title: t.title.trim(),
          section: (t.section || "General").trim(),
          order: Number(t.order) || i + 1,
          formTemplateId: t.formTemplateId || null,
        })),
      };
      if (creating || !selectedId) {
        const data = await apiFetch<{ template: OnboardingTemplate }>("/api/templates", {
          method: "POST",
          token,
          body: JSON.stringify(payload),
        });
        setTemplates((prev) => [...prev, data.template]);
        setCreating(false);
        setSelectedId(data.template.id);
        setName(data.template.name);
        setIndustry(data.template.industry || "");
        setTaskList(data.template.taskList.map((x) => ({ ...x })));
        setMessage("Template created.");
      } else {
        const data = await apiFetch<{ template: OnboardingTemplate }>(
          `/api/templates/${selectedId}`,
          {
            method: "PATCH",
            token,
            body: JSON.stringify(payload),
          }
        );
        setTemplates((prev) => prev.map((t) => (t.id === data.template.id ? data.template : t)));
        setName(data.template.name);
        setIndustry(data.template.industry || "");
        setTaskList(data.template.taskList.map((x) => ({ ...x })));
        setMessage("Template saved.");
      }
      setModalIndex(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!canEdit || !selectedId || creating) return;
    if (!confirm("Delete this template?")) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/templates/${selectedId}`, { method: "DELETE", token });
      const remaining = templates.filter((t) => t.id !== selectedId);
      setTemplates(remaining);
      setModalIndex(null);
      if (remaining[0]) selectTemplate(remaining[0]);
      else {
        setSelectedId(null);
        setName("");
        setIndustry("");
        setTaskList([]);
      }
      setMessage("Template deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  async function onPublish() {
    if (!canEdit || !selectedId || creating) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ template: OnboardingTemplate }>(
        `/api/templates/${selectedId}`,
        {
          method: "POST",
          token,
          body: JSON.stringify({ action: "publish", archivePrevious: true }),
        }
      );
      setTemplates((prev) => {
        const archivedIds = new Set(
          prev
            .filter(
              (t) =>
                t.id !== data.template.id &&
                t.publishStatus === "published" &&
                (t.id === data.template.parentTemplateId ||
                  t.parentTemplateId === data.template.parentTemplateId ||
                  t.parentTemplateId === data.template.id ||
                  data.template.parentTemplateId === t.id)
            )
            .map((t) => t.id)
        );
        return prev.map((t) => {
          if (t.id === data.template.id) return data.template;
          if (archivedIds.has(t.id)) return { ...t, publishStatus: "archived" as const };
          return t;
        });
      });
      // refresh list to pick up archived siblings accurately
      const refreshed = await apiFetch<{ templates: OnboardingTemplate[] }>("/api/templates", {
        token,
      });
      setTemplates(refreshed.templates);
      setName(data.template.name);
      setIndustry(data.template.industry || "");
      setTaskList(data.template.taskList.map((x) => ({ ...x })));
      setMessage(`Published v${data.template.version}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDuplicate() {
    if (!canEdit || !selectedId || creating) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ template: OnboardingTemplate }>(
        `/api/templates/${selectedId}`,
        {
          method: "POST",
          token,
          body: JSON.stringify({ action: "duplicate" }),
        }
      );
      setTemplates((prev) => [...prev, data.template]);
      selectTemplate(data.template);
      setMessage("Draft duplicate created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading templates…</p>;
  }

  if (error && templates.length === 0) {
    return (
      <EmptyState
        title="Couldn’t load templates"
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
        title="Templates"
        description={
          canEdit
            ? "Create and edit onboarding task templates."
            : "View onboarding templates (admin can edit)."
        }
        actions={
          canEdit ? (
            <Button type="button" onClick={startCreate}>
              New template
            </Button>
          ) : undefined
        }
      />

      {message ? (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-3">
          <ul className="space-y-1">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => selectTemplate(t)}
                  className={`w-full rounded-md px-3 py-2.5 text-left text-sm transition ${
                    !creating && selectedId === t.id
                      ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]"
                      : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  }`}
                >
                  <span className="block truncate">{t.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs opacity-80">
                    <Badge tone={publishTone(t.publishStatus || "published")}>
                      {statusLabel(t.publishStatus || "published")}
                    </Badge>
                    <span>v{t.version ?? 1}</span>
                    <span>
                      · {t.taskList.length} {t.taskList.length === 1 ? "task" : "tasks"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {templates.length === 0 ? (
              <li className="px-3 py-2 text-sm text-[var(--ink-muted)]">No templates</li>
            ) : null}
          </ul>
        </Card>

        {!selected && !creating ? (
          <EmptyState
            title="No template selected"
            description="Select a template or create a new one."
          />
        ) : (
          <Card className="p-0 overflow-hidden">
            <form onSubmit={onSave}>
              <div className="space-y-4 border-b border-[var(--border)] px-5 py-4">
                <div>
                  <Label htmlFor="tmplName">Template name</Label>
                  <Input
                    id="tmplName"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    disabled={!canEdit}
                  />
                  {selected && !creating ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                      <Badge tone={publishTone(selected.publishStatus || "published")}>
                        {statusLabel(selected.publishStatus || "published")}
                      </Badge>
                      <span>Version {selected.version ?? 1}</span>
                      <span>· Updated {formatDate(selected.updatedAt)}</span>
                    </div>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor="tmplIndustry">Industry</Label>
                  <Input
                    id="tmplIndustry"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="Optional industry"
                    disabled={!canEdit}
                  />
                </div>
              </div>

              <div className="px-5 py-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">
                      Tasks
                    </h2>
                    <p className="text-xs text-[var(--ink-muted)]">
                      {taskList.length} {taskList.length === 1 ? "task" : "tasks"} — click a row to
                      edit
                    </p>
                  </div>
                  {canEdit ? (
                    <Button type="button" size="sm" variant="secondary" onClick={addTaskRow}>
                      Add task
                    </Button>
                  ) : null}
                </div>

                {taskList.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                    No tasks yet.
                    {canEdit ? " Add a task to get started." : ""}
                  </div>
                ) : (
                  <div className="space-y-5">
                    {sectionGroups.map((group) => (
                      <div key={group.section}>
                        <div className="mb-1.5 flex items-center gap-2 px-1">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                            {group.section}
                          </span>
                          <span className="h-px flex-1 bg-[var(--border)]" />
                          <span className="text-[11px] text-[var(--ink-muted)]">
                            {group.items.length}
                          </span>
                        </div>
                        <ul className="overflow-hidden rounded-lg border border-[var(--border)]">
                          {group.items.map(({ task, index }, rowIdx) => {
                            const formName = task.formTemplateId
                              ? formNameById.get(task.formTemplateId)
                              : null;
                            return (
                              <li
                                key={index}
                                className={
                                  rowIdx > 0 ? "border-t border-[var(--border)]" : undefined
                                }
                              >
                                <button
                                  type="button"
                                  onClick={() => setModalIndex(index)}
                                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-[var(--surface-2)]/60"
                                >
                                  <span className="w-6 shrink-0 text-center text-xs tabular-nums text-[var(--ink-muted)]">
                                    {task.order || index + 1}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-[var(--ink)]">
                                      {task.title.trim() || "Untitled task"}
                                    </span>
                                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                      <Badge tone="neutral">{typeLabel(task.type)}</Badge>
                                      <Badge tone="info">{statusLabel(task.assignedRole)}</Badge>
                                      {task.requiresUpload ? (
                                        <Badge tone="warning">Upload</Badge>
                                      ) : null}
                                      {formName ? (
                                        <Badge tone="neutral">{formName}</Badge>
                                      ) : null}
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                                    Edit
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-4">
                {canEdit ? (
                  <>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving…" : creating ? "Create template" : "Save template"}
                    </Button>
                    {!creating && selectedId ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={saving}
                          onClick={() => void onPublish()}
                        >
                          Publish
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={saving}
                          onClick={() => void onDuplicate()}
                        >
                          Duplicate
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          disabled={saving}
                          onClick={() => void onDelete()}
                        >
                          Delete
                        </Button>
                      </>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">
                    View only — ask an admin to make changes.
                  </p>
                )}
              </div>
            </form>
          </Card>
        )}
      </div>

      <Modal
        open={modalIndex !== null && editingTask !== null}
        onClose={closeTaskModal}
        title={editingTask?.title.trim() || "Task settings"}
        description="Edit this task’s settings. Changes apply when you save the template."
        size="lg"
        footer={
          <>
            {canEdit && modalIndex !== null ? (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-[var(--danger)] hover:bg-[#f3e0e0] hover:text-[var(--danger)]"
                onClick={() => {
                  if (modalIndex !== null) removeTaskRow(modalIndex);
                }}
              >
                Remove task
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={closeTaskModal}>
              Close
            </Button>
            {canEdit ? (
              <Button type="button" onClick={closeTaskModal}>
                Done
              </Button>
            ) : null}
          </>
        }
      >
        {editingTask && modalIndex !== null ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="taskTitle">Title</Label>
              <Input
                id="taskTitle"
                value={editingTask.title}
                disabled={!canEdit}
                onChange={(e) => updateTask(modalIndex, { title: e.target.value })}
                placeholder="Task title"
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="taskSection">Section</Label>
              <Input
                id="taskSection"
                value={editingTask.section || "General"}
                disabled={!canEdit}
                onChange={(e) => updateTask(modalIndex, { section: e.target.value })}
                placeholder="e.g. Getting started"
              />
            </div>

            <div>
              <Label htmlFor="taskOrder">Order</Label>
              <Input
                id="taskOrder"
                type="number"
                value={editingTask.order}
                disabled={!canEdit}
                onChange={(e) =>
                  updateTask(modalIndex, { order: Number(e.target.value) || 0 })
                }
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="taskDesc">Description</Label>
              <Textarea
                id="taskDesc"
                rows={3}
                value={editingTask.description || ""}
                disabled={!canEdit}
                onChange={(e) => updateTask(modalIndex, { description: e.target.value })}
                placeholder="Optional details for this task"
              />
            </div>

            <div>
              <Label>Type</Label>
              <Dropdown
                value={editingTask.type}
                disabled={!canEdit}
                options={[...TYPE_OPTIONS]}
                onChange={(value) => updateTask(modalIndex, { type: value as TaskType })}
              />
            </div>

            <div>
              <Label>Assigned role</Label>
              <Dropdown
                value={editingTask.assignedRole}
                disabled={!canEdit}
                options={ROLE_OPTIONS}
                onChange={(value) =>
                  updateTask(modalIndex, { assignedRole: value as AssignedRole })
                }
              />
            </div>

            <div className="md:col-span-2">
              <Label>Google form template</Label>
              <Dropdown
                value={editingTask.formTemplateId || ""}
                disabled={!canEdit}
                options={formTemplateOptions}
                placeholder="None"
                onChange={(value) =>
                  updateTask(modalIndex, { formTemplateId: value || null })
                }
              />
              <p className="mt-1.5 text-xs text-[var(--ink-muted)]">
                Link a Google Form from Forms templates to this task.
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-[var(--border)] bg-[var(--surface)]/50 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--brand)]"
                  checked={Boolean(editingTask.requiresUpload)}
                  disabled={!canEdit}
                  onChange={(e) =>
                    updateTask(modalIndex, { requiresUpload: e.target.checked })
                  }
                />
                <span>
                  <span className="block text-sm font-medium text-[var(--ink)]">
                    Requires upload
                  </span>
                  <span className="block text-xs text-[var(--ink-muted)]">
                    Client must upload a document for this task
                  </span>
                </span>
              </label>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
