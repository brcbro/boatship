"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Dropdown,
  EmptyState,
  Input,
  Label,
  Modal,
  Textarea,
} from "@/components/shared/ui";
import { TaskComments } from "@/components/shared/TaskComments";
import { cn, formatDate, statusLabel } from "@/lib/utils";
import type { Task, TaskPriority, TaskStatus, TaskSubtask, TaskType } from "@/types";

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "info";
  if (status === "blocked") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

function priorityTone(priority: TaskPriority | undefined): "neutral" | "success" | "warning" | "danger" | "info" {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  if (priority === "low") return "neutral";
  return "info";
}

function statusDot(status: TaskStatus) {
  if (status === "completed") return "bg-[var(--success)]";
  if (status === "in_progress") return "bg-[var(--brand)]";
  if (status === "blocked") return "bg-[var(--danger)]";
  return "bg-[var(--border)]";
}

function isDependencyBlocked(task: Task, allTasks: Task[]): boolean {
  const deps = task.dependsOnTaskIds || [];
  if (!deps.length) return false;
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  return deps.some((id) => {
    const dep = byId.get(id);
    return !dep || dep.status !== "completed";
  });
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "pending", label: statusLabel("pending") },
  { value: "in_progress", label: statusLabel("in_progress") },
  { value: "completed", label: statusLabel("completed") },
  { value: "blocked", label: statusLabel("blocked") },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const TYPE_OPTIONS: { value: TaskType; label: string }[] = [
  { value: "client_facing", label: "Client facing" },
  { value: "internal", label: "Internal" },
];

const KANBAN_COLUMNS: TaskStatus[] = ["pending", "in_progress", "blocked", "completed"];

export type TaskBoardMode = "admin" | "client";

type TaskBoardProps = {
  mode: TaskBoardMode;
  tasks: Task[];
  busy?: boolean;
  users?: Array<{ uid: string; name: string }>;
  onUpdate: (taskId: string, patch: Record<string, unknown>) => Promise<void> | void;
  onDelete?: (taskId: string) => Promise<void> | void;
  onCreate?: (input: {
    title: string;
    description: string;
    type: TaskType;
    section: string;
  }) => Promise<void> | void;
  onReorder?: (task: Task, direction: -1 | 1) => Promise<void> | void;
};

export function TaskBoard({
  mode,
  tasks,
  busy,
  users = [],
  onUpdate,
  onDelete,
  onCreate,
  onReorder,
}: TaskBoardProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [groupBy, setGroupBy] = useState<"section" | "status">("section");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newType, setNewType] = useState<TaskType>("client_facing");
  const [newSection, setNewSection] = useState("General");

  const openTask = useMemo(
    () => tasks.find((t) => t.id === openId) || null,
    [tasks, openId]
  );

  useEffect(() => {
    if (openId && !tasks.some((t) => t.id === openId)) setOpenId(null);
  }, [tasks, openId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.section || "").toLowerCase().includes(q)
    );
  }, [tasks, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    const orderKeys: string[] = [];

    if (groupBy === "status") {
      for (const key of ["pending", "in_progress", "blocked", "completed"] as TaskStatus[]) {
        map.set(key, []);
        orderKeys.push(key);
      }
      for (const task of [...filtered].sort((a, b) => a.order - b.order)) {
        const key = task.status;
        if (!map.has(key)) {
          map.set(key, []);
          orderKeys.push(key);
        }
        map.get(key)!.push(task);
      }
      return orderKeys
        .filter((k) => (map.get(k) || []).length > 0)
        .map((k) => ({
          key: k,
          label: statusLabel(k),
          tasks: map.get(k) || [],
        }));
    }

    for (const task of [...filtered].sort((a, b) => a.order - b.order)) {
      const key = task.section?.trim() || "General";
      if (!map.has(key)) {
        map.set(key, []);
        orderKeys.push(key);
      }
      map.get(key)!.push(task);
    }
    return orderKeys.map((k) => ({
      key: k,
      label: k,
      tasks: map.get(k) || [],
    }));
  }, [filtered, groupBy]);

  const kanbanColumns = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const status of KANBAN_COLUMNS) map.set(status, []);
    for (const task of [...filtered].sort((a, b) => a.order - b.order)) {
      const list = map.get(task.status);
      if (list) list.push(task);
      else map.set(task.status, [task]);
    }
    return KANBAN_COLUMNS.map((status) => ({
      status,
      label: statusLabel(status),
      tasks: map.get(status) || [],
    }));
  }, [filtered]);

  const sectionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) set.add(t.section?.trim() || "General");
    if (!set.has("General")) set.add("General");
    return Array.from(set);
  }, [tasks]);

  async function toggleComplete(task: Task, e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    if (task.status !== "completed" && isDependencyBlocked(task, tasks)) return;
    const next: TaskStatus = task.status === "completed" ? "in_progress" : "completed";
    await onUpdate(task.id, { status: next });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!onCreate || !newTitle.trim()) return;
    await onCreate({
      title: newTitle.trim(),
      description: newDesc.trim(),
      type: newType,
      section: newSection.trim() || "General",
    });
    setNewTitle("");
    setNewDesc("");
    setNewType("client_facing");
    setNewSection("General");
    setShowAdd(false);
  }

  function closeAdd() {
    setShowAdd(false);
    setNewTitle("");
    setNewDesc("");
    setNewType("client_facing");
    setNewSection("General");
  }

  const completedCount = tasks.filter((t) => t.status === "completed").length;

  function renderTaskBadges(task: Task) {
    const blocked = isDependencyBlocked(task, tasks);
    return (
      <span className="hidden items-center gap-1 sm:flex">
        <Badge tone={priorityTone(task.priority)}>{statusLabel(task.priority || "medium")}</Badge>
        {blocked ? <Badge tone="danger">Blocked</Badge> : null}
        {(task.subtasks?.length || 0) > 0 ? (
          <Badge tone="neutral">
            {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
          </Badge>
        ) : null}
        {task.requiresUpload ? <Badge tone="neutral">Upload</Badge> : null}
        {task.formTemplateId ? <Badge tone="neutral">Form</Badge> : null}
        {mode === "admin" ? <Badge tone="neutral">{statusLabel(task.type)}</Badge> : null}
        <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
      </span>
    );
  }

  function renderListRow(task: Task) {
    const blocked = isDependencyBlocked(task, tasks);
    return (
      <li key={task.id}>
        <button
          type="button"
          onClick={() => setOpenId(task.id)}
          className={cn(
            "flex min-h-11 w-full items-center gap-2 px-2.5 text-left transition hover:bg-[var(--surface-2)]/60 sm:h-9 sm:min-h-0",
            openId === task.id && "bg-[var(--surface-2)]",
            blocked && task.status !== "completed" && "opacity-90"
          )}
        >
          <span
            role="checkbox"
            aria-checked={task.status === "completed"}
            aria-disabled={blocked && task.status !== "completed"}
            tabIndex={0}
            onClick={(e) => void toggleComplete(task, e)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                void toggleComplete(task, e as unknown as React.MouseEvent);
              }
            }}
            className={cn(
              "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition",
              task.status === "completed"
                ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--surface-raised)]"
                : blocked
                  ? "cursor-not-allowed border-[var(--border)] bg-[var(--surface-2)] opacity-60"
                  : "border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--ink)]"
            )}
          >
            {task.status === "completed" ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
          </span>

          <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", statusDot(task.status))} />

          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] leading-none",
              task.status === "completed"
                ? "text-[var(--ink-muted)] line-through"
                : "font-medium text-[var(--ink)]"
            )}
          >
            {task.title}
          </span>

          {renderTaskBadges(task)}
        </button>
      </li>
    );
  }

  return (
    <div className="relative">
      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--ink-muted)]">
          <span className="font-medium text-[var(--ink)]">
            {completedCount}/{tasks.length} done
          </span>
          <span className="text-[var(--border)]">·</span>
          <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-0.5">
            <button
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition",
                viewMode === "list"
                  ? "bg-[var(--brand)] text-[var(--surface-raised)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              )}
              onClick={() => setViewMode("list")}
            >
              List
            </button>
            <button
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition",
                viewMode === "kanban"
                  ? "bg-[var(--brand)] text-[var(--surface-raised)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              )}
              onClick={() => setViewMode("kanban")}
            >
              Kanban
            </button>
          </div>
          {viewMode === "list" ? (
            <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-0.5">
              <button
                type="button"
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition",
                  groupBy === "section"
                    ? "bg-[var(--brand)] text-[var(--surface-raised)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                )}
                onClick={() => setGroupBy("section")}
              >
                Sections
              </button>
              <button
                type="button"
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition",
                  groupBy === "status"
                    ? "bg-[var(--brand)] text-[var(--surface-raised)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                )}
                onClick={() => setGroupBy("status")}
              >
                Status
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-8 w-full sm:w-52"
            placeholder="Search tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {mode === "admin" && onCreate ? (
            <Button type="button" size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4" />
              Task
            </Button>
          ) : null}
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          description={
            mode === "admin"
              ? "Add a task or create the client from an onboarding template."
              : "Your checklist will appear here once tasks are assigned."
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description="Try a different search." />
      ) : viewMode === "kanban" ? (
        <div
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 [scrollbar-gutter:stable]"
          aria-label="Task board columns. Swipe horizontally to see more statuses."
        >
          {kanbanColumns.map((col) => (
            <section
              key={col.status}
              className="flex w-[82vw] max-w-80 shrink-0 snap-start flex-col rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/50 sm:w-64"
            >
              <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink)]">
                  {col.label}
                </span>
                <span className="rounded bg-[var(--surface-raised)] px-1.5 py-px text-[10px] text-[var(--ink-muted)]">
                  {col.tasks.length}
                </span>
              </header>
              <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto overscroll-contain p-2">
                {col.tasks.length === 0 ? (
                  <li className="px-1 py-4 text-center text-xs text-[var(--ink-muted)]">Empty</li>
                ) : (
                  col.tasks.map((task) => {
                    const blocked = isDependencyBlocked(task, tasks);
                    return (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => setOpenId(task.id)}
                          className={cn(
                            "w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-left transition hover:border-[var(--ink-muted)]",
                            openId === task.id && "ring-1 ring-[var(--brand)]"
                          )}
                        >
                          <p
                            className={cn(
                              "mb-1.5 text-[13px] font-medium leading-snug",
                              task.status === "completed"
                                ? "text-[var(--ink-muted)] line-through"
                                : "text-[var(--ink)]"
                            )}
                          >
                            {task.title}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={priorityTone(task.priority)}>
                              {statusLabel(task.priority || "medium")}
                            </Badge>
                            {blocked ? <Badge tone="danger">Blocked</Badge> : null}
                            {task.dueDate ? (
                              <Badge tone="neutral">{formatDate(task.dueDate)}</Badge>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const isCollapsed = collapsed[group.key];
            const done = group.tasks.filter((t) => t.status === "completed").length;
            return (
              <section
                key={group.key}
                className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)]"
              >
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-1.5 bg-[var(--surface-2)]/80 px-2.5 text-left hover:bg-[var(--surface-2)]"
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                  }
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
                  )}
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink)]">
                    {group.label}
                  </span>
                  <span className="rounded bg-[var(--surface-raised)] px-1.5 py-px text-[10px] text-[var(--ink-muted)]">
                    {done}/{group.tasks.length}
                  </span>
                </button>

                {!isCollapsed ? (
                  <ul className="divide-y divide-[var(--border)]">
                    {group.tasks.map((task) => renderListRow(task))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <Modal
        open={showAdd && mode === "admin" && !!onCreate}
        onClose={closeAdd}
        title="Add task"
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={closeAdd}>
              Cancel
            </Button>
            <Button type="submit" form="task-create-form" disabled={busy || !newTitle.trim()}>
              Add task
            </Button>
          </>
        }
      >
        <form id="task-create-form" onSubmit={handleCreate} className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea rows={3} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Section</Label>
              <Input
                list="task-sections"
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
              />
              <datalist id="task-sections">
                {sectionOptions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <Label>Type</Label>
              <Dropdown
                value={newType}
                onChange={(v) => setNewType(v as TaskType)}
                options={TYPE_OPTIONS}
              />
            </div>
          </div>
        </form>
      </Modal>

      <TaskDetailModal
        task={openTask}
        open={!!openTask}
        mode={mode}
        busy={busy}
        users={users}
        allTasks={tasks}
        sectionOptions={sectionOptions}
        onClose={() => setOpenId(null)}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onReorder={onReorder}
      />
    </div>
  );
}

export function TaskDetailModal({
  task,
  open,
  mode,
  busy,
  users,
  allTasks,
  sectionOptions,
  onClose,
  onUpdate,
  onDelete,
  onReorder,
}: {
  task: Task | null;
  open: boolean;
  mode: TaskBoardMode;
  busy?: boolean;
  users: Array<{ uid: string; name: string }>;
  allTasks: Task[];
  sectionOptions: string[];
  onClose: () => void;
  onUpdate: (taskId: string, patch: Record<string, unknown>) => Promise<void> | void;
  onDelete?: (taskId: string) => Promise<void> | void;
  onReorder?: (task: Task, direction: -1 | 1) => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [section, setSection] = useState("General");
  const [dueDate, setDueDate] = useState("");
  const [newSubtask, setNewSubtask] = useState("");

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description || "");
    setInternalNotes(task.internalNotes || "");
    setSection(task.section || "General");
    setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
    setNewSubtask("");
  }, [task]);

  async function saveField(patch: Record<string, unknown>) {
    if (!task) return;
    await onUpdate(task.id, patch);
  }

  async function toggleSubtask(sub: TaskSubtask) {
    if (!task || busy) return;
    const next = (task.subtasks || []).map((s) =>
      s.id === sub.id ? { ...s, completed: !s.completed } : s
    );
    await saveField({ subtasks: next });
  }

  async function addSubtask(e: FormEvent) {
    e.preventDefault();
    if (!task || busy) return;
    const titleText = newSubtask.trim();
    if (!titleText) return;
    const next: TaskSubtask[] = [
      ...(task.subtasks || []),
      {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: titleText,
        completed: false,
      },
    ];
    await saveField({ subtasks: next });
    setNewSubtask("");
  }

  const clientStatuses = STATUS_OPTIONS.filter((o) => o.value !== "blocked");
  const statusOptions = mode === "client" ? clientStatuses : STATUS_OPTIONS;
  const assigneeOptions = [
    { value: "", label: "Unassigned" },
    ...users.map((u) => ({ value: u.uid, label: u.name })),
  ];
  const dependencyOptions = (allTasks || [])
    .filter((t) => t.id !== task?.id)
    .map((t) => ({ value: t.id, label: t.title }));
  const blocked = task ? isDependencyBlocked(task, allTasks) : false;
  const incompleteDeps = task
    ? (task.dependsOnTaskIds || [])
        .map((id) => allTasks.find((t) => t.id === id))
        .filter((t): t is Task => !!t && t.status !== "completed")
    : [];

  return (
    <Modal
      open={open && !!task}
      onClose={onClose}
      size="lg"
      title={mode === "admin" ? "Edit task" : task?.title}
      description={task ? task.section || "General" : undefined}
      footer={
        task && mode === "admin" ? (
          <>
            <div className="mr-auto flex gap-1">
              {onReorder ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void onReorder(task, -1)}
                  >
                    Move up
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void onReorder(task, 1)}
                  >
                    Move down
                  </Button>
                </>
              ) : null}
            </div>
            {onDelete ? (
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => void onDelete(task.id)}
              >
                Delete
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {!task ? null : (
        <div className="space-y-4">
          {blocked ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Blocked by incomplete dependencies
              {incompleteDeps.length
                ? `: ${incompleteDeps.map((d) => d.title).join(", ")}`
                : "."}
            </p>
          ) : null}

          {mode === "admin" ? (
            <div>
              <Label>Title</Label>
              <Input
                value={title}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  if (title.trim() && title.trim() !== task.title) {
                    void saveField({ title: title.trim() });
                  }
                }}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Status</Label>
              <Dropdown
                value={task.status}
                disabled={busy}
                options={statusOptions}
                onChange={(v) => void saveField({ status: v as TaskStatus })}
              />
            </div>
            <div>
              <Label>Due date</Label>
              {mode === "admin" ? (
                <Input
                  type="date"
                  value={dueDate}
                  disabled={busy}
                  onChange={(e) => setDueDate(e.target.value)}
                  onBlur={() => {
                    const next = dueDate ? new Date(dueDate).toISOString() : null;
                    const prev = task.dueDate;
                    if ((next || null) !== (prev || null)) {
                      void saveField({ dueDate: next });
                    }
                  }}
                />
              ) : (
                <p className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink)]">
                  {formatDate(task.dueDate)}
                </p>
              )}
            </div>
          </div>

          {mode === "admin" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Priority</Label>
                <Dropdown
                  value={task.priority || "medium"}
                  disabled={busy}
                  options={PRIORITY_OPTIONS}
                  onChange={(v) => void saveField({ priority: v as TaskPriority })}
                />
              </div>
              <div>
                <Label>Section</Label>
                <Input
                  list="modal-sections"
                  value={section}
                  disabled={busy}
                  onChange={(e) => setSection(e.target.value)}
                  onBlur={() => {
                    const next = section.trim() || "General";
                    if (next !== task.section) void saveField({ section: next });
                  }}
                />
                <datalist id="modal-sections">
                  {sectionOptions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label>Type</Label>
                <Dropdown
                  value={task.type}
                  disabled={busy}
                  options={TYPE_OPTIONS}
                  onChange={(v) => void saveField({ type: v as TaskType })}
                />
              </div>
              <div>
                <Label>Assignee</Label>
                <Dropdown
                  value={task.assignedTo || ""}
                  disabled={busy}
                  options={assigneeOptions}
                  placeholder="Unassigned"
                  onChange={(v) => void saveField({ assignedTo: v || null })}
                />
              </div>
              {dependencyOptions.length > 0 ? (
                <div className="sm:col-span-2">
                  <Label>Depends on</Label>
                  <select
                    multiple
                    disabled={busy}
                    className="mt-1 min-h-[5.5rem] w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1.5 text-sm text-[var(--ink)]"
                    value={task.dependsOnTaskIds || []}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                      void saveField({ dependsOnTaskIds: selected });
                    }}
                  >
                    {dependencyOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    Hold Ctrl/Cmd to select multiple. Incomplete deps block start/complete.
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={priorityTone(task.priority)}>
                {statusLabel(task.priority || "medium")}
              </Badge>
              <Badge tone={statusTone(task.status)}>{statusLabel(task.status)}</Badge>
              {blocked ? <Badge tone="danger">Blocked</Badge> : null}
              {task.requiresUpload ? <Badge tone="info">Needs upload</Badge> : null}
              {task.formTemplateId ? <Badge tone="info">Has form</Badge> : null}
            </div>
          )}

          <div>
            <Label>Description</Label>
            {mode === "admin" ? (
              <Textarea
                rows={4}
                value={description}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => {
                  if (description !== task.description) {
                    void saveField({ description });
                  }
                }}
              />
            ) : (
              <p className="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink)]">
                {task.description || "No description."}
              </p>
            )}
          </div>

          {mode === "admin" ? (
            <div>
              <Label>Internal notes</Label>
              <Textarea
                rows={3}
                value={internalNotes}
                disabled={busy}
                onChange={(e) => setInternalNotes(e.target.value)}
                onBlur={() => {
                  if (internalNotes !== task.internalNotes) {
                    void saveField({ internalNotes });
                  }
                }}
              />
            </div>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <Label>Subtasks</Label>
              {(task.subtasks?.length || 0) > 0 ? (
                <span className="text-xs text-[var(--ink-muted)]">
                  {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length} done
                </span>
              ) : null}
            </div>
            {(task.subtasks?.length || 0) === 0 ? (
              <p className="mb-2 text-sm text-[var(--ink-muted)]">No subtasks yet.</p>
            ) : (
              <ul className="mb-2 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
                {task.subtasks.map((sub) => (
                  <li key={sub.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleSubtask(sub)}
                      className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-[var(--surface-2)]/60 disabled:opacity-60"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border",
                          sub.completed
                            ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--surface-raised)]"
                            : "border-[var(--border)] bg-[var(--surface-raised)]"
                        )}
                      >
                        {sub.completed ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                      <span
                        className={cn(
                          "text-sm",
                          sub.completed
                            ? "text-[var(--ink-muted)] line-through"
                            : "text-[var(--ink)]"
                        )}
                      >
                        {sub.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={(e) => void addSubtask(e)} className="flex gap-2">
              <Input
                value={newSubtask}
                disabled={busy}
                placeholder="Add a subtask…"
                onChange={(e) => setNewSubtask(e.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={busy || !newSubtask.trim()}
              >
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </form>
          </div>

          <TaskComments taskId={task.id} users={users} defaultOpen collapsible />

          {mode === "client" ? (
            <div className="flex flex-wrap gap-2">
              {task.requiresUpload ? (
                <Link href={`/portal/documents?taskId=${encodeURIComponent(task.id)}`}>
                  <Button type="button" size="sm" variant="secondary">
                    Upload document
                  </Button>
                </Link>
              ) : null}
              {task.formTemplateId ? (
                <Link href="/portal/forms">
                  <Button type="button" size="sm" variant="secondary">
                    Open form
                  </Button>
                </Link>
              ) : null}
              {task.status !== "completed" ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || blocked}
                  onClick={() => void saveField({ status: "completed" })}
                >
                  Mark complete
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void saveField({ status: "in_progress" })}
                >
                  Reopen
                </Button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
