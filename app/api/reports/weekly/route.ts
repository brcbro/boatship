import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { weeklyEvidenceReport } from "@/lib/project-operations";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    return { generatedAt: new Date().toISOString(), reports: await weeklyEvidenceReport(new URL(req.url).searchParams.get("clientId") || undefined) };
  });
}
