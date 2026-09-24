import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notifications";
import { id, memberSchema, milestoneSchema, notifyProductMembers, parseBody, recordProductActivity, releaseSchema, requireMilestone, requireProductAccess, requireProductMember, requireRepository, requireStaffUser, validateDependencies, validateReleaseWork, workItemSchema } from "@/lib/products";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string; resource: string }> };

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id: productId, resource } = await params;
    const { product } = await requireProductAccess(session, productId, true);
    const body: unknown = await req.json().catch(() => ({}));
    const db = getPrisma();
    if (resource === "members") {
      if (session.role !== "admin") throw jsonError("Only admins can manage members", 403);
      const input = parseBody(memberSchema, body);
      await requireStaffUser(input.userId);
      if (input.role === "owner" && input.userId !== product.ownerId) throw jsonError("Change the product owner in Settings", 400);
      if (input.userId === product.ownerId && input.role !== "owner") throw jsonError("Change the product owner in Settings", 400);
      const previous = await db.productMember.findUnique({ where: { productId_userId: { productId, userId: input.userId } }, select: { id: true } });
      const member = await db.productMember.upsert({ where: { productId_userId: { productId, userId: input.userId } }, create: { id: id(), productId, ...input }, update: { role: input.role } });
      await recordProductActivity(productId, session.uid, previous ? "member.updated" : "member.added", { userId: input.userId, role: input.role });
      if (input.userId !== session.uid) await notifyUser({ userId: input.userId, kind: "task_assigned", title: `Added to ${product.name}`, body: `You are a ${input.role} on this product.`, href: `/products/${productId}` });
      return { member };
    }
    if (resource === "milestones") {
      const input = parseBody(milestoneSchema, body);
      if (input.ownerId) { await requireStaffUser(input.ownerId); await requireProductMember(productId, input.ownerId); }
      const milestone = await db.productMilestone.create({ data: { id: id(), productId, title: input.title, description: input.description || "", targetDate: input.targetDate ? new Date(input.targetDate) : null, status: input.status || "planned", ownerId: input.ownerId || null } });
      await recordProductActivity(productId, session.uid, "milestone.created", { milestoneId: milestone.id, title: milestone.title, status: milestone.status });
      return { milestone };
    }
    if (resource === "work-items") {
      const input = parseBody(workItemSchema, body);
      await requireMilestone(productId, input.milestoneId);
      await validateDependencies(productId, null, input.dependencyIds || []);
      if (input.assigneeId) { await requireStaffUser(input.assigneeId); await requireProductMember(productId, input.assigneeId); }
      const workItem = await db.productWorkItem.create({ data: { id: id(), productId, title: input.title, description: input.description || "", milestoneId: input.milestoneId || null, status: input.status || "todo", priority: input.priority || "medium", assigneeId: input.assigneeId || null, dueDate: input.dueDate ? new Date(input.dueDate) : null, dependencyIds: input.dependencyIds || [] } });
      await recordProductActivity(productId, session.uid, "work_item.created", { workItemId: workItem.id, title: workItem.title, status: workItem.status, assigneeId: workItem.assigneeId });
      if (input.assigneeId && input.assigneeId !== session.uid) await notifyUser({ userId: input.assigneeId, kind: "task_assigned", title: `Product work assigned: ${input.title}`, body: product.name, href: `/products/${productId}` });
      return { workItem };
    }
    if (resource === "releases") {
      const input = parseBody(releaseSchema, body);
      await requireRepository(input.repositoryId);
      await validateReleaseWork(productId, input.workItemIds || []);
      const release = await db.productRelease.create({ data: { id: id(), productId, version: input.version, environment: input.environment || "production", status: input.status || "planned", releasedAt: input.releasedAt ? new Date(input.releasedAt) : input.status === "released" ? new Date() : null, notes: input.notes || "", repositoryId: input.repositoryId || null, commitSha: input.commitSha || null, deploymentUrl: input.deploymentUrl || null,
        workLinks: { create: (input.workItemIds || []).map((workItemId) => ({ workItemId })) } }, include: { workLinks: { select: { workItemId: true } } } });
      await recordProductActivity(productId, session.uid, "release.created", { releaseId: release.id, version: release.version, status: release.status });
      if (release.status === "released") await notifyProductMembers(productId, session.uid, `Released ${product.name} ${release.version}`, release.notes);
      return { release: { ...release, workItemIds: release.workLinks.map((link) => link.workItemId) } };
    }
    throw jsonError("Not found", 404);
  });
}
