import { timingSafeEqual } from "node:crypto";
import { migrateDocumentContentToObjects } from "@/lib/document-content";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Operator-run backfill: moves row-stored document bytes into R2 in small batches. */
export async function POST(req: Request) {
  const secret = process.env.BOATSHIP_CRON_SECRET;
  const expected = Buffer.from(secret || "");
  const supplied = Buffer.from(req.headers.get("x-boatship-cron-secret") || "");
  if (!secret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return new Response("Unauthorized", { status: 401 });
  const limit = Number(new URL(req.url).searchParams.get("limit") || 5);
  try { return Response.json(await migrateDocumentContentToObjects(Number.isFinite(limit) ? limit : 5)); }
  catch (error) {
    console.error("[documents] object migration batch failed", error instanceof Error ? error.message : error);
    return new Response("Document content migration failed", { status: 500 });
  }
}
