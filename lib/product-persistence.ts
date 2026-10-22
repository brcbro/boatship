import { randomUUID } from "crypto";
import { getFirestore, nowIso } from "@/lib/firestore";
import { jsonError } from "@/lib/api";
import type { z } from "zod";
import {
  definedFields, productMemberId, toIso, withWorkLinks,
  PRODUCTS, PRODUCT_MEMBERS, PRODUCT_MILESTONES, PRODUCT_RELEASES, PRODUCT_WORK_ITEMS,
  type ProductDoc, type ProductMemberDoc, type ProductMilestoneDoc, type ProductReleaseDoc, type ProductWorkItemDoc,
  type productSchema, type releaseSchema,
} from "@/lib/products";

type ProductInput = z.infer<typeof productSchema>;
type ReleaseInput = z.infer<typeof releaseSchema>;

// Multi-document writes run in one Firestore transaction so the parent and
// its required children stay atomic (formerly data-changing CTEs on Neon).
export async function createProductWithOwner(input: ProductInput, ownerId: string, slug: string): Promise<ProductDoc> {
  const productId = randomUUID();
  const stamp = nowIso();
  const product: ProductDoc = {
    id: productId, name: input.name, slug, type: input.type, description: input.description || "", stage: input.stage || "idea",
    ownerId, visibility: "members", websiteUrl: input.websiteUrl || null, createdAt: stamp, updatedAt: stamp,
  };
  const member: ProductMemberDoc = { id: productMemberId(productId, ownerId), productId, userId: ownerId, role: "owner", createdAt: stamp };
  return getFirestore().runTransaction(async (tx) => {
    const taken = await tx.query<ProductDoc>(PRODUCTS.spec([{ field: "slug", op: "==", value: slug }], { limit: 1 }));
    if (taken.length) throw jsonError("Product slug already exists", 409);
    tx.write({ set: { collection: PRODUCTS.name, id: productId, data: product, precondition: { exists: false } } });
    tx.write({ set: { collection: PRODUCT_MEMBERS.name, id: member.id, data: member } });
    return product;
  });
}

export async function createReleaseWithWorkItems(productId: string, input: ReleaseInput) {
  const releaseId = randomUUID();
  const stamp = nowIso();
  const releasedAt = input.releasedAt ? toIso(input.releasedAt) : input.status === "released" ? stamp : null;
  const release: ProductReleaseDoc = {
    id: releaseId, productId, version: input.version, environment: input.environment || "production", status: input.status || "planned",
    releasedAt, notes: input.notes || "", repositoryId: input.repositoryId || null, commitSha: input.commitSha || null,
    deploymentUrl: input.deploymentUrl || null, workItemIds: [...new Set(input.workItemIds || [])], createdAt: stamp, updatedAt: stamp,
  };
  // The former join rows now live on the release document, so one write is atomic.
  await PRODUCT_RELEASES.create(releaseId, release);
  return withWorkLinks(release);
}

export async function updateReleaseWithWorkItems(id: string, fields: Omit<Partial<ReleaseInput>, "workItemIds" | "releasedAt"> & { releasedAt?: string | Date | null }, workItemIds: string[]) {
  const { releasedAt, ...rest } = fields;
  const patch: Partial<ProductReleaseDoc> = {
    ...definedFields(rest),
    ...(releasedAt !== undefined ? { releasedAt: toIso(releasedAt) } : {}),
    workItemIds: [...new Set(workItemIds)],
    updatedAt: nowIso(),
  };
  return getFirestore().runTransaction(async (tx) => {
    const current = await tx.get<ProductReleaseDoc>(PRODUCT_RELEASES.name, id);
    if (!current) throw jsonError("Release no longer exists", 409);
    tx.write({ update: { collection: PRODUCT_RELEASES.name, id, data: patch } });
    return withWorkLinks({ ...current.data, ...patch, id });
  });
}

export async function transferProductOwner(id: string, previousOwnerId: string, nextOwnerId: string, fields: Partial<ProductInput> & { slug?: string }): Promise<ProductDoc> {
  const stamp = nowIso();
  const patch: Partial<ProductDoc> = { ...definedFields(fields), updatedAt: stamp };
  return getFirestore().runTransaction(async (tx) => {
    const current = await tx.get<ProductDoc>(PRODUCTS.name, id);
    if (!current || current.data.ownerId !== previousOwnerId) throw jsonError("Product owner changed; refresh and try again", 409);
    const nextId = productMemberId(id, nextOwnerId);
    const previousId = productMemberId(id, previousOwnerId);
    const [next, previous] = await Promise.all([tx.get<ProductMemberDoc>(PRODUCT_MEMBERS.name, nextId), tx.get<ProductMemberDoc>(PRODUCT_MEMBERS.name, previousId)]);
    tx.write({ update: { collection: PRODUCTS.name, id, data: patch } });
    if (next) tx.write({ update: { collection: PRODUCT_MEMBERS.name, id: nextId, data: { role: "owner" } } });
    else tx.write({ set: { collection: PRODUCT_MEMBERS.name, id: nextId, data: { id: nextId, productId: id, userId: nextOwnerId, role: "owner", createdAt: stamp } satisfies ProductMemberDoc } });
    if (previous) tx.write({ update: { collection: PRODUCT_MEMBERS.name, id: previousId, data: { role: "editor" } } });
    return { ...current.data, ...patch, id };
  });
}

export async function removeProductMember(productId: string, memberId: string, userId: string) {
  return getFirestore().runTransaction(async (tx) => {
    const [member, product] = await Promise.all([tx.get<ProductMemberDoc>(PRODUCT_MEMBERS.name, memberId), tx.get<ProductDoc>(PRODUCTS.name, productId)]);
    if (!member || member.data.productId !== productId || member.data.userId !== userId) return false;
    if (!product || product.data.ownerId === userId) return false;
    const [work, milestones] = await Promise.all([
      tx.query<ProductWorkItemDoc>(PRODUCT_WORK_ITEMS.spec([{ field: "productId", op: "==", value: productId }, { field: "assigneeId", op: "==", value: userId }])),
      tx.query<ProductMilestoneDoc>(PRODUCT_MILESTONES.spec([{ field: "productId", op: "==", value: productId }, { field: "ownerId", op: "==", value: userId }])),
    ]);
    const stamp = nowIso();
    tx.write({ delete: { collection: PRODUCT_MEMBERS.name, id: memberId, precondition: { exists: true } } });
    for (const item of work) tx.write({ update: { collection: PRODUCT_WORK_ITEMS.name, id: item.id, data: { assigneeId: null, updatedAt: stamp } } });
    for (const milestone of milestones) tx.write({ update: { collection: PRODUCT_MILESTONES.name, id: milestone.id, data: { ownerId: null, updatedAt: stamp } } });
    return true;
  });
}
