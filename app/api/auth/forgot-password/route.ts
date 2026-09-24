import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { appBaseUrl } from "@/lib/client-status";
import { resetPasswordEmailHtml, sendEmail } from "@/lib/email";
import { getStore } from "@/lib/store";
import { consumeAccountAndIpLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    if (!process.env.RESEND_API_KEY) throw jsonError("Email delivery is not configured", 503);
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = (body.email || "").trim().toLowerCase();
    if (!email) throw jsonError("Email is required", 400);
    if (!(await consumeAccountAndIpLimit({ scope: "forgot-password", account: email, req, accountMax: 3, ipMax: 20, windowSeconds: 3600 }))) {
      // Keep account existence private, including when the account bucket is exhausted.
      return { ok: true };
    }

    const store = await getStore();
    const user = await store.getUserByEmail(email);

    // Always succeed — do not reveal whether the email exists.
    if (user) {
      const token = randomUUID().replace(/-/g, "");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const resetUrl = `${appBaseUrl(req)}/login?reset=${encodeURIComponent(token)}`;
      await sendEmail({
        to: user.email,
        subject: "Reset your Boatship password",
        html: resetPasswordEmailHtml({
          name: user.name,
          resetUrl,
        }),
      });
      await store.upsertUser({
        ...user,
        inviteToken: token,
        inviteTokenExpiresAt: expiresAt,
      });
    }

    return { ok: true };
  });
}
