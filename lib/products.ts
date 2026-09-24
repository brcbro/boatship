import { randomUUID } from "crypto";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { jsonError } from "@/lib/api";
import { notifyUser } from "@/lib/notifications";
import type { AuthSession } from "@/types";

export const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["internal_tool", "saas", "other"]),
  description: z.string().max(10000).optional(),
  stage: z.enum(["idea", "building", "beta", "live", "paused", "retired"]).optional(),
  ownerId: z.string().min(1).optional(),
  visibility: z.enum(["members"]).optional(),
  websiteUrl: z.url().nullable().optional(),
});
export const memberSchema = z.object({ userId: z.string().min(1), role: z.enum(["owner", "editor", "viewer"]) });
const dateInput = z.union([z.iso.datetime(), z.iso.date()]);
export const milestoneSchema = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().max(10000).optional(),
  targetDate: dateInput.nullable().optional(), status: z.enum(["planned", "in_progress", "done", "cancelled"]).optional(),
  ownerId: z.string().nullable().optional(),
});
export const workItemSchema = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().max(20000).optional(),
  milestoneId: z.string().nullable().optional(), status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(), assigneeId: z.string().nullable().optional(),
  dueDate: dateInput.nullable().optional(), dependencyIds: z.array(z.string()).optional(),
});
export const releaseSchema = z.object({
  version: z.string().trim().min(1).max(100), environment: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["planned", "deploying", "released", "failed", "rolled_back"]).optional(),
  releasedAt: dateInput.nullable().optional(), notes: z.string().max(20000).optional(),
  repositoryId: z.string().nullable().optional(), commitSha: z.string().max(100).nullable().optional(),
  deploymentUrl: z.url().nullable().optional(), workItemIds: z.array(z.string()).optional(),
});

export function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw jsonError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
  return result.data;
}

export async function requireProductAccess(session: AuthSession, productId: string, write = false) {
  if (session.role === "client") throw jsonError("Forbidden", 403);
  const db = getPrisma();
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) throw jsonError("Product not found", 404);
  if (session.role === "admin") return { product, role: "owner" as const };
  const member = await db.productMember.findUnique({ where: { productId_userId: { productId, userId: session.uid } } });
  if (!member) throw jsonError("Product not found", 404);
  if (write && member.role === "viewer") throw jsonError("Forbidden", 403);
  return { product, role: member.role };
}

export async function requireStaffUser(userId: string) {
  const user = await getPrisma().userProfile.findUnique({ where: { uid: userId }, select: { uid: true, role: true } });
  if (!user || !["admin", "team"].includes(user.role)) throw jsonError("Staff user not found", 400);
}

export async function requireMilestone(productId: string, milestoneId: string | null | undefined) {
  if (!milestoneId) return;
  const milestone = await getPrisma().productMilestone.findFirst({ where: { id: milestoneId, productId }, select: { id: true } });
  if (!milestone) throw jsonError("Milestone not found", 400);
}

export async function requireRepository(repositoryId: string | null | undefined) {
  if (!repositoryId) return;
  const repository = await getPrisma().gitRepositoryConnection.findUnique({ where: { id: repositoryId }, select: { id: true } });
  if (!repository) throw jsonError("Repository not found", 400);
}

export async function uniqueSlug(name: string) {
  const db = getPrisma();
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product";
  let slug = base;
  while (await db.product.findUnique({ where: { slug }, select: { id: true } })) slug = `${base}-${randomUUID().slice(0, 8)}`;
  return slug;
}

export function id() { return randomUUID(); }

export async function recordProductActivity(productId: string, actorId: string, action: string, metadata: Prisma.InputJsonObject = {}) {
  try {
    await getPrisma().productActivity.create({ data: { id: id(), productId, actorId, action, metadata } });
  } catch (error) {
    // The primary mutation has already committed. Keep its response truthful;
    // the failed audit write is logged for operational investigation.
    console.error("Product activity write failed", { productId, actorId, action, error });
  }
}

export async function requireProductMember(productId: string, userId: string) {
  const member = await getPrisma().productMember.findUnique({ where: { productId_userId: { productId, userId } }, select: { id: true } });
  if (!member) throw jsonError("Assignee must be a product member", 400);
}

export async function notifyProductMembers(productId: string, actorId: string, title: string, body: string) {
  const members = await getPrisma().productMember.findMany({ where: { productId, userId: { not: actorId } }, select: { userId: true } });
  await Promise.all(members.map((m) => notifyUser({ userId: m.userId, kind: "system", title, body: body || title, href: `/products/${productId}` })));
}

export async function validateDependencies(productId: string, workItemId: string | null, dependencyIds: string[]) {
  const unique = [...new Set(dependencyIds)];
  if (unique.length !== dependencyIds.length) throw jsonError("Duplicate dependency", 400);
  if (workItemId && unique.includes(workItemId)) throw jsonError("An item cannot depend on itself", 400);
  if (!unique.length) return;
  const items = await getPrisma().productWorkItem.findMany({ where: { productId }, select: { id: true, dependencyIds: true } });
  const graph = new Map(items.map((item) => [item.id, item.dependencyIds]));
  if (unique.some((dep) => !graph.has(dep))) throw jsonError("Dependencies must belong to this product", 400);
  if (!workItemId) return;
  graph.set(workItemId, unique);
  const seen = new Set<string>();
  const path = new Set<string>();
  const visit = (node: string): boolean => {
    if (path.has(node)) return true;
    if (seen.has(node)) return false;
    seen.add(node); path.add(node);
    for (const dep of graph.get(node) || []) if (visit(dep)) return true;
    path.delete(node);
    return false;
  };
  if (visit(workItemId)) throw jsonError("Dependency cycle", 400);
}

export async function validateReleaseWork(productId: string, workItemIds: string[]) {
  const unique = [...new Set(workItemIds)];
  if (unique.length !== workItemIds.length) throw jsonError("Duplicate release work item", 400);
  if (!unique.length) return;
  const count = await getPrisma().productWorkItem.count({ where: { productId, id: { in: unique } } });
  if (count !== unique.length) throw jsonError("Release work items must belong to this product", 400);
}
