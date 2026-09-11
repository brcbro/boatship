import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Seed a sample "Harbor Demo" client for demos (admin only).
 * Idempotent — skips create if a client with that company name already exists.
 */
export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const store = await getStore();
    const existing = (await store.listClients()).find(
      (c) => c.companyName.toLowerCase() === "harbor demo" || c.name.toLowerCase() === "harbor demo"
    );

    if (existing) {
      return { ok: true, created: false, client: existing };
    }

    const client = await store.createClient({
      name: "Harbor Demo",
      companyName: "Harbor Demo",
      primaryContactEmail: "demo@harbor.example",
      assignedTeamMemberId: session.uid,
      templateId: null,
      tags: ["demo", "sample", "harbor"],
      customFields: { source: "demo-seed" },
    });

    await store.addActivity({
      clientId: client.id,
      actorId: session.uid,
      actorName: session.name,
      action: "demo.seed",
      meta: { companyName: client.companyName },
    });

    return { ok: true, created: true, client };
  });
}
