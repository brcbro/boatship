"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import { toGoogleFormEmbedUrl } from "@/lib/google-forms";
import { canManageTemplates } from "@/lib/rbac";
import { formatDate } from "@/lib/utils";
import type { FormField, FormTemplate } from "@/types";

type EditorField = FormField & { uid: string };

type EditorState = {
  id: string | null;
  name: string;
  description: string;
  mode: "google" | "native";
  googleFormUrl: string;
  googleFormEmbedUrl: string;
  fields: EditorField[];
};

const FIELD_TYPES: FormField["type"][] = [
  "text",
  "textarea",
  "email",
  "dropdown",
  "date",
  "file",
  "number",
  "checkbox",
];

function newFieldUid() {
  return `f_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyField(): EditorField {
  return {
    uid: newFieldUid(),
    key: "",
    label: "",
    type: "text",
    required: false,
    options: [],
    showIf: null,
  };
}

const emptyEditor = (): EditorState => ({
  id: null,
  name: "",
  description: "",
  mode: "google",
  googleFormUrl: "",
  googleFormEmbedUrl: "",
  fields: [],
});

function templateMode(t: FormTemplate): "google" | "native" {
  if (t.mode === "native" || t.mode === "google") return t.mode;
  return t.fields?.length ? "native" : "google";
}

export default function FormsAdminPage() {
  const { token, session } = useAuth();
  const canEdit = session ? canManageTemplates(session.role) : false;

  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ templates: FormTemplate[] }>("/api/forms/templates", {
        token,
      });
      setTemplates(data.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load form templates");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    if (!canEdit) return;
    setEditor(emptyEditor());
    setError("");
    setMessage("");
    setModalOpen(true);
  }

  function openEdit(t: FormTemplate) {
    setEditor({
      id: t.id,
      name: t.name,
      description: t.description || "",
      mode: templateMode(t),
      googleFormUrl: t.googleFormUrl || "",
      googleFormEmbedUrl: t.googleFormEmbedUrl || "",
      fields: (t.fields || []).map((f) => ({
        ...f,
        uid: newFieldUid(),
        options: f.options || [],
        showIf: f.showIf || null,
      })),
    });
    setError("");
    setMessage("");
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditor(emptyEditor());
  }

  function onGoogleUrlChange(value: string) {
    setEditor((prev) => ({
      ...prev,
      googleFormUrl: value,
      googleFormEmbedUrl: prev.googleFormEmbedUrl.trim()
        ? prev.googleFormEmbedUrl
        : toGoogleFormEmbedUrl(value),
    }));
  }

  function updateField(uid: string, patch: Partial<EditorField>) {
    setEditor((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.uid === uid ? { ...f, ...patch } : f)),
    }));
  }

  function removeField(uid: string) {
    setEditor((prev) => ({
      ...prev,
      fields: prev.fields.filter((f) => f.uid !== uid),
    }));
  }

  function addField() {
    setEditor((prev) => ({ ...prev, fields: [...prev.fields, emptyField()] }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const fieldsPayload: FormField[] = editor.fields.map((f) => {
        const key =
          f.key.trim().replace(/\s+/g, "_") ||
          f.label
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");
        return {
          key,
          label: f.label.trim(),
          type: f.type,
          required: Boolean(f.required),
          options:
            f.type === "dropdown"
              ? (f.options || []).map((o) => o.trim()).filter(Boolean)
              : undefined,
          showIf:
            f.showIf?.key?.trim()
              ? { key: f.showIf.key.trim(), equals: String(f.showIf.equals ?? "") }
              : null,
        };
      });

      if (editor.mode === "native") {
        const invalid = fieldsPayload.filter((f) => !f.key || !f.label);
        if (invalid.length) throw new Error("Each native field needs a key and label.");
      }

      const payload = {
        name: editor.name.trim(),
        description: editor.description.trim(),
        mode: editor.mode,
        googleFormUrl: editor.googleFormUrl.trim(),
        googleFormEmbedUrl:
          editor.googleFormEmbedUrl.trim() ||
          (editor.googleFormUrl.trim()
            ? toGoogleFormEmbedUrl(editor.googleFormUrl.trim())
            : ""),
        fields: editor.mode === "native" ? fieldsPayload : [],
      };

      if (!editor.id) {
        const data = await apiFetch<{ template: FormTemplate }>("/api/forms/templates", {
          method: "POST",
          token,
          body: JSON.stringify(payload),
        });
        setTemplates((prev) => [...prev, data.template]);
        setMessage("Form template created.");
      } else {
        const data = await apiFetch<{ template: FormTemplate }>(
          `/api/forms/templates/${editor.id}`,
          {
            method: "PATCH",
            token,
            body: JSON.stringify(payload),
          }
        );
        setTemplates((prev) => prev.map((t) => (t.id === data.template.id ? data.template : t)));
        setMessage("Form template saved.");
      }
      setModalOpen(false);
      setEditor(emptyEditor());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!canEdit || !editor.id) return;
    if (!confirm("Delete this form template?")) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/forms/templates/${editor.id}`, { method: "DELETE", token });
      setTemplates((prev) => prev.filter((t) => t.id !== editor.id));
      setMessage("Form template deleted.");
      setModalOpen(false);
      setEditor(emptyEditor());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading form templates…</p>;
  }

  if (error && templates.length === 0 && !modalOpen) {
    return (
      <EmptyState
        title="Couldn’t load forms"
        description={error}
        action={
          <Button type="button" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  const fieldKeys = editor.fields.map((f) => f.key.trim()).filter(Boolean);

  return (
    <div>
      <PageHeader
        title="Forms"
        description={
          canEdit
            ? "Create Google Form links or native client forms with conditional fields."
            : "View form templates (admin can edit)."
        }
        actions={
          canEdit ? (
            <Button type="button" onClick={openCreate}>
              New form
            </Button>
          ) : undefined
        }
      />

      {message ? (
        <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error && !modalOpen ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      {templates.length === 0 ? (
        <EmptyState
          title="No form templates"
          description={
            canEdit
              ? "Create a Google Form link or a native form with custom fields."
              : "No form templates have been added yet."
          }
          action={
            canEdit ? (
              <Button type="button" onClick={openCreate}>
                New form
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="p-2">
          <ul className="divide-y divide-[var(--border)]">
            {templates.map((t) => {
              const mode = templateMode(t);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => openEdit(t)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]/70"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="block truncate text-sm font-medium text-[var(--ink)]">
                          {t.name}
                        </span>
                        <Badge tone={mode === "native" ? "info" : "neutral"}>
                          {mode === "native" ? "Native" : "Google"}
                        </Badge>
                      </span>
                      {t.description ? (
                        <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">
                          {t.description}
                        </span>
                      ) : (
                        <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">
                          Updated {formatDate(t.updatedAt)}
                          {mode === "native" && t.fields?.length
                            ? ` · ${t.fields.length} fields`
                            : ""}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--ink-muted)]">
                      {canEdit ? "Edit" : "View"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editor.id ? (canEdit ? "Edit form" : "Form details") : "New form"}
        description={
          editor.mode === "native"
            ? "Build fields in Boatship. Use showIf to reveal fields when another answer matches."
            : "Paste a Google Form viewform link. Embed URL is derived automatically when left blank."
        }
        size="xl"
        footer={
          canEdit ? (
            <>
              {editor.id ? (
                <Button
                  type="button"
                  variant="danger"
                  disabled={saving}
                  onClick={() => void onDelete()}
                >
                  Delete
                </Button>
              ) : null}
              <Button type="button" variant="secondary" disabled={saving} onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" form="form-template-editor" disabled={saving}>
                {saving ? "Saving…" : editor.id ? "Save" : "Create"}
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" onClick={closeModal}>
              Close
            </Button>
          )
        }
      >
        {error && modalOpen ? (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        ) : null}

        <form id="form-template-editor" onSubmit={(e) => void onSave(e)} className="space-y-4">
          <div>
            <Label htmlFor="formName">Name</Label>
            <Input
              id="formName"
              value={editor.name}
              onChange={(e) => setEditor((prev) => ({ ...prev, name: e.target.value }))}
              required
              disabled={!canEdit}
              placeholder="Client intake questionnaire"
            />
          </div>

          <div>
            <Label htmlFor="formDescription">Description (optional)</Label>
            <Textarea
              id="formDescription"
              rows={2}
              value={editor.description}
              onChange={(e) => setEditor((prev) => ({ ...prev, description: e.target.value }))}
              disabled={!canEdit}
              placeholder="Shown to clients when they open this form"
            />
          </div>

          <div>
            <Label htmlFor="formMode">Mode</Label>
            <Select
              id="formMode"
              value={editor.mode}
              disabled={!canEdit}
              onChange={(e) =>
                setEditor((prev) => ({
                  ...prev,
                  mode: e.target.value === "native" ? "native" : "google",
                  fields:
                    e.target.value === "native" && prev.fields.length === 0
                      ? [emptyField()]
                      : prev.fields,
                }))
              }
            >
              <option value="google">Google Forms</option>
              <option value="native">Native client form</option>
            </Select>
          </div>

          {editor.mode === "google" ? (
            <>
              <div>
                <Label htmlFor="googleFormUrl">Google Form URL</Label>
                <Input
                  id="googleFormUrl"
                  type="url"
                  value={editor.googleFormUrl}
                  onChange={(e) => onGoogleUrlChange(e.target.value)}
                  required
                  disabled={!canEdit}
                  placeholder="https://docs.google.com/forms/d/e/…/viewform"
                />
                <p className="mt-1.5 text-xs text-[var(--ink-muted)]">
                  Paste the Google Form “viewform” link. Embed URL is auto-derived with{" "}
                  <code className="text-[var(--ink)]">?embedded=true</code>.
                </p>
              </div>

              <div>
                <Label htmlFor="googleFormEmbedUrl">Embed URL (optional)</Label>
                <Input
                  id="googleFormEmbedUrl"
                  type="url"
                  value={editor.googleFormEmbedUrl}
                  onChange={(e) =>
                    setEditor((prev) => ({ ...prev, googleFormEmbedUrl: e.target.value }))
                  }
                  disabled={!canEdit}
                  placeholder="Leave blank to auto-derive from the viewform link"
                />
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label>Fields</Label>
                {canEdit ? (
                  <Button type="button" variant="secondary" size="sm" onClick={addField}>
                    Add field
                  </Button>
                ) : null}
              </div>

              {editor.fields.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)]">No fields yet.</p>
              ) : (
                <ul className="space-y-3">
                  {editor.fields.map((field, index) => (
                    <li
                      key={field.uid}
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-2)]/40 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--ink-muted)]">
                          Field {index + 1}
                        </span>
                        {canEdit ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeField(field.uid)}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={`label-${field.uid}`}>Label</Label>
                          <Input
                            id={`label-${field.uid}`}
                            value={field.label}
                            disabled={!canEdit}
                            required
                            onChange={(e) => updateField(field.uid, { label: e.target.value })}
                            placeholder="Have you been sanctioned?"
                          />
                        </div>
                        <div>
                          <Label htmlFor={`key-${field.uid}`}>Key</Label>
                          <Input
                            id={`key-${field.uid}`}
                            value={field.key}
                            disabled={!canEdit}
                            onChange={(e) => updateField(field.uid, { key: e.target.value })}
                            placeholder="sanction_check"
                          />
                        </div>
                        <div>
                          <Label htmlFor={`type-${field.uid}`}>Type</Label>
                          <Select
                            id={`type-${field.uid}`}
                            value={field.type}
                            disabled={!canEdit}
                            onChange={(e) =>
                              updateField(field.uid, {
                                type: e.target.value as FormField["type"],
                              })
                            }
                          >
                            {FIELD_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="flex items-end pb-2">
                          <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                            <input
                              type="checkbox"
                              checked={field.required}
                              disabled={!canEdit}
                              onChange={(e) =>
                                updateField(field.uid, { required: e.target.checked })
                              }
                            />
                            Required
                          </label>
                        </div>
                        {field.type === "dropdown" ? (
                          <div className="sm:col-span-2">
                            <Label htmlFor={`opts-${field.uid}`}>Options (comma-separated)</Label>
                            <Input
                              id={`opts-${field.uid}`}
                              value={(field.options || []).join(", ")}
                              disabled={!canEdit}
                              onChange={(e) =>
                                updateField(field.uid, {
                                  options: e.target.value.split(",").map((s) => s.trim()),
                                })
                              }
                              placeholder="Yes, No, N/A"
                            />
                          </div>
                        ) : null}
                        <div>
                          <Label htmlFor={`showif-key-${field.uid}`}>Show if field (optional)</Label>
                          <Select
                            id={`showif-key-${field.uid}`}
                            value={field.showIf?.key || ""}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const key = e.target.value;
                              updateField(field.uid, {
                                showIf: key
                                  ? { key, equals: field.showIf?.equals || "" }
                                  : null,
                              });
                            }}
                          >
                            <option value="">Always show</option>
                            {fieldKeys
                              .filter((k) => k !== field.key.trim())
                              .map((k) => (
                                <option key={k} value={k}>
                                  {k}
                                </option>
                              ))}
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor={`showif-eq-${field.uid}`}>Show if equals</Label>
                          <Input
                            id={`showif-eq-${field.uid}`}
                            value={field.showIf?.equals || ""}
                            disabled={!canEdit || !field.showIf?.key}
                            onChange={(e) =>
                              updateField(field.uid, {
                                showIf: field.showIf?.key
                                  ? { key: field.showIf.key, equals: e.target.value }
                                  : null,
                              })
                            }
                            placeholder="yes"
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {editor.id ? (
            <p className="text-xs text-[var(--ink-muted)]">
              Last updated {formatDate(templates.find((t) => t.id === editor.id)?.updatedAt || "")}
            </p>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
