import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { transferProductOwner } from "@/lib/product-persistence";
import { parseBody, productSchema, recordProductActivity, requireProductAccess, requireStaffUser, uniqueSlug } from "@/lib/products";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const { role } = await requireProductAccess(session, id);
    const db = getPrisma();
    const product = await db.product.findUnique({ where: { id } });
    const [members, milestones, workItems, releases, activities] = await Promise.all([
      db.productMember.findMany({ where: { productId: id }, orderBy: { createdAt: "asc" } }),
      db.productMilestone.findMany({ where: { productId: id }, orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }] }),
      db.productWorkItem.findMany({ where: { productId: id }, orderBy: { createdAt: "desc" } }),
      db.productRelease.findMany({ where: { productId: id }, orderBy: { createdAt: "desc" }, include: { repository: { select: { id: true, provider: true, name: true, owner: true, repository: true } }, workLinks: { select: { workItemId: true } } } }),
      db.productActivity.findMany({ where: { productId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    const userIds = [...new Set([product!.ownerId, ...members.map((m) => m.userId), ...activities.map((a) => a.actorId)])];
    const users = await db.userProfile.findMany({ where: { uid: { in: userIds } }, select: { uid: true, name: true, email: true } });
    const userMap = new Map(users.map((u) => [u.uid, u]));
    return { product: { ...product, ownerName: userMap.get(product!.ownerId)?.name || "Unknown" }, members: members.map((m) => ({ ...m, user: userMap.get(m.userId) || null })), milestones, workItems, releases: releases.map((r) => ({ ...r, workItemIds: r.workLinks.map((link) => link.workItemId) })), activities: activities.map((a) => ({ ...a, actorName: userMap.get(a.actorId)?.name || "Unknown" })), currentUserRole: role, canEdit: session.role === "admin" || role === "owner" || role === "editor" };
  });
}

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const { id } = await params;
    const { product: old, role } = await requireProductAccess(session, id, true);
    const input = parseBody(productSchema.partial().refine((v) => Object.keys(v).length > 0), await req.json().catch(() => ({})));
    if (input.ownerId && input.ownerId !== old.ownerId && session.role !== "admin") throw jsonError("Only admins can change the owner", 403);
    if (input.ownerId) await requireStaffUser(input.ownerId);
    const db = getPrisma();
    const fields = { ...input, ...(input.name && input.name !== old.name ? { slug: await uniqueSlug(input.name) } : {}) };
    const product = input.ownerId && input.ownerId !== old.ownerId
      ? await transferProductOwner(id, old.ownerId, input.ownerId, fields)
      : await db.product.update({ where: { id }, data: fields });
    await recordProductActivity(id, session.uid, "product.updated", { fields: Object.keys(input), ...(input.ownerId && input.ownerId !== old.ownerId ? { previousOwnerId: old.ownerId, ownerId: input.ownerId } : {}) });
    return { product, currentUserRole: role };
  });
}
