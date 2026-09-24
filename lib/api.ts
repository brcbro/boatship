import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

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

export async function handleApi<T>(fn: () => Promise<T>) {
  try {
    const data = await fn();
    return jsonOk(data);
  } catch (err) {
    if (err instanceof Response) return err;
    return internalErrorResponse(err);
  }
}
