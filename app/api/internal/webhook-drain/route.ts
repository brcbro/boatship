import { timingSafeEqual } from "node:crypto";
import { drainWebhooks } from "@/lib/webhooks";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.BOATSHIP_CRON_SECRET;
  const supplied = req.headers.get("x-boatship-cron-secret") || "";
  const expected = Buffer.from(secret || "");
  const actual = Buffer.from(supplied);
  if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return Response.json(await drainWebhooks());
  } catch (error) {
    console.error("[webhooks] drain failed", error);
    return new Response("Webhook drain failed", { status: 500 });
  }
}
