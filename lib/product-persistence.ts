import { randomUUID } from "crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api";
import type { z } from "zod";
import type { productSchema, releaseSchema } from "@/lib/products";

type ProductInput = z.infer<typeof productSchema>;
type ReleaseInput = z.infer<typeof releaseSchema>;

// Neon HTTP executes one statement per request. Data-changing CTEs keep the
// parent and its required children atomic without Prisma's transaction API.
export async function createProductWithOwner(input: ProductInput, ownerId: string, slug: string) {
  const db = getPrisma();
  const productId = randomUUID();
  const memberId = randomUUID();
  await db.$queryRaw`WITH product AS (
    INSERT INTO "Product" ("id", "name", "slug", "type", "description", "stage", "ownerId", "visibility", "websiteUrl", "createdAt", "updatedAt")
    VALUES (${productId}, ${input.name}, ${slug}, ${input.type}, ${input.description || ""}, ${input.stage || "idea"}, ${ownerId}, 'members', ${input.websiteUrl || null}, NOW(), NOW())
    RETURNING "id"
  ), member AS (
    INSERT INTO "ProductMember" ("id", "productId", "userId", "role", "createdAt")
    SELECT ${memberId}, "id", ${ownerId}, 'owner', NOW() FROM product RETURNING "id"
  ) SELECT product."id", member."id" AS "memberId" FROM product JOIN member ON true`;
  return db.product.findUniqueOrThrow({ where: { id: productId } });
}

export async function createReleaseWithWorkItems(productId: string, input: ReleaseInput) {
  const db = getPrisma();
  const releaseId = randomUUID();
  const releasedAt = input.releasedAt ? new Date(input.releasedAt) : input.status === "released" ? new Date() : null;
  await db.$queryRaw`WITH release AS (
    INSERT INTO "ProductRelease" ("id", "productId", "version", "environment", "status", "releasedAt", "notes", "repositoryId", "commitSha", "deploymentUrl", "createdAt", "updatedAt")
    VALUES (${releaseId}, ${productId}, ${input.version}, ${input.environment || "production"}, ${input.status || "planned"}, ${releasedAt}, ${input.notes || ""}, ${input.repositoryId || null}, ${input.commitSha || null}, ${input.deploymentUrl || null}, NOW(), NOW())
    RETURNING "id"
  ), links AS (
    INSERT INTO "ProductReleaseWorkItem" ("releaseId", "workItemId")
    SELECT release."id", item."id" FROM release CROSS JOIN LATERAL jsonb_array_elements_text(${JSON.stringify(input.workItemIds || [])}::jsonb) AS item("id")
    RETURNING "releaseId"
  ) SELECT release."id", (SELECT COUNT(*) FROM links) AS "linkCount" FROM release`;
  return db.productRelease.findUniqueOrThrow({ where: { id: releaseId }, include: { workLinks: { select: { workItemId: true } } } });
}

export async function updateReleaseWithWorkItems(id: string, fields: Omit<Partial<ReleaseInput>, "workItemIds" | "releasedAt"> & { releasedAt?: string | Date | null }, workItemIds: string[]) {
  const db = getPrisma();
  const columns = {
    version: "version", environment: "environment", status: "status", releasedAt: "releasedAt",
    notes: "notes", repositoryId: "repositoryId", commitSha: "commitSha", deploymentUrl: "deploymentUrl",
  } as const;
  const assignments = Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => Prisma.sql`${Prisma.raw(`"${columns[key as keyof typeof columns]}"`)} = ${key === "releasedAt" && typeof value === "string" ? new Date(value) : value}`);
  assignments.push(Prisma.sql`"updatedAt" = NOW()`);
  const updated = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`WITH updated AS (
    UPDATE "ProductRelease" SET ${Prisma.join(assignments)} WHERE "id" = ${id} RETURNING "id"
  ), removed AS (
    DELETE FROM "ProductReleaseWorkItem" WHERE "releaseId" IN (SELECT "id" FROM updated)
      AND "workItemId" NOT IN (SELECT value FROM jsonb_array_elements_text(${JSON.stringify(workItemIds)}::jsonb) AS item(value)) RETURNING "releaseId"
  ), inserted AS (
    INSERT INTO "ProductReleaseWorkItem" ("releaseId", "workItemId")
    SELECT updated."id", item."id" FROM updated CROSS JOIN LATERAL jsonb_array_elements_text(${JSON.stringify(workItemIds)}::jsonb) AS item("id")
    WHERE (SELECT COUNT(*) FROM removed) >= 0
    ON CONFLICT ("releaseId", "workItemId") DO NOTHING
    RETURNING "releaseId"
  ) SELECT updated."id", (SELECT COUNT(*) FROM inserted) AS "linkCount" FROM updated`);
  if (updated.length !== 1) throw jsonError("Release no longer exists", 409);
  return db.productRelease.findUniqueOrThrow({ where: { id }, include: { workLinks: { select: { workItemId: true } } } });
}

export async function transferProductOwner(id: string, previousOwnerId: string, nextOwnerId: string, fields: Partial<ProductInput> & { slug?: string }) {
  const db = getPrisma();
  const columns = { name: "name", slug: "slug", type: "type", description: "description", stage: "stage", ownerId: "ownerId", visibility: "visibility", websiteUrl: "websiteUrl" } as const;
  const assignments = Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => Prisma.sql`${Prisma.raw(`"${columns[key as keyof typeof columns]}"`)} = ${value}`);
  assignments.push(Prisma.sql`"updatedAt" = NOW()`);
  const updated = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`WITH updated AS (
    UPDATE "Product" SET ${Prisma.join(assignments)} WHERE "id" = ${id} AND "ownerId" = ${previousOwnerId} RETURNING "id"
  ), next_owner AS (
    INSERT INTO "ProductMember" ("id", "productId", "userId", "role", "createdAt")
    SELECT ${randomUUID()}, updated."id", ${nextOwnerId}, 'owner', NOW() FROM updated
    ON CONFLICT ("productId", "userId") DO UPDATE SET "role" = 'owner' RETURNING "id"
  ), old_owner AS (
    UPDATE "ProductMember" SET "role" = 'editor' WHERE "productId" IN (SELECT "id" FROM updated) AND "userId" = ${previousOwnerId} RETURNING "id"
  ) SELECT updated."id", (SELECT COUNT(*) FROM next_owner) AS "newCount", (SELECT COUNT(*) FROM old_owner) AS "oldCount" FROM updated`);
  if (updated.length !== 1) throw jsonError("Product owner changed; refresh and try again", 409);
  return db.product.findUniqueOrThrow({ where: { id } });
}

export async function removeProductMember(productId: string, memberId: string, userId: string) {
  const db = getPrisma();
  const rows = await db.$queryRaw<Array<{ id: string }>>`WITH removed AS (
    DELETE FROM "ProductMember" WHERE "id" = ${memberId} AND "productId" = ${productId} AND "userId" = ${userId}
      AND "userId" <> (SELECT "ownerId" FROM "Product" WHERE "id" = ${productId}) RETURNING "id"
  ), work AS (
    UPDATE "ProductWorkItem" SET "assigneeId" = NULL, "updatedAt" = NOW()
    WHERE "productId" = ${productId} AND "assigneeId" = ${userId} AND EXISTS (SELECT 1 FROM removed) RETURNING "id"
  ), milestones AS (
    UPDATE "ProductMilestone" SET "ownerId" = NULL, "updatedAt" = NOW()
    WHERE "productId" = ${productId} AND "ownerId" = ${userId} AND EXISTS (SELECT 1 FROM removed) RETURNING "id"
  ) SELECT removed."id", (SELECT COUNT(*) FROM work) AS "workCount", (SELECT COUNT(*) FROM milestones) AS "milestoneCount" FROM removed`;
  return rows.length === 1;
}
