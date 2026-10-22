import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { nowIso } from "@/lib/firestore";
import { removeProductMember, updateReleaseWithWorkItems } from "@/lib/product-persistence";
import { notifyUser } from "@/lib/notifications";
import {
  definedFields, memberSchema, milestoneSchema, notifyProductMembers, parseBody, recordProductActivity, releaseSchema, requireMilestone, requireProductAccess,
  requireProductMember, requireRepository, requireStaffUser, toIso, validateDependencies, validateReleaseWork, withWorkLinks, workItemSchema,
  PRODUCT_MEMBERS, PRODUCT_MILESTONES, PRODUCT_RELEASES, PRODUCT_WORK_ITEMS,
} from "@/lib/products";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string; resource: string; itemId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id: productId, resource, itemId } = await params;
    const { product } = await requireProductAccess(session, productId, true);
    const body: unknown = await req.json().catch(() => ({}));
    if (resource === "members") {
      if (session.role !== "admin") throw jsonError("Only admins can manage members", 403);
      const input = parseBody(memberSchema.pick({ role: true }), body);
      const existing = await PRODUCT_MEMBERS.get(itemId);
      if (!existing || existing.productId !== productId) throw jsonError("Member not found", 404);
      if (existing.userId === product.ownerId && input.role !== "owner") throw jsonError("Change the product owner in Settings", 400);
      if (existing.userId !== product.ownerId && input.role === "owner") throw jsonError("Change the product owner in Settings", 400);
      await PRODUCT_MEMBERS.update(itemId, { role: input.role });
      const member = { ...existing, role: input.role };
      await recordProductActivity(productId, session.uid, "member.updated", { userId: member.userId, role: member.role });
      return { member };
    }
    if (resource === "milestones") {
      const existing = await PRODUCT_MILESTONES.get(itemId);
      if (!existing || existing.productId !== productId) throw jsonError("Milestone not found", 404);
      const input = parseBody(milestoneSchema.partial(), body);
      if (input.ownerId) { await requireStaffUser(input.ownerId); await requireProductMember(productId, input.ownerId); }
      const patch = { ...definedFields(input), ...(input.targetDate !== undefined ? { targetDate: toIso(input.targetDate) } : {}), updatedAt: nowIso() };
      await PRODUCT_MILESTONES.update(itemId, patch);
      const milestone = { ...existing, ...patch };
      await recordProductActivity(productId, session.uid, "milestone.updated", { milestoneId: milestone.id, title: milestone.title, status: milestone.status, fields: Object.keys(input) });
      return { milestone };
    }
    if (resource === "work-items") {
      const existing = await PRODUCT_WORK_ITEMS.get(itemId);
      if (!existing || existing.productId !== productId) throw jsonError("Work item not found", 404);
      const input = parseBody(workItemSchema.partial(), body);
      if (input.milestoneId) await requireMilestone(productId, input.milestoneId);
      if (input.assigneeId) { await requireStaffUser(input.assigneeId); await requireProductMember(productId, input.assigneeId); }
      if (input.dependencyIds) await validateDependencies(productId, itemId, input.dependencyIds);
      const patch = { ...definedFields(input), ...(input.dueDate !== undefined ? { dueDate: toIso(input.dueDate) } : {}), updatedAt: nowIso() };
      await PRODUCT_WORK_ITEMS.update(itemId, patch);
      const workItem = { ...existing, ...patch };
      await recordProductActivity(productId, session.uid, "work_item.updated", { workItemId: workItem.id, title: workItem.title, status: workItem.status, fields: Object.keys(input) });
      if (input.assigneeId && input.assigneeId !== existing.assigneeId && input.assigneeId !== session.uid) await notifyUser({ userId: input.assigneeId, kind: "task_assigned", title: `Product work assigned: ${workItem.title}`, body: product.name, href: `/products/${productId}` });
      return { workItem };
    }
    if (resource === "releases") {
      const existing = await PRODUCT_RELEASES.get(itemId);
      if (!existing || existing.productId !== productId) throw jsonError("Release not found", 404);
      const input = parseBody(releaseSchema.partial(), body);
      await requireRepository(input.repositoryId);
      if (input.workItemIds) await validateReleaseWork(productId, input.workItemIds);
      const { workItemIds, ...fields } = input;
      const data = { ...fields, ...(input.releasedAt !== undefined ? { releasedAt: input.releasedAt ? new Date(input.releasedAt) : null } : input.status === "released" && existing.status !== "released" ? { releasedAt: new Date() } : {}) };
      let release;
      if (workItemIds) release = await updateReleaseWithWorkItems(itemId, data, workItemIds);
      else {
        const { releasedAt, ...rest } = data;
        const patch = { ...definedFields(rest), ...(releasedAt !== undefined ? { releasedAt: toIso(releasedAt) } : {}), updatedAt: nowIso() };
        await PRODUCT_RELEASES.update(itemId, patch);
        release = withWorkLinks({ ...existing, ...patch });
      }
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
    const member = await PRODUCT_MEMBERS.get(itemId);
    if (!member || member.productId !== productId) throw jsonError("Member not found", 404);
    if (member.userId === product.ownerId) throw jsonError("Change the product owner before removing this member", 400);
    if (!await removeProductMember(productId, itemId, member.userId)) throw jsonError("Member not found or is now the product owner", 409);
    await recordProductActivity(productId, session.uid, "member.removed", { userId: member.userId });
    return { deleted: true };
  });
}
