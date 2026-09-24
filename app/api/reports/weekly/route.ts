import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { weeklyEvidenceReport } from "@/lib/project-operations";
import { filterAssignedClients, requireClientAccess } from "@/lib/client-access";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const clientId = new URL(req.url).searchParams.get("clientId") || undefined;
    if (clientId) await requireClientAccess(session, clientId);
    const reports = await weeklyEvidenceReport(clientId);
    const assignedIds = new Set((await filterAssignedClients(session, await (await getStore()).listClients())).map((client) => client.id));
    return { generatedAt: new Date().toISOString(), reports: reports.filter((report) => assignedIds.has(report.clientId)) };
  });
}
