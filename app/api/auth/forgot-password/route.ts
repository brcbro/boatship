import { handleApi, jsonError } from "@/lib/api";
import { deliverMailIntent, issuePasswordReset } from "@/lib/accounts";
import { appBaseUrl } from "@/lib/client-status";
import { emailDeliveryConfigured, resetPasswordEmailHtml } from "@/lib/email";
import { getStore } from "@/lib/store";
import { consumeAccountAndIpLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Starts password recovery. The response is the same whether or not the
 * address exists. A hashed, single-use reset action and a mail intent are
 * committed first; the email is sent afterwards and its outcome recorded.
 * Suspended and deactivated accounts receive nothing: a reset never
 * reactivates them.
 */
export async function POST(req: Request) {
  return handleApi(async () => {
    if (!emailDeliveryConfigured()) throw jsonError("Email delivery is not configured", 503);
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
      const issued = await issuePasswordReset({ user });
      if (issued) {
        const resetUrl = `${appBaseUrl(req)}/login?reset=${encodeURIComponent(issued.token)}`;
        await deliverMailIntent(issued.intent, {
          to: user.email,
          subject: "Reset your Boatship password",
          html: resetPasswordEmailHtml({ name: user.name, resetUrl }),
        });
      }
    }

    return { ok: true };
  }, { headers: { "Cache-Control": "private, no-store" } });
}
