import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import { notifyIntegrations } from "@/lib/composio";
import { inviteEmailHtml, sendEmail } from "@/lib/email";
import { hashPassword } from "@/lib/password";
import { getStore } from "@/lib/store";
import { dispatchWebhooks } from "@/lib/webhooks";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Local/demo invite password — use this when signing in as an invited client. */
const TEMP_PASSWORD = "Welcome123!";

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    const store = await getStore();
    const client = await store.getClient(id);
    if (!client) throw jsonError("Client not found", 404);

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      email?: string;
    };

    const name = (body.name || client.name).trim();
    const email = (body.email || client.primaryContactEmail).trim().toLowerCase();
    if (!email) throw jsonError("Email is required", 400);

    const inviteToken = randomUUID().replace(/-/g, "");
    const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const existing = await store.getUserByEmail(email);
    const user = await store.upsertUser({
      uid: existing?.uid || randomUUID(),
      email,
      name,
      role: "client",
      clientId: client.id,
      createdAt: existing?.createdAt || new Date().toISOString(),
      inviteToken,
      inviteTokenExpiresAt,
      mustResetPassword: true,
      password: null,
      passwordHash: existing?.passwordHash || hashPassword(TEMP_PASSWORD),
    });

    const loginUrl = `${appBaseUrl(req)}/login?reset=${encodeURIComponent(inviteToken)}`;
    await sendEmail({
      to: email,
      subject: `You're invited to Boatship onboarding — ${client.companyName}`,
      html: inviteEmailHtml({
        name,
        companyName: client.companyName,
        loginUrl,
        tempPassword: TEMP_PASSWORD,
        ctaLabel: "Set your password & open portal",
      }),
    });

    await store.addActivity({
      clientId: client.id,
      actorId: session.uid,
      actorName: session.name,
      action: "client.invited",
      meta: { email, userId: user.uid },
    });

    void notifyIntegrations(session.uid, {
      type: "client.invited",
      clientId: client.id,
      clientName: name,
      companyName: client.companyName,
      email,
    });

    void dispatchWebhooks("client.invited", {
      clientId: client.id,
      clientName: name,
      companyName: client.companyName,
      email,
      userId: user.uid,
    });

    return {
      user,
      tempPassword: TEMP_PASSWORD,
      loginUrl,
      inviteToken,
    };
  });
}
