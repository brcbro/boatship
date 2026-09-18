import type { Client, ClientStatus, Task } from "@/types";
import type { DataStore } from "@/lib/store";
import { notifyIntegrations } from "@/lib/composio";
import { onboardingCompleteEmailHtml, sendEmail } from "@/lib/email";
import { dispatchWebhooks } from "@/lib/webhooks";

/** Derive onboarding status from the client's task list. */
export function deriveClientStatus(tasks: Task[]): ClientStatus {
  if (tasks.length === 0) return "not_started";
  if (tasks.every((t) => t.status === "completed")) return "completed";
  if (tasks.every((t) => t.status === "pending")) return "not_started";
  return "in_progress";
}

/**
 * Recompute and persist client status from tasks.
 * Skips clients that are on_hold. Sends onboarding-complete email when newly completed.
 */
export async function syncClientStatusFromTasks(
  store: DataStore,
  clientId: string,
  options?: { notifyComplete?: boolean; actorUid?: string }
): Promise<Client | null> {
  const client = await store.getClient(clientId);
  if (!client) return null;
  if (client.status === "on_hold") return client;

  const tasks = await store.listTasks(clientId);
  const nextStatus = deriveClientStatus(tasks);
  if (nextStatus === client.status) return client;

  const updated = await store.updateClient(clientId, { status: nextStatus });

  if (nextStatus === "completed" && options?.notifyComplete !== false) {
    try {
      await sendEmail({
        to: client.primaryContactEmail,
        subject: "Onboarding complete — Boatship",
        html: onboardingCompleteEmailHtml({
          name: client.name,
          companyName: client.companyName,
        }),
      });
    } catch (err) {
      console.error("Failed to send onboarding complete email", err);
    }

    const actorUid = options?.actorUid || client.assignedTeamMemberId;
    if (actorUid) {
      void notifyIntegrations(actorUid, {
        type: "onboarding.completed",
        clientId: client.id,
        clientName: client.name,
        companyName: client.companyName,
      });
    }

    void dispatchWebhooks("client.completed", {
      clientId: client.id,
      clientName: client.name,
      companyName: client.companyName,
    });
  }

  return updated;
}

export function appBaseUrl(req?: Request) {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    // Cloudflare may omit x-forwarded-proto on Worker requests. OAuth
    // callbacks must still be HTTPS on every deployed hostname.
    const forwardedProto = req.headers.get("x-forwarded-proto");
    const proto = forwardedProto || (host && !/^localhost(?::\d+)?$/i.test(host) ? "https" : "http");
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}
