import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { requireClientAccess } from "@/lib/client-access";
import { listIntegrationJobs, retryIntegrationJob } from "@/lib/integration-jobs";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const response = await handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const clientId = new URL(req.url).searchParams.get("clientId") || undefined;
    if (clientId) await requireClientAccess(session, clientId);
    return { jobs: await listIntegrationJobs(session, clientId) };
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = await req.json().catch(() => ({})) as { id?: unknown };
    if (typeof body.id !== "string" || !body.id.trim() || body.id.length > 200) throw jsonError("A job ID is required", 400);
    if (!await retryIntegrationJob(session, body.id.trim())) throw jsonError("Job is unavailable or cannot be retried", 409);
    return { queued: true };
  });
}
