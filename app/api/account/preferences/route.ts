import { handleApi, jsonError } from "@/lib/api";
import { isHourCycle, isValidTimeZone, PREFERENCE_FIELDS, type AccountPreferences } from "@/lib/account-preferences";
import { requireSession } from "@/lib/auth";
import { getStore, type UserFieldPatch } from "@/lib/store";
import type { AppUser } from "@/types";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

function preferencesOf(user: AppUser): AccountPreferences {
  return { timezone: user.timezone ?? null, hourCycle: user.hourCycle ?? null };
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const user = await (await getStore()).getUser(session.uid);
    if (!user) throw jsonError("User not found", 404);
    return { preferences: preferencesOf(user) };
  }, NO_STORE);
}

/**
 * Saves allowlisted display preferences for the signed-in person. `uid` comes
 * from the session; only the submitted fields are written, so a concurrent
 * credential, status or permission change is kept. Null clears a preference.
 */
export async function PATCH(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw jsonError("Invalid preferences update", 400);
    const fields = body as Record<string, unknown>;
    const keys = Object.keys(fields);
    if (keys.some((key) => !(PREFERENCE_FIELDS as readonly string[]).includes(key))) throw jsonError("Unsupported preference field", 400);
    if (keys.length === 0) throw jsonError("No preference changes provided", 400);

    const patch: UserFieldPatch = {};
    if ("timezone" in fields) {
      if (fields.timezone !== null && !isValidTimeZone(fields.timezone)) throw jsonError("Choose a valid timezone", 400);
      patch.timezone = fields.timezone as string | null;
    }
    if ("hourCycle" in fields) {
      if (fields.hourCycle !== null && !isHourCycle(fields.hourCycle)) throw jsonError("Time format must be 12h or 24h", 400);
      patch.hourCycle = fields.hourCycle as AccountPreferences["hourCycle"];
    }

    const store = await getStore();
    if (!(await store.getUser(session.uid))) throw jsonError("User not found", 404);
    const updated = await store.updateUserFields(session.uid, patch);
    return { preferences: preferencesOf(updated) };
  }, NO_STORE);
}
