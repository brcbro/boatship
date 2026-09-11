import { handleApi, jsonError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export type SearchResultType = "client" | "task" | "document" | "vessel";

export type SearchResult = {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  clientId?: string;
};

const LIMIT = 8;

function matches(q: string, ...parts: (string | null | undefined)[]) {
  return parts.some((p) => (p || "").toLowerCase().includes(q));
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const qRaw = new URL(req.url).searchParams.get("q")?.trim() || "";
    if (!qRaw || qRaw.length < 1) {
      return { results: [] as SearchResult[] };
    }
    if (qRaw.length > 100) throw jsonError("Query too long", 400);

    const q = qRaw.toLowerCase();
    const store = await getStore();
    const results: SearchResult[] = [];
    const staff = isStaff(session.role);

    let clients: NonNullable<Awaited<ReturnType<typeof store.getClient>>>[] = [];
    if (staff) {
      clients = await store.listClients();
    } else if (session.clientId) {
      const own = await store.getClient(session.clientId);
      if (own) clients = [own];
    }

    for (const client of clients) {
      if (results.filter((r) => r.type === "client").length < LIMIT) {
        if (
          matches(
            q,
            client.name,
            client.companyName,
            client.primaryContactEmail,
            ...(client.tags || [])
          )
        ) {
          results.push({
            type: "client",
            id: client.id,
            title: client.name,
            subtitle: client.companyName,
            href: staff ? `/clients/${client.id}` : "/portal",
            clientId: client.id,
          });
        }
      }

      if (results.filter((r) => r.type === "task").length < LIMIT) {
        let tasks = await store.listTasks(client.id);
        if (!staff) {
          tasks = tasks.filter((t) => t.type === "client_facing");
        }
        for (const task of tasks) {
          if (results.filter((r) => r.type === "task").length >= LIMIT) break;
          if (matches(q, task.title, task.description, task.section)) {
            results.push({
              type: "task",
              id: task.id,
              title: task.title,
              subtitle: client.name,
              href: staff ? `/clients/${client.id}` : "/portal/tasks",
              clientId: client.id,
            });
          }
        }
      }

      if (results.filter((r) => r.type === "document").length < LIMIT) {
        const documents = await store.listDocuments(client.id);
        for (const doc of documents) {
          if (results.filter((r) => r.type === "document").length >= LIMIT) break;
          if (matches(q, doc.fileName, doc.documentType)) {
            results.push({
              type: "document",
              id: doc.id,
              title: doc.fileName,
              subtitle: client.name,
              href: staff ? `/clients/${client.id}` : "/portal/documents",
              clientId: client.id,
            });
          }
        }
      }

      if (results.filter((r) => r.type === "vessel").length < LIMIT) {
        const vessels = await store.listVessels(client.id);
        for (const vessel of vessels) {
          if (results.filter((r) => r.type === "vessel").length >= LIMIT) break;
          if (
            matches(
              q,
              vessel.name,
              vessel.imo,
              vessel.flag,
              vessel.vesselType,
              vessel.classSociety,
              vessel.notes
            )
          ) {
            results.push({
              type: "vessel",
              id: vessel.id,
              title: vessel.name,
              subtitle: [vessel.imo, vessel.flag, client.name].filter(Boolean).join(" · "),
              href: staff ? `/clients/${client.id}` : "/portal",
              clientId: client.id,
            });
          }
        }
      }
    }

    // Prefer mixed relevance order: clients, vessels, tasks, documents
    const order: SearchResultType[] = ["client", "vessel", "task", "document"];
    results.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

    return { results: results.slice(0, 24) };
  });
}
