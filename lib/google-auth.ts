/**
 * Service-account OAuth for Google APIs using only fetch and WebCrypto, so it
 * runs in Cloudflare Workers and Node. Tokens are cached per scope set.
 */
export type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKeyPem: string;
  tokenUri?: string;
};

export type TokenProvider = (scopes: string[]) => Promise<string>;

type Deps = { fetch?: typeof fetch; now?: () => number };

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

/**
 * Reads FIREBASE_SERVICE_ACCOUNT (the JSON key, or a bare PEM private key with
 * FIREBASE_CLIENT_EMAIL and FIREBASE_PROJECT_ID beside it). Null when unset.
 */
export function serviceAccountFromEnv(env: Record<string, string | undefined> = process.env): ServiceAccount | null {
  const raw = env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  const pem = (value: string) => value.replace(/\\n/g, "\n");
  if (raw.startsWith("-----BEGIN")) {
    const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
    if (!clientEmail) throw new Error("FIREBASE_CLIENT_EMAIL is required when FIREBASE_SERVICE_ACCOUNT holds only the private key.");
    const projectId = env.FIREBASE_PROJECT_ID?.trim() || projectIdFromEmail(clientEmail);
    if (!projectId) throw new Error("FIREBASE_PROJECT_ID is required when it cannot be derived from FIREBASE_CLIENT_EMAIL.");
    return { projectId, clientEmail, privateKeyPem: pem(raw) };
  }
  let account: { project_id?: unknown; client_email?: unknown; private_key?: unknown; token_uri?: unknown };
  try { account = JSON.parse(raw); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT must be the service account JSON or a PEM private key."); }
  if (typeof account.client_email !== "string" || typeof account.private_key !== "string") throw new Error("FIREBASE_SERVICE_ACCOUNT needs client_email and private_key.");
  const projectId = env.FIREBASE_PROJECT_ID?.trim() || (typeof account.project_id === "string" ? account.project_id : projectIdFromEmail(account.client_email));
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is required when the service account JSON has no project_id.");
  return { projectId, clientEmail: account.client_email, privateKeyPem: pem(account.private_key), tokenUri: typeof account.token_uri === "string" ? account.token_uri : undefined };
}

/** Firebase admin service accounts are named <name>@<project>.iam.gserviceaccount.com. */
export function projectIdFromEmail(email: string): string | null {
  const match = /^[^@]+@([a-z0-9-]+)\.iam\.gserviceaccount\.com$/i.exec(email);
  return match ? match[1] : null;
}

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeSegment = (value: object) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const der = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** A one-hour RS256 assertion for the OAuth JWT bearer grant. */
export async function createServiceAccountAssertion(account: ServiceAccount, scopes: string[], issuedAtSeconds: number): Promise<string> {
  const aud = account.tokenUri || DEFAULT_TOKEN_URI;
  const unsigned = `${encodeSegment({ alg: "RS256", typ: "JWT" })}.${encodeSegment({ iss: account.clientEmail, scope: scopes.join(" "), aud, iat: issuedAtSeconds, exp: issuedAtSeconds + 3600 })}`;
  const key = await importPrivateKey(account.privateKeyPem);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

/** Caches one access token per scope set and refreshes a minute before expiry. */
export function createTokenProvider(account: ServiceAccount, deps: Deps = {}): TokenProvider {
  const doFetch = deps.fetch || fetch;
  const now = deps.now || Date.now;
  const cache = new Map<string, { token: string; expiresAt: number }>();
  return async (scopes) => {
    const key = [...scopes].sort().join(" ");
    const hit = cache.get(key);
    if (hit && hit.expiresAt - 60_000 > now()) return hit.token;
    const assertion = await createServiceAccountAssertion(account, scopes, Math.floor(now() / 1000));
    const response = await doFetch(account.tokenUri || DEFAULT_TOKEN_URI, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!response.ok) throw new Error(`Google token request failed: HTTP ${response.status}`);
    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("Google token response had no access token.");
    cache.set(key, { token: data.access_token, expiresAt: now() + (data.expires_in ?? 3600) * 1000 });
    return data.access_token;
  };
}

/** Module-level provider shared by Storage and Firestore in one runtime. */
let sharedProvider: { account: ServiceAccount; provider: TokenProvider } | null = null;
export function sharedTokenProvider(account: ServiceAccount): TokenProvider {
  if (!sharedProvider || sharedProvider.account.clientEmail !== account.clientEmail || sharedProvider.account.privateKeyPem !== account.privateKeyPem) {
    sharedProvider = { account, provider: createTokenProvider(account) };
  }
  return sharedProvider.provider;
}
