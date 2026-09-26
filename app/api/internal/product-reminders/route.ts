import { timingSafeEqual } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { scanProductReminders } from "@/lib/product-reminders";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    const secret = process.env.BOATSHIP_CRON_SECRET;
    const provided = req.headers.get("x-boatship-cron-secret") || "";
    if (!secret || !provided || Buffer.byteLength(secret) !== Buffer.byteLength(provided) || !timingSafeEqual(Buffer.from(secret), Buffer.from(provided))) throw jsonError("Unauthorized", 401);
    return scanProductReminders();
  });
}
