import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { nowIso } from "@/lib/firestore";
import { transferProductOwner } from "@/lib/product-persistence";
import {
  compareNullable, definedFields, parseBody, productSchema, recordProductActivity, requireProductAccess, requireStaffUser, uniqueSlug, withWorkLinks,
  GIT_REPOSITORIES, PRODUCTS, PRODUCT_ACTIVITIES, PRODUCT_MEMBERS, PRODUCT_MILESTONES, PRODUCT_RELEASES, PRODUCT_WORK_ITEMS, USER_PROFILE_NAMES,
} from "@/lib/products";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const { product, role } = await requireProductAccess(session, id);
    const scope = [{ field: "productId", op: "==" as const, value: id }];
    const [members, milestones, workItems, releaseRows, activityRows] = await Promise.all([
      PRODUCT_MEMBERS.find(scope), PRODUCT_MILESTONES.find(scope), PRODUCT_WORK_ITEMS.find(scope), PRODUCT_RELEASES.find(scope), PRODUCT_ACTIVITIES.find(scope),
    ]);
    members.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    milestones.sort((a, b) => compareNullable(a.targetDate, b.targetDate) || a.createdAt.localeCompare(b.createdAt));
    workItems.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    releaseRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const activities = activityRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
    const repositories = new Map((await GIT_REPOSITORIES.getMany([...new Set(releaseRows.flatMap((r) => (r.repositoryId ? [r.repositoryId] : [])))]))
      .map((r) => [r.id, { id: r.id, provider: r.provider, name: r.name, owner: r.owner, repository: r.repository }]));
    const userIds = [...new Set([product.ownerId, ...members.map((m) => m.userId), ...activities.map((a) => a.actorId)])];
    const users = await USER_PROFILE_NAMES.getMany(userIds);
    const userMap = new Map(users.map((u) => [u.uid, { uid: u.uid, name: u.name, email: u.email }]));
    const releases = releaseRows.map((r) => ({ ...withWorkLinks(r), repository: (r.repositoryId && repositories.get(r.repositoryId)) || null }));
    return { product: { ...product, ownerName: userMap.get(product.ownerId)?.name || "Unknown" }, members: members.map((m) => ({ ...m, user: userMap.get(m.userId) || null })), milestones, workItems, releases, activities: activities.map((a) => ({ ...a, actorName: userMap.get(a.actorId)?.name || "Unknown" })), currentUserRole: role, canEdit: session.role === "admin" || role === "owner" || role === "editor" };
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
    const fields = { ...input, ...(input.name && input.name !== old.name ? { slug: await uniqueSlug(input.name) } : {}) };
    let product;
    if (input.ownerId && input.ownerId !== old.ownerId) product = await transferProductOwner(id, old.ownerId, input.ownerId, fields);
    else {
      const patch = { ...definedFields(fields), updatedAt: nowIso() };
      await PRODUCTS.update(id, patch);
      product = { ...old, ...patch };
    }
    await recordProductActivity(id, session.uid, "product.updated", { fields: Object.keys(input), ...(input.ownerId && input.ownerId !== old.ownerId ? { previousOwnerId: old.ownerId, ownerId: input.ownerId } : {}) });
    return { product, currentUserRole: role };
  });
}
