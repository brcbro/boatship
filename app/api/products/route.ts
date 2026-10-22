import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { createProductWithOwner } from "@/lib/product-persistence";
import {
  compareNullable, parseBody, productSchema, recordProductActivity, requireStaffUser, uniqueSlug,
  PRODUCTS, PRODUCT_MEMBERS, PRODUCT_MILESTONES, PRODUCT_RELEASES, PRODUCT_WORK_ITEMS, USER_PROFILE_NAMES,
} from "@/lib/products";
import type { ProductSummary } from "@/types/product";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const products = session.role === "admin"
      ? await PRODUCTS.find([])
      : await PRODUCTS.getMany((await PRODUCT_MEMBERS.find([{ field: "userId", op: "==", value: session.uid }])).map((m) => m.productId));
    products.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const productIds = products.map((p) => p.id);
    const byProduct = <T extends { productId: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) map.set(row.productId, [...(map.get(row.productId) || []), row]);
      return map;
    };
    const [milestones, releases, workItems, owners] = productIds.length ? await Promise.all([
      PRODUCT_MILESTONES.find([{ field: "productId", op: "in", value: productIds }]),
      PRODUCT_RELEASES.find([{ field: "productId", op: "in", value: productIds }, { field: "status", op: "==", value: "released" }]),
      PRODUCT_WORK_ITEMS.find([{ field: "productId", op: "in", value: productIds }]),
      USER_PROFILE_NAMES.getMany([...new Set(products.map((p) => p.ownerId))]),
    ]) : [[], [], [], []];
    const nextMilestones = byProduct(milestones.filter((m) => m.status !== "done" && m.status !== "cancelled" && m.targetDate !== null));
    const currentReleases = byProduct(releases);
    const openWork = byProduct(workItems.filter((w) => w.status !== "done" && w.status !== "cancelled"));
    const names = new Map(owners.map((u) => [u.uid, u.name]));
    const summaries: ProductSummary[] = products.map((p) => {
      const milestone = (nextMilestones.get(p.id) || []).sort((a, b) => compareNullable(a.targetDate, b.targetDate))[0];
      const release = (currentReleases.get(p.id) || []).sort((a, b) => compareNullable(b.releasedAt, a.releasedAt))[0];
      return {
        id: p.id, name: p.name, description: p.description, slug: p.slug, type: p.type as ProductSummary["type"], stage: p.stage as ProductSummary["stage"],
        ownerId: p.ownerId, ownerName: names.get(p.ownerId) || "Unknown", openWorkCount: (openWork.get(p.id) || []).length,
        nextMilestone: milestone ? { id: milestone.id, title: milestone.title, targetDate: milestone.targetDate } : null,
        currentRelease: release ? { id: release.id, version: release.version, status: release.status, releasedAt: release.releasedAt } : null,
      };
    });
    return { products: summaries };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const input = parseBody(productSchema, await req.json().catch(() => ({})));
    const ownerId = input.ownerId || session.uid;
    await requireStaffUser(ownerId);
    const product = await createProductWithOwner(input, ownerId, await uniqueSlug(input.name));
    await recordProductActivity(product.id, session.uid, "product.created", { name: product.name, type: product.type, ownerId });
    return { product };
  });
}
