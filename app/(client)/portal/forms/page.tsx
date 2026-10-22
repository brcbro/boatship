"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/shared/AuthProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Dropdown,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
  Textarea,
} from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import {
  FORM_RESPONSE_LIMITS,
  isFieldVisible,
  isNativeTemplate,
  validateFormResponses,
} from "@/lib/form-fields";
import { discardSessionDraft, readSessionDraft, sessionDraftKey, writeSessionDraft } from "@/lib/session-drafts";
import { formatDateTime, statusLabel } from "@/lib/utils";
import type { FormField, FormSubmission, FormTemplate } from "@/types";

function formStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "reviewed") return "success";
  if (status === "submitted") return "info";
  return "warning";
}

export default function PortalFormsPage() {
  return <Suspense fallback={<p className="text-sm text-[var(--ink-muted)]">Loading your forms…</p>}><PortalFormsInner /></Suspense>;
}

type EngagementOption = { id: string; name: string; status: string };

function PortalFormsInner() {
  const { session, token, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const initialEngagementId = searchParams.get("engagementId") || "";
  const initialIncludeAccountWide = searchParams.get("includeAccountWide") === "1" || searchParams.get("includeAccountWide") === "true";
  const [engagementId, setEngagementId] = useState(initialEngagementId);
  const [includeAccountWide, setIncludeAccountWide] = useState(initialIncludeAccountWide);
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [forms, setForms] = useState<FormSubmission[]>([]);
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [answers, setAnswers] = useState<FormSubmission["responses"]>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [draftStatus, setDraftStatus] = useState("");
  const [draftPersisted, setDraftPersisted] = useState(false);
  const draftMemory = useRef(new Map<string, { responses: FormSubmission["responses"]; saved: boolean }>());
  const submissionComplete = useRef(new Set<string>());
  const loadSequence = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => { setEngagementId(initialEngagementId); setIncludeAccountWide(initialIncludeAccountWide); }, 0);
    return () => window.clearTimeout(timer);
  }, [initialEngagementId, initialIncludeAccountWide]);

  const templateMap = useMemo(() => {
    const map = new Map<string, FormTemplate>();
    for (const t of templates) map.set(t.id, t);
    return map;
  }, [templates]);

  const selected = forms.find((f) => f.id === selectedId) || null;
  const selectedTemplate = selected ? templateMap.get(selected.formTemplateId) : undefined;
  const selectedContext = engagements.find((item) => item.id === selected?.engagementId);
  const contextClosed = selectedContext?.status === "completed" || selectedContext?.status === "cancelled";
  const canMarkSubmitted = selected?.status === "not_started" && !contextClosed;
  const clientId = session?.clientId;
  const hasDraftChanges = selected?.status === "not_started" && JSON.stringify(answers) !== JSON.stringify(selected.responses || {});

  useEffect(() => {
    if (!hasDraftChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDraftChanges]);

  function draftKey(form: FormSubmission) {
    return sessionDraftKey({
      userId: session!.uid,
      area: "form",
      resourceId: form.id,
      context: `${form.clientId}:${form.engagementId || "account"}:${form.formTemplateId}`,
    });
  }

  const load = useCallback(async () => {
    const request = ++loadSequence.current;
    if (!clientId) {
      setError("No client account is linked to this user.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [formsRes, templatesRes, engagementRes] = await Promise.all([
        apiFetch<{ forms: FormSubmission[] }>(
          `/api/forms?clientId=${encodeURIComponent(clientId)}${engagementId ? `&engagementId=${encodeURIComponent(engagementId)}` : ""}${includeAccountWide ? "&includeAccountWide=1" : ""}`,
          { token }
        ),
        apiFetch<{ templates: FormTemplate[] }>("/api/forms/templates", { token }),
        apiFetch<{ engagements: EngagementOption[] }>(`/api/clients/${encodeURIComponent(clientId)}/engagements`, { token }),
      ]);
      if (request !== loadSequence.current) return;
      setForms(formsRes.forms);
      setTemplates(templatesRes.templates);
      setEngagements(engagementRes.engagements);
    } catch (err) {
      if (request === loadSequence.current) setError(err instanceof Error ? err.message : "Failed to load forms");
    } finally {
      if (request === loadSequence.current) setLoading(false);
    }
  }, [clientId, token, engagementId, includeAccountWide]);

  useEffect(() => {
    if (authLoading) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [authLoading, load]);

  function openForm(formId: string) {
    const form = forms.find((f) => f.id === formId);
    if (!form || !session) return;
    const fields = templateMap.get(form.formTemplateId)?.fields || [];
    const key = draftKey(form);
    const draft = form.status === "not_started" && !submissionComplete.current.has(key)
      ? readSessionDraft(key, (value) => decodeFormDraft(value, fields)) : null;
    const memory = form.status === "not_started" ? draftMemory.current.get(key) : undefined;
    setSelectedId(formId);
    setAnswers(memory?.responses || draft?.value || form.responses || {});
    setFieldErrors({});
    setDraftPersisted(Boolean(draft));
    setDraftStatus(memory && !memory.saved
      ? "Answers restored on this page. Browser draft storage is unavailable; copy them before leaving."
      : memory || draft ? "Draft restored. Your answers stay in this tab for up to 24 hours and clear on sign-out." : "");
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function closeModal() {
    if (submitting) return;
    setModalOpen(false);
    setSelectedId(null);
    setAnswers({});
    setFieldErrors({});
  }

  function setAnswer(key: string, value: string | number | boolean | null) {
    if (!selected || !session) return;
    const next = { ...answers, [key]: value };
    setAnswers(next);
    setFieldErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([fieldKey]) => fieldKey !== key)));
    const storageKey = draftKey(selected);
    const saved = writeSessionDraft(storageKey, { fields: JSON.stringify(selectedTemplate?.fields || []), responses: next });
    draftMemory.current.set(storageKey, { responses: next, saved });
    setDraftPersisted((previous) => previous || saved);
    setDraftStatus(saved
      ? "Draft saved in this tab. It expires after 24 hours and clears on sign-out."
      : "Browser draft storage is unavailable. Your answers stay on this page; copy them before leaving.");
  }

  function discardDraft() {
    if (!selected || !session || submitting || !window.confirm("Discard these draft answers? Submitted answers are kept.")) return;
    const key = draftKey(selected);
    const removed = discardSessionDraft(key);
    if (!removed && draftPersisted) {
      setError("Couldn’t remove the saved draft. Try again before closing this form.");
      return;
    }
    draftMemory.current.delete(key);
    setAnswers(selected.responses || {});
    setFieldErrors({});
    setDraftPersisted(false);
    setDraftStatus("Draft discarded.");
    setError("");
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
    const checked = validateFormResponses(fields, answers);
    setFieldErrors(checked.errors);
    if (!checked.valid) {
      const invalidHidden = fields.filter((field) => checked.errors[field.key] && !isFieldVisible(field, answers));
      setError(invalidHidden.length
        ? `Correct these earlier answers before submitting: ${invalidHidden.map((field) => field.label).join(", ")}. Restore the related option to show them.`
        : "Check the highlighted answers, then submit again.");
      requestAnimationFrame(() => {
        const key = Object.keys(checked.errors).find((key) => key !== "_form");
        if (key) document.getElementById(`nf-${key}`)?.focus();
      });
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const data = await apiFetch<{ form: FormSubmission }>(`/api/forms/${selected.id}/submit`, {
        method: "POST",
        token,
        body: JSON.stringify({ responses: checked.responses }),
      });
      setForms((prev) => prev.map((f) => (f.id === selected.id ? data.form : f)));
      const key = draftKey(selected);
      submissionComplete.current.add(key);
      draftMemory.current.delete(key);
      discardSessionDraft(key);
      setDraftStatus("");
      setFieldErrors({});
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
      <div className="mb-5 max-w-md">
        <Label htmlFor="portal-forms-context">Work context</Label>
        <Dropdown id="portal-forms-context" value={engagementId} disabled={submitting} onChange={(value) => { closeModal(); setEngagementId(value); }} options={[
          { value: "", label: "All work" },
          { value: "account", label: "Account-wide" },
          ...engagements.map((item) => ({ value: item.id, label: item.name })),
        ]} />
        {engagementId && engagementId !== "account" ? <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-[var(--ink-muted)]"><input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={includeAccountWide} disabled={submitting} onChange={(event) => { closeModal(); setIncludeAccountWide(event.target.checked); }} />Also show account-wide forms</label> : null}
      </div>

      {error && !modalOpen ? (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {success && !modalOpen ? (
        <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      {forms.length === 0 ? (
        <EmptyState
          title="No forms assigned"
          description={engagementId ? "No forms are assigned in this work context." : "Forms linked to your assigned tasks will appear here."}
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
                    <span className="min-w-0 text-sm font-medium text-[var(--ink)]">
                      <span className="block truncate">{name}</span>
                      <span className="mt-0.5 block truncate text-xs font-normal text-[var(--ink-muted)]">{form.engagementId ? engagements.find((item) => item.id === form.engagementId)?.name || "Engagement" : "Account-wide"}</span>
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
                <Button type="submit" form="native-form-submit" disabled={submitting || contextClosed}>
                  {submitting ? "Submitting…" : "Submit form"}
                </Button>
              ) : (
                <Button type="button" disabled={submitting || contextClosed} onClick={() => void markSubmitted()}>
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
          <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {success && modalOpen ? (
          <p role="status" className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
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
              <span>{liveForm!.engagementId ? engagements.find((item) => item.id === liveForm!.engagementId)?.name || "Engagement" : "Account-wide"}</span>
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
            {!alreadyDone && contextClosed ? <p className="text-sm text-[var(--ink-muted)]">This engagement is closed. Your saved answers are read-only.</p> : null}

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
                  noValidate
                  className="space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p role="status" className="max-w-prose text-sm text-[var(--ink-muted)]">
                      {draftStatus || "Unsubmitted answers are saved in this tab for up to 24 hours. Submit them to share with your team."}
                    </p>
                    {hasDraftChanges ? <Button type="button" variant="ghost" disabled={submitting} onClick={discardDraft}>Discard draft</Button> : null}
                  </div>
                  {fieldErrors._form ? <p role="alert" className="text-sm text-[var(--danger)]">{fieldErrors._form}</p> : null}
                  {visibleNativeFields.map((field) => (
                    <NativeFieldInput
                      key={field.key}
                      field={field}
                      value={answers[field.key]}
                      onChange={(v) => setAnswer(field.key, v)}
                      disabled={submitting || contextClosed}
                      error={fieldErrors[field.key]}
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

function decodeFormDraft(value: unknown, fields: FormField[]): FormSubmission["responses"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as { fields?: unknown; responses?: unknown };
  if (draft.fields !== JSON.stringify(fields) || !draft.responses || typeof draft.responses !== "object" || Array.isArray(draft.responses)) return null;
  const known = new Map(fields.map((field) => [field.key, field]));
  for (const [key, answer] of Object.entries(draft.responses)) {
    const field = known.get(key);
    if (!field || ["__proto__", "constructor", "prototype"].includes(key)) return null;
    if (answer !== null && typeof answer !== "string" && typeof answer !== "number" && typeof answer !== "boolean") return null;
    if (typeof answer === "string" && answer.length > FORM_RESPONSE_LIMITS[field.type]) return null;
    if (typeof answer === "number" && !Number.isFinite(answer)) return null;
  }
  // Retain unfinished, invalid text so it can be corrected after refresh.
  return draft.responses as FormSubmission["responses"];
}

function NativeFieldInput({
  field,
  value,
  onChange,
  disabled,
  error,
}: {
  field: FormField;
  value: string | number | boolean | null | undefined;
  onChange: (value: string | number | boolean | null) => void;
  disabled?: boolean;
  error?: string;
}) {
  const id = `nf-${field.key}`;
  const str = value === null || value === undefined ? "" : String(value);
  const errorId = `${id}-error`;
  const feedback = error ? <p id={errorId} className="mt-1 text-sm text-[var(--danger)]">{error}</p> : null;

  if (field.type === "checkbox") {
    return (
      <div>
        <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--ink)]">
          <input
            id={id}
            type="checkbox"
            checked={value === true || str.toLowerCase() === "true" || str === "1"}
            disabled={disabled}
            aria-required={field.required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="h-5 w-5 accent-[var(--brand)]"
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            {field.label}
            {field.required ? " *" : ""}
          </span>
        </label>
        {feedback}
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
          maxLength={FORM_RESPONSE_LIMITS.textarea}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          disabled={disabled}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
        {feedback}
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
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
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
        {feedback}
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
        maxLength={FORM_RESPONSE_LIMITS[field.type]}
        step={field.type === "number" ? "any" : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : field.type === "file" ? `${id}-hint` : undefined}
        disabled={disabled}
        value={str}
        onChange={(e) =>
          onChange(e.target.value)
        }
        placeholder={field.type === "file" ? "Paste a file URL or filename" : undefined}
      />
      {field.type === "file" ? <p id={`${id}-hint`} className="mt-1 text-xs text-[var(--ink-muted)]">Upload files in Documents, then enter their filename or link here.</p> : null}
      {feedback}
    </div>
  );
}
