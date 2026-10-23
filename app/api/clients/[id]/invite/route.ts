import { handleApi, jsonError } from "@/lib/api";
import { AccountError, CLIENT_INVITATION_TTL_MS, inviteAccount } from "@/lib/accounts";
import { requireRoles } from "@/lib/auth";
import { appBaseUrl } from "@/lib/client-status";
import { enqueueIntegrationEvent } from "@/lib/integration-jobs";
import { emailDeliveryConfigured, inviteEmailHtml } from "@/lib/email";
import { getStore } from "@/lib/store";
import { canAccessClient } from "@/lib/client-access";
import { consumeAccountAndIpLimit, consumeRateLimit } from "@/lib/rate-limit";
import { dispatchWebhooks } from "@/lib/webhooks";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Invite a client portal user for one company. An address that belongs to
 * staff or to another company is refused. An existing active user of the same
 * company keeps their password and status; they only receive a new link.
 */
export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    if (!emailDeliveryConfigured()) throw jsonError("Email delivery is not configured", 503);
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

    let result;
    try {
      result = await inviteAccount({
        actor: session,
        email,
        name,
        role: "client",
        clientId: client.id,
        ttlMs: CLIENT_INVITATION_TTL_MS,
        resolveExisting: (existing) => {
          if (existing.role !== "client" || existing.clientId !== client.id) {
            throw new AccountError("This email already belongs to another account", 400, "email_conflict");
          }
          return "reuse";
        },
        buildEmail: ({ token }) => ({
          to: email,
          subject: `You're invited to the Boatship workspace — ${client.companyName}`,
          html: inviteEmailHtml({ name, companyName: client.companyName, loginUrl: `${appBaseUrl(req)}/login?reset=${encodeURIComponent(token)}` }),
        }),
      });
    } catch (error) {
      if (error instanceof AccountError) throw jsonError(error.message, error.status);
      throw error;
    }
    const { user } = result;

    const invitationActivity = await store.addActivity({
      clientId: client.id,
      actorId: session.uid,
      actorName: session.name,
      action: "client.invited",
      meta: { email, userId: user.uid, delivery: result.delivery.status },
    });

    if (result.delivery.status === "failed") {
      throw jsonError("The invitation was saved but the email could not be sent. Invite again to retry.", 502);
    }

    const integrationJobs = await enqueueIntegrationEvent(session.uid, {
      type: "client.invited",
      clientId: client.id,
      clientName: name,
      companyName: client.companyName,
      email,
    }, `client.invited:${invitationActivity.id}`);

    await dispatchWebhooks("client.invited", {
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
      existingCredentialsKept: result.existingCredentialsKept,
      integrationJobs: integrationJobs.map(({ id, kind, status }) => ({ id, kind, status })),
    };
  });
}
