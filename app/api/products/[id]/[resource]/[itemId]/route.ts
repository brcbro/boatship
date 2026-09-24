import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notifications";
import { memberSchema, milestoneSchema, notifyProductMembers, parseBody, recordProductActivity, releaseSchema, requireMilestone, requireProductAccess, requireProductMember, requireRepository, requireStaffUser, validateDependencies, validateReleaseWork, workItemSchema } from "@/lib/products";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string; resource: string; itemId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id: productId, resource, itemId } = await params;
    const { product } = await requireProductAccess(session, productId, true);
    const body: unknown = await req.json().catch(() => ({}));
    const db = getPrisma();
    if (resource === "members") {
      if (session.role !== "admin") throw jsonError("Only admins can manage members", 403);
      const input = parseBody(memberSchema.pick({ role: true }), body);
      const existing = await db.productMember.findFirst({ where: { id: itemId, productId } });
      if (!existing) throw jsonError("Member not found", 404);
      if (existing.userId === product.ownerId && input.role !== "owner") throw jsonError("Change the product owner in Settings", 400);
      if (existing.userId !== product.ownerId && input.role === "owner") throw jsonError("Change the product owner in Settings", 400);
      const member = await db.productMember.update({ where: { id: itemId }, data: input });
      await recordProductActivity(productId, session.uid, "member.updated", { userId: member.userId, role: member.role });
      return { member };
    }
    if (resource === "milestones") {
      const existing = await db.productMilestone.findFirst({ where: { id: itemId, productId }, select: { id: true } });
      if (!existing) throw jsonError("Milestone not found", 404);
      const input = parseBody(milestoneSchema.partial(), body);
      if (input.ownerId) { await requireStaffUser(input.ownerId); await requireProductMember(productId, input.ownerId); }
      const milestone = await db.productMilestone.update({ where: { id: itemId }, data: { ...input, ...(input.targetDate !== undefined ? { targetDate: input.targetDate ? new Date(input.targetDate) : null } : {}) } });
      await recordProductActivity(productId, session.uid, "milestone.updated", { milestoneId: milestone.id, title: milestone.title, status: milestone.status, fields: Object.keys(input) });
      return { milestone };
    }
    if (resource === "work-items") {
      const existing = await db.productWorkItem.findFirst({ where: { id: itemId, productId } });
      if (!existing) throw jsonError("Work item not found", 404);
      const input = parseBody(workItemSchema.partial(), body);
      if (input.milestoneId) await requireMilestone(productId, input.milestoneId);
      if (input.assigneeId) { await requireStaffUser(input.assigneeId); await requireProductMember(productId, input.assigneeId); }
      if (input.dependencyIds) await validateDependencies(productId, itemId, input.dependencyIds);
      const workItem = await db.productWorkItem.update({ where: { id: itemId }, data: { ...input, ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}) } });
      await recordProductActivity(productId, session.uid, "work_item.updated", { workItemId: workItem.id, title: workItem.title, status: workItem.status, fields: Object.keys(input) });
      if (input.assigneeId && input.assigneeId !== existing.assigneeId && input.assigneeId !== session.uid) await notifyUser({ userId: input.assigneeId, kind: "task_assigned", title: `Product work assigned: ${workItem.title}`, body: product.name, href: `/products/${productId}` });
      return { workItem };
    }
    if (resource === "releases") {
      const existing = await db.productRelease.findFirst({ where: { id: itemId, productId } });
      if (!existing) throw jsonError("Release not found", 404);
      const input = parseBody(releaseSchema.partial(), body);
      await requireRepository(input.repositoryId);
      if (input.workItemIds) await validateReleaseWork(productId, input.workItemIds);
      const { workItemIds, ...fields } = input;
      const release = await db.productRelease.update({ where: { id: itemId }, data: { ...fields, ...(input.releasedAt !== undefined ? { releasedAt: input.releasedAt ? new Date(input.releasedAt) : null } : input.status === "released" && existing.status !== "released" ? { releasedAt: new Date() } : {}), ...(workItemIds ? { workLinks: { deleteMany: {}, create: workItemIds.map((workItemId) => ({ workItemId })) } } : {}) }, include: { workLinks: { select: { workItemId: true } } } });
      await recordProductActivity(productId, session.uid, "release.updated", { releaseId: release.id, version: release.version, status: release.status, fields: Object.keys(input) });
      if (release.status === "released" && existing.status !== "released") await notifyProductMembers(productId, session.uid, `Released ${product.name} ${release.version}`, release.notes);
      return { release: { ...release, workItemIds: release.workLinks.map((link) => link.workItemId) } };
    }
    throw jsonError("Not found", 404);
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const { id: productId, resource, itemId } = await params;
    if (resource !== "members") throw jsonError("Not found", 404);
    const { product } = await requireProductAccess(session, productId, true);
    const db = getPrisma();
    const member = await db.productMember.findFirst({ where: { id: itemId, productId } });
    if (!member) throw jsonError("Member not found", 404);
    if (member.userId === product.ownerId) throw jsonError("Change the product owner before removing this member", 400);
    await db.$transaction([
      db.productWorkItem.updateMany({ where: { productId, assigneeId: member.userId }, data: { assigneeId: null } }),
      db.productMilestone.updateMany({ where: { productId, ownerId: member.userId }, data: { ownerId: null } }),
      db.productMember.delete({ where: { id: itemId } }),
    ]);
    await recordProductActivity(productId, session.uid, "member.removed", { userId: member.userId });
    return { deleted: true };
  });
}
