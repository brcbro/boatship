import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import {
  getHodiWorkflow,
  hodiWorkflows,
  planHodiWorkflow,
} from "@/lib/hodi-workflows";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    return { workflows: hodiWorkflows };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as {
      workflowId?: string;
      availableConnections?: unknown;
    };
    if (!body.workflowId) throw jsonError("workflowId is required", 400);

    const workflow = getHodiWorkflow(body.workflowId);
    if (!workflow) throw jsonError("Unknown Hodi workflow", 404);

    const availableConnections = Array.isArray(body.availableConnections)
      ? body.availableConnections.filter((connection): connection is string => typeof connection === "string")
      : undefined;

    return { plan: planHodiWorkflow(workflow, availableConnections) };
  });
}
