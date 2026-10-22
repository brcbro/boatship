import { SESSION_COOKIE } from "./session";

/** Stable distribution; request data never becomes a Durable Object name. */
export function runtimeShard(request: Request, count = 4): string {
  const shards = Number.isInteger(count) && count > 0 && count <= 32 ? count : 4;
  const cookie = (request.headers.get("cookie") || "").slice(0, 4096).split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const key = (cookie || bearer || new URL(request.url).pathname).slice(0, 4096);
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return `app-${(hash >>> 0) % shards}`;
}
