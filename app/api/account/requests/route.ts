import { handleApi, jsonError } from "@/lib/api";
import { AccountError, ACCOUNT_REQUEST_KINDS, createAccountRequest, listAccountRequests, type AccountRequestDoc, type AccountRequestKind } from "@/lib/accounts";
import { requireSession } from "@/lib/auth";
import { consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

/** What the requester sees: never the reviewer's identity. */
function publicRequest(request: AccountRequestDoc) {
  return { id: request.id, kind: request.kind, status: request.status, reason: request.reason, decisionNote: request.decisionNote, createdAt: request.createdAt, updatedAt: request.updatedAt, decidedAt: request.decidedAt };
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const requests = await listAccountRequests(session.uid);
    return { requests: requests.map(publicRequest) };
  }, NO_STORE);
}

/**
 * Opens a personal request (access, export, deactivation) for the signed-in
 * person only. The body cannot name another user, client or target; it
 * carries the kind and an optional bounded reason.
 */
export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw jsonError("Invalid request", 400);
    const { kind, reason } = body as Record<string, unknown>;
    if (typeof kind !== "string" || !(ACCOUNT_REQUEST_KINDS as string[]).includes(kind)) throw jsonError("Choose what to request", 400);
    if (reason !== undefined && reason !== null && typeof reason !== "string") throw jsonError("Reason must be text", 400);
    if (!(await consumeRateLimit({ scope: "account-requests", identity: session.uid, max: 10, windowSeconds: 3600 }))) {
      throw jsonError("Too many requests. Try again later.", 429);
    }
    try {
      const request = await createAccountRequest({ actor: session, kind: kind as AccountRequestKind, reason: (reason as string | null | undefined) ?? null });
      return { request: publicRequest(request) };
    } catch (error) {
      if (error instanceof AccountError) throw jsonError(error.message, error.status);
      throw error;
    }
  }, NO_STORE);
}
