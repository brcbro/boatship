import { z } from "zod";
import type { AuthSession } from "@/types";
import { jsonError } from "@/lib/api";
import { requireClientAccess } from "@/lib/client-access";
import { notifyUser } from "@/lib/notifications";
import { getPrisma } from "@/lib/prisma";
import { createProductWithOwner, createReleaseWithWorkItems } from "@/lib/product-persistence";
import { createApproval, createMilestone } from "@/lib/project-operations";
import {
  id, milestoneSchema, notifyProductMembers, parseBody, productSchema, recordProductActivity,
  releaseSchema, requireMilestone, requireProductAccess, requireProductMember,
  requireRepository, requireStaffUser, uniqueSlug, validateDependencies,
  validateReleaseWork, workItemSchema,
} from "@/lib/products";
import { hasPermission } from "@/lib/rbac";
import { getStore } from "@/lib/store";

export const hodiProjectCreationActions = [
  "create_project_milestone",
  "create_project_approval",
  "create_product",
  "create_product_milestone",
  "create_product_work_item",
  "create_product_release",
] as const;

export type HodiProjectCreationAction = typeof hodiProjectCreationActions[number];
type Payload = Record<string, unknown>;
type Preview = { title: string; changes: string[]; diff: { field: string; label: string; before: string; after: string }[] };

const projectMilestoneSchema = z.object({
  clientId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).optional(),
  dueDate: z.union([z.iso.date(), z.iso.datetime()]).nullable().optional(),
  taskIds: z.array(z.string().min(1)).optional(),
});
const projectApprovalSchema = z.object({
  clientId: z.string().trim().min(1),
  subject: z.string().trim().min(1).max(200),
  description: z.string().max(10000).optional(),
  kind: z.enum(["document", "design", "release"]).optional(),
});

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function field(label: string, after: string) {
  return { field: label.toLowerCase().replaceAll(" ", "_"), label, before: "Not created", after };
}
function preview(title: string, diff: Preview["diff"]): Preview {
  return { title, changes: diff.map((item) => `${item.label}: ${item.after}`), diff };
}

async function validateProjectMilestone(payload: Payload, session: AuthSession) {
  if (!hasPermission(session, "clients.manage")) throw jsonError("Forbidden", 403);
  const input = parseBody(projectMilestoneSchema, payload);
  await requireClientAccess(session, input.clientId);
  const store = await getStore();
  const client = await store.getClient(input.clientId);
  if (!client) throw jsonError("Client not found", 404);
  const taskIds = input.taskIds || [];
  if (new Set(taskIds).size !== taskIds.length) throw jsonError("Duplicate task", 400);
  if (taskIds.length) {
    const tasks = await store.listTasks(input.clientId);
    const available = new Set(tasks.map((task) => task.id));
    if (taskIds.some((taskId) => !available.has(taskId))) throw jsonError("Tasks must belong to this client", 400);
  }
  return { input, client };
}

async function validateProjectApproval(payload: Payload, session: AuthSession) {
  if (!hasPermission(session, "clients.manage")) throw jsonError("Forbidden", 403);
  const input = parseBody(projectApprovalSchema, payload);
  await requireClientAccess(session, input.clientId);
  const client = await (await getStore()).getClient(input.clientId);
  if (!client) throw jsonError("Client not found", 404);
  return { input, client };
}

async function validateProduct(action: HodiProjectCreationAction, payload: Payload, session: AuthSession) {
  if (action === "create_product") {
    if (session.role !== "admin") throw jsonError("Forbidden", 403);
    const input = parseBody(productSchema, payload);
    await requireStaffUser(input.ownerId || session.uid);
    return { input, name: input.name };
  }
  const productId = text(payload.productId);
  if (!productId) throw jsonError("productId is required", 400);
  const { product } = await requireProductAccess(session, productId, true);
  if (action === "create_product_milestone") {
    const input = parseBody(milestoneSchema, payload);
    if (input.ownerId) { await requireStaffUser(input.ownerId); await requireProductMember(productId, input.ownerId); }
    return { input, productId, name: product.name };
  }
  if (action === "create_product_work_item") {
    const input = parseBody(workItemSchema, payload);
    await requireMilestone(productId, input.milestoneId);
    await validateDependencies(productId, null, input.dependencyIds || []);
    if (input.assigneeId) { await requireStaffUser(input.assigneeId); await requireProductMember(productId, input.assigneeId); }
    return { input, productId, name: product.name };
  }
  const input = parseBody(releaseSchema, payload);
  await requireRepository(input.repositoryId);
  await validateReleaseWork(productId, input.workItemIds || []);
  return { input, productId, name: product.name };
}

export async function previewHodiProjectCreation(action: HodiProjectCreationAction, payload: Payload, session: AuthSession): Promise<Preview> {
  if (action === "create_project_approval") {
    const { input, client } = await validateProjectApproval(payload, session);
    return preview(`Request approval for ${client.companyName}`, [
      field("Subject", input.subject), field("Client", client.companyName),
      field("Description", input.description || "None"), field("Kind", input.kind || "document"),
      field("Status", "pending"),
    ]);
  }
  if (action === "create_project_milestone") {
    const { input, client } = await validateProjectMilestone(payload, session);
    return preview(`Create milestone for ${client.companyName}`, [
      field("Title", input.title), field("Client", client.companyName),
      field("Description", input.description || "None"),
      field("Due date", input.dueDate || "Not set"),
      field("Linked tasks", input.taskIds?.join(", ") || "None"),
    ]);
  }
  const checked = await validateProduct(action, payload, session);
  if (action === "create_product") {
    const input = checked.input as z.infer<typeof productSchema>;
    return preview(`Create product ${input.name}`, [field("Name", input.name), field("Type", input.type), field("Description", input.description || "None"), field("Owner", input.ownerId || session.uid), field("Stage", input.stage || "idea"), field("Website", input.websiteUrl || "None")]);
  }
  if (action === "create_product_milestone") {
    const input = checked.input as z.infer<typeof milestoneSchema>;
    return preview(`Create product milestone for ${checked.name}`, [field("Title", input.title), field("Product", checked.name), field("Description", input.description || "None"), field("Target date", input.targetDate || "Not set"), field("Status", input.status || "planned"), field("Owner", input.ownerId || "Not assigned")]);
  }
  if (action === "create_product_work_item") {
    const input = checked.input as z.infer<typeof workItemSchema>;
    return preview(`Create product work for ${checked.name}`, [field("Title", input.title), field("Product", checked.name), field("Description", input.description || "None"), field("Milestone", input.milestoneId || "None"), field("Status", input.status || "todo"), field("Priority", input.priority || "medium"), field("Assignee", input.assigneeId || "Not assigned"), field("Due date", input.dueDate || "Not set"), field("Dependencies", input.dependencyIds?.join(", ") || "None"), field("Notification", input.assigneeId && input.assigneeId !== session.uid ? "Notify assignee" : "None")]);
  }
  const input = checked.input as z.infer<typeof releaseSchema>;
  return preview(`Create release for ${checked.name}`, [field("Version", input.version), field("Product", checked.name), field("Status", input.status || "planned"), field("Environment", input.environment || "production"), field("Release date", input.releasedAt || "Not set"), field("Notes", input.notes || "None"), field("Repository", input.repositoryId || "None"), field("Commit", input.commitSha || "None"), field("Deployment URL", input.deploymentUrl || "None"), field("Linked work", input.workItemIds?.join(", ") || "None"), field("Notification", input.status === "released" ? "Notify product members" : "None")]);
}

export async function executeHodiProjectCreation(action: HodiProjectCreationAction, payload: Payload, session: AuthSession, proposalId: string) {
  // Repeat authorization and validation after approval; access or referenced records may have changed.
  if (action === "create_project_approval") {
    const { input } = await validateProjectApproval(payload, session);
    const approval = await createApproval({ clientId: input.clientId, subject: input.subject, description: input.description || "", kind: input.kind || "document", requestedBy: session.uid });
    await (await getStore()).addActivity({ clientId: input.clientId, actorId: session.uid, actorName: session.name, action: "hodi.project_approval_created", meta: { proposalId, approvalId: approval.id } });
    return { approval, href: `/clients/${input.clientId}` };
  }
  if (action === "create_project_milestone") {
    const { input } = await validateProjectMilestone(payload, session);
    const milestone = await createMilestone({ clientId: input.clientId, title: input.title, description: input.description || "", dueDate: input.dueDate || null, status: "planned", taskIds: input.taskIds || [] });
    await (await getStore()).addActivity({ clientId: input.clientId, actorId: session.uid, actorName: session.name, action: "hodi.project_milestone_created", meta: { proposalId, milestoneId: milestone.id } });
    return { milestone, href: `/clients/${input.clientId}` };
  }
  const checked = await validateProduct(action, payload, session);
  const db = getPrisma();
  if (action === "create_product") {
    const input = checked.input as z.infer<typeof productSchema>;
    const ownerId = input.ownerId || session.uid;
    const product = await createProductWithOwner(input, ownerId, await uniqueSlug(input.name));
    await recordProductActivity(product.id, session.uid, "product.created", { name: product.name, type: product.type, ownerId, proposalId });
    return { product, href: `/products/${product.id}` };
  }
  const productId = checked.productId!;
  if (action === "create_product_milestone") {
    const input = checked.input as z.infer<typeof milestoneSchema>;
    const milestone = await db.productMilestone.create({ data: { id: id(), productId, title: input.title, description: input.description || "", targetDate: input.targetDate ? new Date(input.targetDate) : null, status: input.status || "planned", ownerId: input.ownerId || null } });
    await recordProductActivity(productId, session.uid, "milestone.created", { milestoneId: milestone.id, title: milestone.title, status: milestone.status, proposalId });
    return { milestone, href: `/products/${productId}` };
  }
  if (action === "create_product_work_item") {
    const input = checked.input as z.infer<typeof workItemSchema>;
    const workItem = await db.productWorkItem.create({ data: { id: id(), productId, title: input.title, description: input.description || "", milestoneId: input.milestoneId || null, status: input.status || "todo", priority: input.priority || "medium", assigneeId: input.assigneeId || null, dueDate: input.dueDate ? new Date(input.dueDate) : null, dependencyIds: input.dependencyIds || [] } });
    await recordProductActivity(productId, session.uid, "work_item.created", { workItemId: workItem.id, title: workItem.title, status: workItem.status, assigneeId: workItem.assigneeId, proposalId });
    if (input.assigneeId && input.assigneeId !== session.uid) {
      try { await notifyUser({ userId: input.assigneeId, kind: "task_assigned", title: `Product work assigned: ${input.title}`, body: checked.name, href: `/products/${productId}` }); }
      catch (error) { console.error("Product work notification failed", { productId, workItemId: workItem.id, error }); }
    }
    return { workItem, href: `/products/${productId}` };
  }
  const input = checked.input as z.infer<typeof releaseSchema>;
  const release = await createReleaseWithWorkItems(productId, input);
  await recordProductActivity(productId, session.uid, "release.created", { releaseId: release.id, version: release.version, status: release.status, proposalId });
  if (release.status === "released") {
    try { await notifyProductMembers(productId, session.uid, `Released ${checked.name} ${release.version}`, release.notes); }
    catch (error) { console.error("Product release notification failed", { productId, releaseId: release.id, error }); }
  }
  return { release: { ...release, workItemIds: release.workLinks.map((link) => link.workItemId) }, href: `/products/${productId}` };
}
