import { internalErrorResponse, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { canAccessClient, filterAssignedClients } from "@/lib/client-access";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Audit log export — CSV of all activity (admin / audit.export permission).
 * Optional ?clientId= filter.
 */
export async function GET(req: Request) {
  try {
    const session = await requireRoles(req, ["admin", "team"]);
    if (session.role !== "admin" && !hasPermission(session, "audit.export")) {
      return jsonError("Forbidden", 403);
    }

    const clientId = new URL(req.url).searchParams.get("clientId") || undefined;
    if (clientId && !await canAccessClient(session, clientId)) {
      return jsonError("Forbidden", 403);
    }
    const store = await getStore();
    let activity = await store.listAllActivity();
    if (session.role === "team") {
      const assignedIds = new Set((await filterAssignedClients(session, await store.listClients()))
        .map((client) => client.id));
      activity = activity.filter((entry) => assignedIds.has(entry.clientId));
    }
    if (clientId) {
      activity = activity.filter((a) => a.clientId === clientId);
    }

    const header = ["id", "timestamp", "clientId", "actorId", "actorName", "action", "meta"];
    const rows = activity.map((a) =>
      [
        a.id,
        a.timestamp,
        a.clientId,
        a.actorId,
        a.actorName,
        a.action,
        JSON.stringify(a.meta || {}),
      ]
        .map(csvEscape)
        .join(",")
    );

    const csv = [header.join(","), ...rows].join("\n") + "\n";
    const filename = clientId
      ? `audit-${clientId}-${new Date().toISOString().slice(0, 10)}.csv`
      : `audit-all-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    return internalErrorResponse(err);
  }
}
