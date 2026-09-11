import { NextResponse } from "next/server";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function handleApi<T>(fn: () => Promise<T>) {
  try {
    const data = await fn();
    return jsonOk(data);
  } catch (err) {
    if (err instanceof Response) return err;
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error(message, err);
    return jsonError(message, 500);
  }
}
