import { NextResponse } from "next/server";
import { requireRoles, requireSession } from "@/lib/auth";
import { auditExport } from "@/lib/mcp-controls";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await requireSession(req);
  await requireRoles(req, ["admin"]);
  const url = new URL(req.url);
  const rows = await auditExport(url.searchParams.get("identityId") || undefined, session.role === "admin" ? undefined : session.uid);
  if (url.searchParams.get("format") === "csv") {
    const header = "createdAt,toolName,action,resource,success,metadata\n";
    const csv = rows.map((row) => [row.createdAt, row.toolName, row.action, row.resource, row.success, JSON.stringify(row.metadata || {})].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    return new NextResponse(header + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=boatship-mcp-audit.csv" } });
  }
  return NextResponse.json({ events: rows });
}
