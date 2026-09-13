import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import {
  listHodiAutomationRules,
  listHodiAutomationRuns,
  runHodiAutomationReview,
  setHodiAutomationRuleEnabled,
} from "@/lib/hodi-automations";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const ruleId = new URL(req.url).searchParams.get("ruleId") || undefined;
    return {
      rules: await listHodiAutomationRules(),
      runs: await listHodiAutomationRuns(session, ruleId),
      persistence: "database",
      execution: "manual_review_only",
      note: "Rule state and review runs are stored in Boatship. No unmanaged scheduler or external action is enabled.",
    };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as { ruleId?: string; clientName?: string };
    if (!body.ruleId) throw jsonError("ruleId is required", 400);

    const clientName = body.clientName?.trim().slice(0, 120) || "this client";
    return runHodiAutomationReview(body.ruleId, clientName, session);
  });
}

export async function PATCH(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as { ruleId?: unknown; enabled?: unknown };
    if (typeof body.ruleId !== "string" || !body.ruleId.trim() || typeof body.enabled !== "boolean") {
      throw jsonError("ruleId and enabled are required", 400);
    }
    return { state: await setHodiAutomationRuleEnabled(body.ruleId, body.enabled, session) };
  });
}
