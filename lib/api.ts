import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { withRequestStoreScope } from "@/lib/store-context";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Keep unexpected exception details in server logs, linked by a safe response ID. */
export function internalErrorResponse(error: unknown) {
  const requestId = randomUUID();
  console.error("Unhandled API error", { requestId, error });
  return NextResponse.json(
    { error: "Internal server error", requestId },
    { status: 500, headers: { "X-Request-ID": requestId } }
  );
}

/**
 * Runs a handler inside one request store scope and serialises its result.
 * A handler that needs headers or cookies on a success response may return a
 * `Response` itself; `init` applies to the JSON responses built here.
 */
export async function handleApi<T>(fn: () => Promise<T>, init?: ResponseInit) {
  try {
    const data = await withRequestStoreScope(fn);
    if (data instanceof Response) return data;
    return jsonOk(data, init);
  } catch (err) {
    if (err instanceof Response) return err;
    return internalErrorResponse(err);
  }
}
