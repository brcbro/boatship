import type { Client, FormField, FormSubmission } from "@/types";

export type FormResponses = FormSubmission["responses"];

export const FORM_RESPONSE_LIMITS = {
  text: 2000,
  textarea: 20000,
  email: 254,
  dropdown: 2000,
  date: 10,
  file: 2048,
  number: 100,
  checkbox: 5,
} as const;

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function isValidEmail(value: string) {
  const email = value.trim();
  if (email.length > FORM_RESPONSE_LIMITS.email || /[\s\u0000-\u001f\u007f]/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !parts[1]) return false;
  if (parts[0].startsWith(".") || parts[0].endsWith(".") || parts[0].includes("..")) return false;
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0])) return false;
  const labels = parts[1].split(".");
  return labels.length >= 2 && labels.every((label) =>
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)
  );
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The same field rules run in the portal and at the server's write boundary. */
export function validateFormResponses(
  fields: FormField[],
  raw: unknown,
  { partial = false }: { partial?: boolean } = {}
): { responses: FormResponses; errors: Record<string, string>; valid: boolean } {
  const responses: FormResponses = {};
  const errors: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { responses, errors: { _form: "Answers must be a field-value object." }, valid: false };
  }
  const known = new Map(fields.filter((field) => !UNSAFE_KEYS.has(field.key)).map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(raw)) {
    const field = known.get(key);
    if (!field) {
      errors._form = "The form contains an unknown answer. Reopen the current form and try again.";
      continue;
    }
    if (value === null || value === "") {
      responses[key] = value;
      continue;
    }
    if (field.type === "checkbox") {
      if (typeof value === "boolean") responses[key] = value;
      else errors[key] = "Choose yes or no.";
      continue;
    }
    if (field.type === "number") {
      const numericText = typeof value === "string" ? value.trim() : "";
      const numeric = typeof value === "number" ? value :
        numericText && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(numericText) ? Number(numericText) : NaN;
      if (!Number.isFinite(numeric) || Math.abs(numeric) > Number.MAX_SAFE_INTEGER) {
        errors[key] = "Enter a finite number within the supported range.";
      } else responses[key] = numeric;
      continue;
    }
    if (typeof value !== "string") {
      errors[key] = "Enter a text answer.";
      continue;
    }
    const normalized = value.trim();
    if (value.length > FORM_RESPONSE_LIMITS[field.type]) {
      errors[key] = `Use ${FORM_RESPONSE_LIMITS[field.type].toLocaleString("en-US")} characters or fewer.`;
    } else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      errors[key] = "Remove unsupported control characters.";
    } else if (normalized && field.type === "email" && !isValidEmail(normalized)) {
      errors[key] = "Enter a valid email address.";
    } else if (normalized && field.type === "date" && !isValidDate(normalized)) {
      errors[key] = "Enter a valid date in YYYY-MM-DD format.";
    } else if (normalized && field.type === "dropdown" && !(field.options || []).includes(normalized)) {
      errors[key] = "Choose one of the available options.";
    } else responses[key] = field.type === "email" ? normalized.toLowerCase() :
      field.type === "text" || field.type === "textarea" ? value : normalized;
  }
  // Visibility is evaluated against validated answers: an invalid parent value
  // cannot hide a required field or alter the server's risk calculation.
  if (!partial) {
    for (const field of visibleFields(fields, responses)) {
      if (field.required && !errors[field.key] && isEmptyResponse(responses[field.key])) {
        errors[field.key] = `${field.label} is required.`;
      }
    }
  }
  return { responses, errors, valid: Object.keys(errors).length === 0 };
}

function normalizedFieldName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function responseText(value: FormResponses[string]) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

/**
 * Turn native form answers into the client record's canonical identity fields
 * and custom fields. Empty answers are ignored so a partially completed form
 * never erases details already on the client record.
 */
export function clientDetailsFromForm(
  client: Client,
  fields: FormField[],
  responses: FormResponses
): Partial<Client> {
  const customFields: Record<string, string> = { ...(client.customFields || {}) };
  let name = client.name;
  let companyName = client.companyName;
  let primaryContactEmail = client.primaryContactEmail;
  let firstName = "";
  let lastName = "";

  for (const field of fields) {
    if (!isFieldVisible(field, responses)) continue;
    const value = responseText(responses[field.key]);
    if (!value) continue;

    const key = normalizedFieldName(field.key);
    const label = normalizedFieldName(field.label);
    const aliases = new Set([key, label]);

    if (aliases.has("first_name") || aliases.has("given_name")) firstName = value;
    else if (aliases.has("last_name") || aliases.has("surname") || aliases.has("family_name")) {
      lastName = value;
    } else if (
      aliases.has("name") ||
      aliases.has("full_name") ||
      aliases.has("client_name") ||
      aliases.has("contact_name") ||
      aliases.has("primary_contact")
    ) {
      name = value;
    } else if (
      aliases.has("company") ||
      aliases.has("company_name") ||
      aliases.has("business_name") ||
      aliases.has("organization") ||
      aliases.has("organisation")
    ) {
      companyName = value;
    } else if (
      aliases.has("email") ||
      aliases.has("email_address") ||
      aliases.has("contact_email") ||
      aliases.has("primary_contact_email")
    ) {
      primaryContactEmail = value.toLowerCase();
    }

    customFields[field.label.trim() || field.key.trim()] = value;
  }

  if ((firstName || lastName) && !(name && name !== client.name)) {
    name = [firstName, lastName].filter(Boolean).join(" ");
  }

  return {
    name: name.trim(),
    companyName: companyName.trim(),
    primaryContactEmail: primaryContactEmail.trim().toLowerCase(),
    customFields,
  };
}

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
    if (!key || !label || UNSAFE_KEYS.has(key) || out.some((field) => field.key === key)) continue;
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
