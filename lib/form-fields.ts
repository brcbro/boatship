import type { FormField, FormSubmission } from "@/types";

export type FormResponses = FormSubmission["responses"];

export function isNativeTemplate(template: {
  mode?: "google" | "native";
  fields?: FormField[];
  googleFormUrl?: string;
}) {
  if (template.mode === "native") return true;
  if (template.mode === "google") return false;
  return Boolean(template.fields?.length) && !template.googleFormUrl;
}

export function isFieldVisible(field: FormField, responses: FormResponses) {
  if (!field.showIf?.key) return true;
  const raw = responses[field.showIf.key];
  const value =
    raw === null || raw === undefined ? "" : String(raw).trim().toLowerCase();
  return value === String(field.showIf.equals ?? "").trim().toLowerCase();
}

export function visibleFields(fields: FormField[], responses: FormResponses) {
  return fields.filter((f) => isFieldVisible(f, responses));
}

function isEmptyResponse(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean") return false;
  if (typeof value === "number") return Number.isNaN(value);
  return String(value).trim() === "";
}

export function missingRequiredFields(fields: FormField[], responses: FormResponses) {
  return visibleFields(fields, responses).filter(
    (f) => f.required && isEmptyResponse(responses[f.key])
  );
}

const RISK_RE = /risk|compliance|sanction/i;

function isAffirmative(value: string | number | boolean | null | undefined) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  return s === "yes" || s === "true" || s === "1";
}

/** Count filled risk/compliance/sanction fields answered yes/true/1. */
export function computeRiskScore(fields: FormField[], responses: FormResponses) {
  let score = 0;
  for (const field of fields) {
    if (!isFieldVisible(field, responses)) continue;
    const looksRisky = RISK_RE.test(field.key) || RISK_RE.test(field.label);
    if (!looksRisky) continue;
    const value = responses[field.key];
    if (isEmptyResponse(value)) continue;
    if (isAffirmative(value)) score += 1;
  }
  return score;
}

export function normalizeFormFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  const out: FormField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = String(row.key || "")
      .trim()
      .replace(/\s+/g, "_");
    const label = String(row.label || "").trim();
    if (!key || !label) continue;
    const type = String(row.type || "text") as FormField["type"];
    const allowed: FormField["type"][] = [
      "text",
      "textarea",
      "email",
      "dropdown",
      "date",
      "file",
      "number",
      "checkbox",
    ];
    const showIfRaw = row.showIf;
    let showIf: FormField["showIf"] = null;
    if (showIfRaw && typeof showIfRaw === "object") {
      const s = showIfRaw as Record<string, unknown>;
      const sk = String(s.key || "").trim();
      if (sk) {
        showIf = { key: sk, equals: String(s.equals ?? "") };
      }
    }
    out.push({
      key,
      label,
      type: allowed.includes(type) ? type : "text",
      required: Boolean(row.required),
      options: Array.isArray(row.options)
        ? row.options.map((o) => String(o).trim()).filter(Boolean)
        : undefined,
      showIf,
    });
  }
  return out;
}
