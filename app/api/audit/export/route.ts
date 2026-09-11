import { jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
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
    const store = await getStore();
    let activity = await store.listAllActivity();
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
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error(message, err);
    return jsonError(message, 500);
  }
}
