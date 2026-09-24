import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { id, parseBody, productSchema, recordProductActivity, requireStaffUser, uniqueSlug } from "@/lib/products";
import type { ProductSummary } from "@/types/product";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const db = getPrisma();
    const products = await db.product.findMany({
      where: session.role === "admin" ? {} : { members: { some: { userId: session.uid } } },
      include: {
        milestones: { where: { status: { notIn: ["done", "cancelled"] }, targetDate: { not: null } }, orderBy: { targetDate: "asc" }, take: 1 },
        releases: { where: { status: "released" }, orderBy: { releasedAt: "desc" }, take: 1 },
        _count: { select: { workItems: { where: { status: { notIn: ["done", "cancelled"] } } } } },
      },
      orderBy: { updatedAt: "desc" },
    });
    const owners = await db.userProfile.findMany({ where: { uid: { in: products.map((p) => p.ownerId) } }, select: { uid: true, name: true } });
    const names = new Map(owners.map((u) => [u.uid, u.name]));
    const summaries: ProductSummary[] = products.map((p) => ({
      id: p.id, name: p.name, description: p.description, slug: p.slug, type: p.type as ProductSummary["type"], stage: p.stage as ProductSummary["stage"],
      ownerId: p.ownerId, ownerName: names.get(p.ownerId) || "Unknown", openWorkCount: p._count.workItems,
      nextMilestone: p.milestones[0] ? { id: p.milestones[0].id, title: p.milestones[0].title, targetDate: p.milestones[0].targetDate?.toISOString() || null } : null,
      currentRelease: p.releases[0] ? { id: p.releases[0].id, version: p.releases[0].version, status: p.releases[0].status, releasedAt: p.releases[0].releasedAt?.toISOString() || null } : null,
    }));
    return { products: summaries };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const input = parseBody(productSchema, await req.json().catch(() => ({})));
    const ownerId = input.ownerId || session.uid;
    await requireStaffUser(ownerId);
    const db = getPrisma();
    const product = await db.product.create({
      data: { id: id(), name: input.name, slug: await uniqueSlug(input.name), type: input.type, description: input.description || "", stage: input.stage || "idea", ownerId, visibility: "members", websiteUrl: input.websiteUrl || null,
        members: { create: { id: id(), userId: ownerId, role: "owner" } } },
    });
    await recordProductActivity(product.id, session.uid, "product.created", { name: product.name, type: product.type, ownerId });
    return { product };
  });
}
