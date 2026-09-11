import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import {
  generateHodiAutomationReview,
  getHodiAutomationRule,
  hodiAutomationRules,
} from "@/lib/hodi-automations";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    return {
      rules: hodiAutomationRules,
      persistence: "session_local",
      note: "Enabled rules are saved only in this browser session. Runs create reviewable results and never send external communication.",
    };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin", "team"]);
    const body = (await req.json().catch(() => ({}))) as { ruleId?: string; clientName?: string };
    if (!body.ruleId) throw jsonError("ruleId is required", 400);

    const rule = getHodiAutomationRule(body.ruleId);
    if (!rule) throw jsonError("Unknown automation rule", 404);

    const clientName = body.clientName?.trim().slice(0, 120) || "this client";
    return {
      review: generateHodiAutomationReview(rule, clientName),
      note: "This is a reviewable result only. No email, message, calendar event, or external action has been sent.",
    };
  });
}
