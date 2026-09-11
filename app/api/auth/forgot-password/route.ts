import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { appBaseUrl } from "@/lib/client-status";
import { isFirebaseAdminConfigured } from "@/lib/firebase-admin";
import { resetPasswordEmailHtml, sendEmail } from "@/lib/email";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleApi(async () => {
    if (isFirebaseAdminConfigured() && process.env.FORCE_LOCAL_AUTH !== "1") {
      throw jsonError(
        "Use Firebase Auth password reset when Firebase is configured",
        400
      );
    }

    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = (body.email || "").trim().toLowerCase();
    if (!email) throw jsonError("Email is required", 400);

    const store = await getStore();
    const user = await store.getUserByEmail(email);

    // Always succeed — do not reveal whether the email exists.
    if (user) {
      const token = randomUUID().replace(/-/g, "");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await store.upsertUser({
        ...user,
        inviteToken: token,
        inviteTokenExpiresAt: expiresAt,
        mustResetPassword: true,
      });

      const resetUrl = `${appBaseUrl(req)}/login?reset=${encodeURIComponent(token)}`;
      await sendEmail({
        to: user.email,
        subject: "Reset your Boatship password",
        html: resetPasswordEmailHtml({
          name: user.name,
          resetUrl,
        }),
      });
    }

    return { ok: true };
  });
}
