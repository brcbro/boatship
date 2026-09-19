type MessageRealtimeTicket = {
  clientId: string;
  exp: number;
  role: "admin" | "team" | "client";
  uid: string;
};

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function isTicket(value: unknown): value is MessageRealtimeTicket {
  if (!value || typeof value !== "object") return false;
  const ticket = value as Record<string, unknown>;
  return (
    typeof ticket.clientId === "string" && ticket.clientId.length > 0 &&
    typeof ticket.uid === "string" && ticket.uid.length > 0 &&
    typeof ticket.exp === "number" && Number.isFinite(ticket.exp) &&
    (ticket.role === "admin" || ticket.role === "team" || ticket.role === "client")
  );
}

export async function issueMessageRealtimeTicket(
  input: Omit<MessageRealtimeTicket, "exp">,
  secret: string,
  ttlMs = 60_000
) {
  const payload: MessageRealtimeTicket = { ...input, exp: Date.now() + ttlMs };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(encodedPayload));
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyMessageRealtimeTicket(ticket: string, secret: string) {
  const [encodedPayload, encodedSignature, ...rest] = ticket.split(".");
  if (!encodedPayload || !encodedSignature || rest.length) return null;

  try {
    const isValid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      fromBase64Url(encodedSignature),
      encoder.encode(encodedPayload)
    );
    if (!isValid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
    return isTicket(payload) && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
