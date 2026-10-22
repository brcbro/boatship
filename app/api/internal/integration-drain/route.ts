import { timingSafeEqual } from "node:crypto";
import { drainIntegrationJobs } from "@/lib/integration-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.BOATSHIP_CRON_SECRET;
  const expected = Buffer.from(secret || "");
  const supplied = Buffer.from(req.headers.get("x-boatship-cron-secret") || "");
  if (!secret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return new Response("Unauthorized", { status: 401 });
  try { return Response.json(await drainIntegrationJobs()); }
  catch {
    console.error("[integrations] durable queue drain failed");
    return new Response("Integration drain failed", { status: 500 });
  }
}
