import { randomUUID } from "crypto";
import type { AuthSession, FormField, TemplateTask } from "@/types";
import { requireClientAccess } from "@/lib/client-access";
import { syncClientStatusFromTasks } from "@/lib/client-status";
import { normalizeFormFields } from "@/lib/form-fields";
import { hasPermission } from "@/lib/rbac";
import { getStore } from "@/lib/store";

export type HodiCreateFormsAction =
  | "create_form_template"
  | "assign_form"
  | "create_service_template";

type Payload = Record<string, unknown>;

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function assertAction(action: string): asserts action is HodiCreateFormsAction {
  if (!["create_form_template", "assign_form", "create_service_template"].includes(action)) {
    throw new Error("Unsupported Hodi form action");
  }
}

function assertTemplateManager(session: AuthSession): void {
  if (session.role !== "admin") throw new Error("Only admins can create templates");
}

function normalizedFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("At least one form field is required");
  const fields = normalizeFormFields(raw);
  if (fields.length !== raw.length) throw new Error("Every form field needs a key and label");
  const keys = new Set<string>();
  for (const field of fields) {
    if (keys.has(field.key)) throw new Error(`Duplicate form field key: ${field.key}`);
    keys.add(field.key);
    if (field.type === "dropdown" && !field.options?.length) {
      throw new Error(`Dropdown field ${field.key} needs options`);
    }
  }
  for (const field of fields) {
    if (field.showIf && (!keys.has(field.showIf.key) || field.showIf.key === field.key)) {
      throw new Error(`Invalid condition for form field ${field.key}`);
    }
  }
  return fields;
}

function normalizedTaskList(raw: unknown): TemplateTask[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("taskList must be an array");
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Task ${index + 1} must be an object`);
    }
    const row = item as Record<string, unknown>;
    const title = asText(row.title);
    if (!title) throw new Error(`Task ${index + 1} needs a title`);
    const type = row.type === "client_facing" ? "client_facing" : row.type === "internal" || row.type === undefined ? "internal" : null;
    if (!type) throw new Error(`Task ${index + 1} has an invalid type`);
    const assignedRole = row.assignedRole === undefined
      ? type === "client_facing" ? "client" : "team"
      : row.assignedRole;
    if (assignedRole !== "admin" && assignedRole !== "team" && assignedRole !== "client") {
      throw new Error(`Task ${index + 1} has an invalid assignedRole`);
    }
    const priority = row.priority === undefined ? "medium" : row.priority;
    if (priority !== "low" && priority !== "medium" && priority !== "high" && priority !== "urgent") {
      throw new Error(`Task ${index + 1} has an invalid priority`);
    }
    const dueDays = row.dueDays === undefined || row.dueDays === null ? null : Number(row.dueDays);
    if (dueDays !== null && (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 3650)) {
      throw new Error(`Task ${index + 1} has invalid dueDays`);
    }
    if (row.formTemplateId !== undefined && row.formTemplateId !== null && typeof row.formTemplateId !== "string") {
      throw new Error(`Task ${index + 1} has invalid formTemplateId`);
    }
    return {
      title,
      description: asText(row.description),
      type,
      order: index + 1,
      assignedRole,
      section: asText(row.section) || "General",
      formTemplateId: asText(row.formTemplateId) || null,
      requiresUpload: Boolean(row.requiresUpload),
      dueDays,
      priority,
    } satisfies TemplateTask;
  });
}

async function validate(action: HodiCreateFormsAction, payload: Payload, session: AuthSession) {
  const store = await getStore();
  if (action === "create_form_template") {
    assertTemplateManager(session);
    const name = asText(payload.name);
    if (!name) throw new Error("name is required");
    const fields = normalizedFields(payload.fields);
    return { kind: action, name, description: asText(payload.description), fields } as const;
  }
  if (action === "create_service_template") {
    assertTemplateManager(session);
    const name = asText(payload.name);
    if (!name) throw new Error("name is required");
    const taskList = normalizedTaskList(payload.taskList);
    for (const task of taskList) {
      if (task.formTemplateId && !await store.getFormTemplate(task.formTemplateId)) {
        throw new Error(`Form template ${task.formTemplateId} not found`);
      }
    }
    return { kind: action, name, description: asText(payload.description), industry: asText(payload.industry) || null, taskList } as const;
  }
  if (!hasPermission(session, "clients.manage")) throw new Error("Forbidden");
  const clientId = asText(payload.clientId);
  const formTemplateId = asText(payload.formTemplateId);
  if (!clientId || !formTemplateId) throw new Error("clientId and formTemplateId are required");
  await requireClientAccess(session, clientId);
  const [client, template] = await Promise.all([store.getClient(clientId), store.getFormTemplate(formTemplateId)]);
  if (!client) throw new Error("Client not found");
  if (!template) throw new Error("Form template not found");
  const dueDate = asText(payload.dueDate) || null;
  if (dueDate && Number.isNaN(Date.parse(dueDate))) throw new Error("dueDate must be a valid date");
  return {
    kind: action,
    client,
    template,
    title: asText(payload.title) || `Complete ${template.name}`,
    description: asText(payload.description),
    dueDate,
  } as const;
}

export async function previewCreateFormsAction(action: string, payload: Payload, session: AuthSession) {
  assertAction(action);
  const checked = await validate(action, payload, session);
  if (checked.kind === "create_form_template") {
    return {
      title: `Create form template: ${checked.name}`,
      changes: [`Create a native form with ${checked.fields.length} fields`, "Make the template available for assignment"],
      diff: [
        { field: "name", label: "Form template", before: "Does not exist", after: checked.name },
        { field: "fields", label: "Fields", before: "None", after: checked.fields.map((field) => `${field.label} (${field.type}${field.required ? ", required" : ""})`).join(", ") },
      ],
    };
  }
  if (checked.kind === "create_service_template") {
    return {
      title: `Create draft service template: ${checked.name}`,
      changes: [`Save a draft with ${checked.taskList.length} tasks`, "An admin must publish it before it can be applied to a client"],
      diff: [
        { field: "name", label: "Service template", before: "Does not exist", after: checked.name },
        { field: "publishStatus", label: "Status", before: "Does not exist", after: "Draft" },
        { field: "tasks", label: "Tasks", before: "None", after: checked.taskList.map((task) => task.title).join(", ") || "None" },
      ],
    };
  }
  return {
    title: `Assign ${checked.template.name} to ${checked.client.companyName}`,
    changes: [
      `Create client-facing task “${checked.title}”`,
      "Create a linked form in the client portal",
      "No email or calendar invitation will be sent",
    ],
    diff: [
      { field: "client", label: "Client", before: "No form assignment", after: checked.client.companyName },
      { field: "formTemplate", label: "Form", before: "No form assignment", after: checked.template.name },
      { field: "dueDate", label: "Due date", before: "Not set", after: checked.dueDate || "Not set" },
    ],
  };
}

export async function executeCreateFormsAction(
  action: string,
  payload: Payload,
  session: AuthSession,
  proposalId?: string,
) {
  assertAction(action);
  // Recheck access and referenced records at execution time, after approval.
  const checked = await validate(action, payload, session);
  const store = await getStore();
  const now = new Date().toISOString();
  if (checked.kind === "create_form_template") {
    const template = await store.upsertFormTemplate({
      id: randomUUID(),
      name: checked.name,
      description: checked.description,
      mode: "native",
      googleFormUrl: "",
      fields: checked.fields,
      createdAt: now,
      updatedAt: now,
    });
    return { template, url: "/forms" };
  }
  if (checked.kind === "create_service_template") {
    const template = await store.upsertTemplate({
      id: randomUUID(),
      name: checked.name,
      description: checked.description,
      industry: checked.industry,
      taskList: checked.taskList,
      version: 1,
      publishStatus: "draft",
      parentTemplateId: null,
      createdAt: now,
      updatedAt: now,
    });
    return { template, url: "/templates" };
  }
  const existingTasks = await store.listTasks(checked.client.id);
  const task = await store.createTask({
    clientId: checked.client.id,
    title: checked.title,
    description: checked.description,
    type: "client_facing",
    assignedTo: null,
    assignedRole: "client",
    status: "pending",
    dueDate: checked.dueDate,
    order: existingTasks.length ? Math.max(...existingTasks.map((item) => item.order)) + 1 : 1,
    formTemplateId: checked.template.id,
    requiresUpload: false,
  });
  let form;
  try {
    form = await store.createForm({ clientId: checked.client.id, formTemplateId: checked.template.id, taskId: task.id });
  } catch (error) {
    await store.deleteTask(task.id);
    throw error;
  }
  await syncClientStatusFromTasks(store, checked.client.id, { notifyComplete: false });
  await store.addActivity({
    clientId: checked.client.id,
    actorId: session.uid,
    actorName: session.name,
    action: "hodi.form_assigned",
    meta: { proposalId: proposalId || null, taskId: task.id, formId: form.id, formTemplateId: checked.template.id },
  });
  return { task, form, url: `/clients/${checked.client.id}` };
}
