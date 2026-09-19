"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
import {
  computeRiskScore,
  isFieldVisible,
  isNativeTemplate,
  missingRequiredFields,
} from "@/lib/form-fields";
import { formatDateTime, statusLabel } from "@/lib/utils";
import type { FormField, FormSubmission, FormTemplate } from "@/types";

function formStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "reviewed") return "success";
  if (status === "submitted") return "info";
  return "warning";
}

export default function PortalFormsPage() {
  const { session, token, loading: authLoading } = useAuth();
  const [forms, setForms] = useState<FormSubmission[]>([]);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [answers, setAnswers] = useState<FormSubmission["responses"]>({});

  const templateMap = useMemo(() => {
    const map = new Map<string, FormTemplate>();
    for (const t of templates) map.set(t.id, t);
    return map;
  }, [templates]);

  const selected = forms.find((f) => f.id === selectedId) || null;
  const selectedTemplate = selected ? templateMap.get(selected.formTemplateId) : undefined;
  const canMarkSubmitted = selected?.status === "not_started";

  const load = useCallback(async () => {
    if (!session?.clientId) {
      setError("No client account is linked to this user.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [formsRes, templatesRes] = await Promise.all([
        apiFetch<{ forms: FormSubmission[] }>(
          `/api/forms?clientId=${encodeURIComponent(session.clientId)}`,
          { token }
        ),
        apiFetch<{ templates: FormTemplate[] }>("/api/forms/templates", { token }),
      ]);
      setForms(formsRes.forms);
      setTemplates(templatesRes.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load forms");
    } finally {
      setLoading(false);
    }
  }, [session?.clientId, token]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  function openForm(formId: string) {
    const form = forms.find((f) => f.id === formId);
    setSelectedId(formId);
    setAnswers(form?.responses || {});
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function closeModal() {
    if (submitting) return;
    setModalOpen(false);
    setSelectedId(null);
    setAnswers({});
  }

  function setAnswer(key: string, value: string | number | boolean | null) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  async function markSubmitted() {
    if (!selected || !canMarkSubmitted) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const data = await apiFetch<{ form: FormSubmission }>(`/api/forms/${selected.id}/submit`, {
        method: "POST",
        token,
        body: JSON.stringify({}),
      });
      setForms((prev) => prev.map((f) => (f.id === selected.id ? data.form : f)));
      setSuccess("Marked as submitted. Our team will review it separately.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark form as submitted");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitNative(e: FormEvent) {
    e.preventDefault();
    if (!selected || !canMarkSubmitted || !selectedTemplate) return;
    const fields = selectedTemplate.fields || [];
    const missing = missingRequiredFields(fields, answers);
    if (missing.length) {
      setError(`Please complete: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }

    const riskScore = computeRiskScore(fields, answers);
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const data = await apiFetch<{ form: FormSubmission }>(`/api/forms/${selected.id}/submit`, {
        method: "POST",
        token,
        body: JSON.stringify({ responses: answers, riskScore }),
      });
      setForms((prev) => prev.map((f) => (f.id === selected.id ? data.form : f)));
      setSuccess("Form submitted. Our team will review your answers.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit form");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div>
        <PageHeader title="Forms" description="Loading your forms…" />
        <Card>
          <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
        </Card>
      </div>
    );
  }

  if (!session?.clientId) {
    return (
      <div>
        <PageHeader title="Forms" />
        <EmptyState
          title="No client linked"
          description="No client account is linked to this user."
        />
      </div>
    );
  }

  const liveForm = selectedId ? forms.find((f) => f.id === selectedId) || selected : null;
  const liveTemplate = liveForm ? templateMap.get(liveForm.formTemplateId) : selectedTemplate;
  const native =
    !!liveTemplate &&
    (isNativeTemplate(liveTemplate) ||
      (Boolean(liveTemplate.fields?.length) && !liveTemplate.googleFormUrl));
  const embedUrl = liveTemplate?.googleFormEmbedUrl || "";
  const openUrl = liveTemplate?.googleFormUrl || embedUrl;
  const alreadyDone = liveForm ? liveForm.status !== "not_started" : false;
  const visibleNativeFields = (liveTemplate?.fields || []).filter((f) =>
    isFieldVisible(f, alreadyDone ? liveForm?.responses || {} : answers)
  );

  return (
    <div>
      <PageHeader
        title="Forms"
        description="Complete the forms your team has assigned, then submit them for review. Your completed answers stay available here."
      />

      {error && !modalOpen ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {success && !modalOpen ? (
        <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      {forms.length === 0 ? (
        <EmptyState
          title="No forms assigned"
          description="Forms linked to your onboarding tasks will appear here."
        />
      ) : (
        <Card className="p-2">
          <ul className="divide-y divide-[var(--border)]">
            {forms.map((form) => {
              const name = templateMap.get(form.formTemplateId)?.name || "Untitled form";
              return (
                <li key={form.id}>
                  <button
                    type="button"
                    onClick={() => openForm(form.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]/70"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-[var(--ink)]">
                      {name}
                    </span>
                    <Badge tone={formStatusTone(form.status)}>{statusLabel(form.status)}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Modal
        open={modalOpen && !!liveForm}
        onClose={closeModal}
        title={liveTemplate?.name || "Form"}
        description={
          liveTemplate?.description ||
          (native
            ? "Fill out the form below, then submit when finished."
            : "Fill out the Google Form, then mark it as submitted when finished.")
        }
        size="xl"
        footer={
          <>
            {!native && openUrl ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")}
              >
                Open in Google Forms
              </Button>
            ) : null}
            {liveForm && liveForm.status === "not_started" ? (
              native ? (
                <Button type="submit" form="native-form-submit" disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit form"}
                </Button>
              ) : (
                <Button type="button" disabled={submitting} onClick={() => void markSubmitted()}>
                  {submitting ? "Saving…" : "Mark as submitted"}
                </Button>
              )
            ) : null}
            <Button type="button" variant="ghost" disabled={submitting} onClick={closeModal}>
              Close
            </Button>
          </>
        }
      >
        {error && modalOpen ? (
          <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {success && modalOpen ? (
          <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {success}
          </p>
        ) : null}

        {!liveTemplate ? (
          <p className="text-sm text-red-700">Form template could not be loaded.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
              <Badge tone={formStatusTone(liveForm!.status)}>
                {statusLabel(liveForm!.status)}
              </Badge>
              {typeof liveForm!.riskScore === "number" ? (
                <Badge tone={liveForm!.riskScore > 0 ? "warning" : "neutral"}>
                  Risk {liveForm!.riskScore}
                </Badge>
              ) : null}
              <span>
                {liveForm!.submittedAt
                  ? `Submitted ${formatDateTime(liveForm!.submittedAt)}`
                  : "Not submitted yet"}
                {liveForm!.reviewedAt
                  ? ` · Reviewed ${formatDateTime(liveForm!.reviewedAt)}`
                  : ""}
              </span>
            </div>

            {alreadyDone ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/50 px-3 py-3 text-sm">
                <p className="font-medium text-[var(--ink)]">
                  Status: {statusLabel(liveForm!.status)}
                </p>
                {liveForm!.reviewNote ? (
                  <p className="mt-2 text-[var(--ink-muted)]">
                    <span className="font-medium text-[var(--ink)]">Review note: </span>
                    {liveForm!.reviewNote}
                  </p>
                ) : (
                  <p className="mt-2 text-[var(--ink-muted)]">
                    Staff review happens separately. You’ll see a note here once reviewed.
                  </p>
                )}
              </div>
            ) : null}

            {native ? (
              alreadyDone ? (
                <div className="space-y-3">
                  {visibleNativeFields.length === 0 ? (
                    <p className="text-sm text-[var(--ink-muted)]">No answers recorded.</p>
                  ) : (
                    visibleNativeFields.map((field) => (
                      <div key={field.key} className="text-sm">
                        <p className="font-medium text-[var(--ink)]">{field.label}</p>
                        <p className="mt-0.5 text-[var(--ink-muted)]">
                          {formatAnswer(liveForm!.responses?.[field.key])}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <form
                  id="native-form-submit"
                  onSubmit={(e) => void submitNative(e)}
                  className="space-y-4"
                >
                  {visibleNativeFields.map((field) => (
                    <NativeFieldInput
                      key={field.key}
                      field={field}
                      value={answers[field.key]}
                      onChange={(v) => setAnswer(field.key, v)}
                      disabled={submitting}
                    />
                  ))}
                  {visibleNativeFields.length === 0 ? (
                    <p className="text-sm text-[var(--ink-muted)]">
                      No visible fields for this form yet.
                    </p>
                  ) : null}
                </form>
              )
            ) : embedUrl ? (
              <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <iframe
                  title={liveTemplate.name}
                  src={embedUrl}
                  className="w-full border-0"
                  style={{ height: 480 }}
                  loading="lazy"
                />
              </div>
            ) : openUrl ? (
              <p className="text-sm text-[var(--ink-muted)]">
                This form doesn’t have an embed URL. Use{" "}
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  Open in Google Forms
                </a>{" "}
                instead.
              </p>
            ) : (
              <p className="text-sm text-red-700">No Google Form URL is configured for this form.</p>
            )}

            {!alreadyDone && !native ? (
              <p className="text-xs text-[var(--ink-muted)]">
                After you finish the Google Form, click <strong>Mark as submitted</strong> so our
                team knows it’s ready for review.
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}

function formatAnswer(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function NativeFieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: string | number | boolean | null | undefined;
  onChange: (value: string | number | boolean | null) => void;
  disabled?: boolean;
}) {
  const id = `nf-${field.key}`;
  const str = value === null || value === undefined ? "" : String(value);

  if (field.type === "checkbox") {
    return (
      <div>
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input
            id={id}
            type="checkbox"
            checked={value === true || str.toLowerCase() === "true" || str === "1"}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            {field.label}
            {field.required ? " *" : ""}
          </span>
        </label>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div>
        <Label htmlFor={id}>
          {field.label}
          {field.required ? " *" : ""}
        </Label>
        <Textarea
          id={id}
          rows={3}
          required={field.required}
          disabled={disabled}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.type === "dropdown") {
    return (
      <div>
        <Label htmlFor={id}>
          {field.label}
          {field.required ? " *" : ""}
        </Label>
        <Select
          id={id}
          required={field.required}
          disabled={disabled}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {(field.options || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  const inputType =
    field.type === "email"
      ? "email"
      : field.type === "number"
        ? "number"
        : field.type === "date"
          ? "date"
          : field.type === "file"
            ? "text"
            : "text";

  return (
    <div>
      <Label htmlFor={id}>
        {field.label}
        {field.required ? " *" : ""}
      </Label>
      <Input
        id={id}
        type={inputType}
        required={field.required}
        disabled={disabled}
        value={str}
        onChange={(e) =>
          onChange(field.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)
        }
        placeholder={field.type === "file" ? "Paste a file URL or filename" : undefined}
      />
    </div>
  );
}
