import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import { notifyIntegrations } from "@/lib/composio";
import { inviteEmailHtml, sendEmail } from "@/lib/email";
import { getStore } from "@/lib/store";
import { canAccessClient } from "@/lib/client-access";
import { consumeAccountAndIpLimit, consumeRateLimit } from "@/lib/rate-limit";
import { dispatchWebhooks } from "@/lib/webhooks";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    if (!process.env.RESEND_API_KEY) throw jsonError("Email delivery is not configured", 503);
    const { id } = await params;
    const store = await getStore();
    const client = await store.getClient(id);
    if (!client) throw jsonError("Client not found", 404);
    if (!await canAccessClient(session, id)) throw jsonError("Forbidden", 403);

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      email?: string;
    };

    const name = (body.name || client.name).trim();
    const email = (body.email || client.primaryContactEmail).trim().toLowerCase();
    if (!email) throw jsonError("Email is required", 400);
    if (!(await consumeAccountAndIpLimit({ scope: "client-invite", account: email, req, accountMax: 5, ipMax: 40, windowSeconds: 3600 }))) {
      throw jsonError("Too many invitations. Try again later.", 429);
    }
    if (!(await consumeRateLimit({ scope: "client-invite:actor", identity: session.uid, max: 40, windowSeconds: 3600 }))) {
      throw jsonError("Too many invitations. Try again later.", 429);
    }

    const inviteToken = randomUUID().replace(/-/g, "");
    const inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const existing = await store.getUserByEmail(email);
    if (existing && (existing.role !== "client" || existing.clientId !== client.id)) {
      throw jsonError("This email already belongs to another account", 400);
    }

    const loginUrl = `${appBaseUrl(req)}/login?reset=${encodeURIComponent(inviteToken)}`;
    await sendEmail({
      to: email,
      subject: `You're invited to Boatship onboarding — ${client.companyName}`,
      html: inviteEmailHtml({
        name,
        companyName: client.companyName,
        loginUrl,
        ctaLabel: "Set your password & open portal",
      }),
    });

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
      passwordHash: null,
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
      user: {
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        clientId: user.clientId,
      },
      invitationSent: true,
    };
  });
}
