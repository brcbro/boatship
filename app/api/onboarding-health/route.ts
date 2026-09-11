import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { evaluateOnboardingHealth } from "@/lib/onboarding-health";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const store = await getStore();
    const clientId = new URL(req.url).searchParams.get("clientId");
    const clients = clientId
      ? [await store.getClient(clientId)].filter(Boolean)
      : await store.listClients();

    const health = await Promise.all(
      clients.map(async (client) =>
        evaluateOnboardingHealth(
          client!,
          await store.listTasks(client!.id),
          await store.listForms(client!.id),
          await store.listDocuments(client!.id)
        )
      )
    );
    const states = {
      on_track: health.filter((item) => item.state === "on_track").length,
      waiting_on_client: health.filter((item) => item.state === "waiting_on_client").length,
      blocked_internally: health.filter((item) => item.state === "blocked_internally").length,
      ready_to_launch: health.filter((item) => item.state === "ready_to_launch").length,
    };

    return { health, states, reminderCount: health.reduce((sum, item) => sum + item.reminders.length, 0) };
  });
}
