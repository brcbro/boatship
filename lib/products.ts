import { randomUUID } from "crypto";
import { z } from "zod";
import { Collection, nowIso, type FsData } from "@/lib/firestore";
import { jsonError } from "@/lib/api";
import { notifyUser } from "@/lib/notifications";
import type { AuthSession } from "@/types";

/** Firestore documents for the product area; timestamps are ISO-8601 strings. */
export type ProductDoc = {
  id: string; name: string; slug: string; type: string; description: string; stage: string; ownerId: string;
  visibility: string; websiteUrl: string | null; createdAt: string; updatedAt: string;
};
/** Keyed by `${productId}__${userId}`; the `id` field holds the same composite. */
export type ProductMemberDoc = { id: string; productId: string; userId: string; role: string; createdAt: string };
export type ProductMilestoneDoc = {
  id: string; productId: string; title: string; description: string; targetDate: string | null; status: string;
  ownerId: string | null; createdAt: string; updatedAt: string;
};
export type ProductWorkItemDoc = {
  id: string; productId: string; milestoneId: string | null; title: string; description: string; status: string;
  priority: string; assigneeId: string | null; dueDate: string | null; dependencyIds: string[]; createdAt: string; updatedAt: string;
};
/** `workItemIds` replaces the former ProductReleaseWorkItem join table. */
export type ProductReleaseDoc = {
  id: string; productId: string; version: string; environment: string; status: string; releasedAt: string | null; notes: string;
  repositoryId: string | null; commitSha: string | null; deploymentUrl: string | null; workItemIds: string[]; createdAt: string; updatedAt: string;
};
export type ProductActivityDoc = { id: string; productId: string; actorId: string; action: string; metadata: FsData; createdAt: string };
export type UserProfileNameDoc = { uid: string; name: string; email: string; role: string };
export type GitRepositoryDoc = {
  id: string; provider: string; name: string; owner: string; repository: string; defaultBranch: string; active: boolean;
  createdBy: string; createdAt: string; updatedAt: string;
};

export const PRODUCTS = new Collection<ProductDoc>("Product");
export const PRODUCT_MEMBERS = new Collection<ProductMemberDoc>("ProductMember");
export const PRODUCT_MILESTONES = new Collection<ProductMilestoneDoc>("ProductMilestone");
export const PRODUCT_WORK_ITEMS = new Collection<ProductWorkItemDoc>("ProductWorkItem");
export const PRODUCT_RELEASES = new Collection<ProductReleaseDoc>("ProductRelease");
export const PRODUCT_ACTIVITIES = new Collection<ProductActivityDoc>("ProductActivity");
export const USER_PROFILE_NAMES = new Collection<UserProfileNameDoc>("UserProfile");
export const GIT_REPOSITORIES = new Collection<GitRepositoryDoc>("GitRepositoryConnection");

export const productMemberId = (productId: string, userId: string) => `${productId}__${userId}`;

/** Drops undefined entries so a partial update never masks out existing fields. */
export function definedFields<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

export const toIso = (value: string | Date | null | undefined): string | null => (value ? new Date(value).toISOString() : null);

/** Mirrors Postgres ASC ordering: nulls sort last. */
export function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

/** Release rows keep the former `workLinks` include shape for callers. */
export const withWorkLinks = <T extends { workItemIds: string[] }>(release: T) => ({ ...release, workLinks: release.workItemIds.map((workItemId) => ({ workItemId })) });

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
  const product = await PRODUCTS.get(productId);
  if (!product) throw jsonError("Product not found", 404);
  if (session.role === "admin") return { product, role: "owner" as const };
  const member = await PRODUCT_MEMBERS.get(productMemberId(productId, session.uid));
  if (!member) throw jsonError("Product not found", 404);
  if (write && member.role === "viewer") throw jsonError("Forbidden", 403);
  return { product, role: member.role as "owner" | "editor" | "viewer" };
}

export async function requireStaffUser(userId: string) {
  const user = await USER_PROFILE_NAMES.get(userId);
  if (!user || !["admin", "team"].includes(user.role)) throw jsonError("Staff user not found", 400);
}

export async function requireMilestone(productId: string, milestoneId: string | null | undefined) {
  if (!milestoneId) return;
  const milestone = await PRODUCT_MILESTONES.get(milestoneId);
  if (!milestone || milestone.productId !== productId) throw jsonError("Milestone not found", 400);
}

export async function requireRepository(repositoryId: string | null | undefined) {
  if (!repositoryId) return;
  const repository = await GIT_REPOSITORIES.get(repositoryId);
  if (!repository) throw jsonError("Repository not found", 400);
}

export async function uniqueSlug(name: string) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product";
  let slug = base;
  while (await PRODUCTS.findFirst([{ field: "slug", op: "==", value: slug }])) slug = `${base}-${randomUUID().slice(0, 8)}`;
  return slug;
}

export function id() { return randomUUID(); }

export async function recordProductActivity(productId: string, actorId: string, action: string, metadata: FsData = {}) {
  try {
    const activityId = id();
    await PRODUCT_ACTIVITIES.create(activityId, { id: activityId, productId, actorId, action, metadata: definedFields(metadata), createdAt: nowIso() });
  } catch (error) {
    // The primary mutation has already committed. Keep its response truthful;
    // the failed audit write is logged for operational investigation.
    console.error("Product activity write failed", { productId, actorId, action, error });
  }
}

export async function requireProductMember(productId: string, userId: string) {
  const member = await PRODUCT_MEMBERS.get(productMemberId(productId, userId));
  if (!member) throw jsonError("Assignee must be a product member", 400);
}

export async function notifyProductMembers(productId: string, actorId: string, title: string, body: string) {
  const members = (await PRODUCT_MEMBERS.find([{ field: "productId", op: "==", value: productId }])).filter((m) => m.userId !== actorId);
  await Promise.all(members.map((m) => notifyUser({ userId: m.userId, kind: "system", title, body: body || title, href: `/products/${productId}` })));
}

export async function createProductMilestone(productId: string, input: z.infer<typeof milestoneSchema>): Promise<ProductMilestoneDoc> {
  const stamp = nowIso();
  const milestone: ProductMilestoneDoc = {
    id: id(), productId, title: input.title, description: input.description || "", targetDate: toIso(input.targetDate),
    status: input.status || "planned", ownerId: input.ownerId || null, createdAt: stamp, updatedAt: stamp,
  };
  await PRODUCT_MILESTONES.create(milestone.id, milestone);
  return milestone;
}

export async function createProductWorkItem(productId: string, input: z.infer<typeof workItemSchema>): Promise<ProductWorkItemDoc> {
  const stamp = nowIso();
  const workItem: ProductWorkItemDoc = {
    id: id(), productId, title: input.title, description: input.description || "", milestoneId: input.milestoneId || null,
    status: input.status || "todo", priority: input.priority || "medium", assigneeId: input.assigneeId || null, dueDate: toIso(input.dueDate),
    dependencyIds: input.dependencyIds || [], createdAt: stamp, updatedAt: stamp,
  };
  await PRODUCT_WORK_ITEMS.create(workItem.id, workItem);
  return workItem;
}

export async function validateDependencies(productId: string, workItemId: string | null, dependencyIds: string[]) {
  const unique = [...new Set(dependencyIds)];
  if (unique.length !== dependencyIds.length) throw jsonError("Duplicate dependency", 400);
  if (workItemId && unique.includes(workItemId)) throw jsonError("An item cannot depend on itself", 400);
  if (!unique.length) return;
  const items = await PRODUCT_WORK_ITEMS.find([{ field: "productId", op: "==", value: productId }]);
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
  const items = await PRODUCT_WORK_ITEMS.getMany(unique);
  if (items.filter((item) => item.productId === productId).length !== unique.length) throw jsonError("Release work items must belong to this product", 400);
}
