import type { DocumentObjectStore } from "@/lib/document-objects";

/**
 * Firebase Storage (a Google Cloud Storage bucket) reached through the JSON
 * API with a service account. Runs in Cloudflare Workers and Node because it
 * only needs fetch and WebCrypto; the Firebase Admin SDK is not used.
 */
export type FirebaseStorageConfig = {
  bucket: string;
  clientEmail: string;
  privateKeyPem: string;
  tokenUri?: string;
};

type Deps = { fetch?: typeof fetch; now?: () => number };

const STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const STORAGE_API = "https://storage.googleapis.com";

/** Parses FIREBASE_STORAGE_BUCKET and the FIREBASE_SERVICE_ACCOUNT JSON secret; null when either is absent. */
export function firebaseStorageConfigFromEnv(env: Record<string, string | undefined> = process.env): FirebaseStorageConfig | null {
  const bucket = env.FIREBASE_STORAGE_BUCKET?.trim();
  const raw = env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!bucket || !raw) return null;
  let account: { client_email?: unknown; private_key?: unknown; token_uri?: unknown };
  try { account = JSON.parse(raw); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT must be the service account JSON."); }
  if (typeof account.client_email !== "string" || typeof account.private_key !== "string") throw new Error("FIREBASE_SERVICE_ACCOUNT needs client_email and private_key.");
  if (!/^[a-z0-9][a-z0-9._-]{1,221}$/i.test(bucket)) throw new Error("FIREBASE_STORAGE_BUCKET must be a bucket name such as project-id.appspot.com.");
  return { bucket, clientEmail: account.client_email, privateKeyPem: account.private_key, tokenUri: typeof account.token_uri === "string" ? account.token_uri : undefined };
}

const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeSegment = (value: object) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  const der = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** A one-hour RS256 service-account assertion for the OAuth JWT bearer grant. */
export async function createServiceAccountAssertion(config: FirebaseStorageConfig, issuedAtSeconds: number): Promise<string> {
  const aud = config.tokenUri || DEFAULT_TOKEN_URI;
  const unsigned = `${encodeSegment({ alg: "RS256", typ: "JWT" })}.${encodeSegment({ iss: config.clientEmail, scope: STORAGE_SCOPE, aud, iat: issuedAtSeconds, exp: issuedAtSeconds + 3600 })}`;
  const key = await importPrivateKey(config.privateKeyPem);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

export function firebaseDocumentObjectStore(config: FirebaseStorageConfig, deps: Deps = {}): DocumentObjectStore {
  const doFetch = deps.fetch || fetch;
  const now = deps.now || Date.now;
  let cached: { token: string; expiresAt: number } | null = null;

  const accessToken = async () => {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const assertion = await createServiceAccountAssertion(config, Math.floor(now() / 1000));
    const response = await doFetch(config.tokenUri || DEFAULT_TOKEN_URI, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!response.ok) throw new Error(`Firebase Storage token request failed: HTTP ${response.status}`);
    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("Firebase Storage token response had no access token.");
    cached = { token: data.access_token, expiresAt: now() + (data.expires_in ?? 3600) * 1000 };
    return cached.token;
  };

  const objectUrl = (key: string) => `${STORAGE_API}/storage/v1/b/${encodeURIComponent(config.bucket)}/o/${encodeURIComponent(key)}`;
  const authorized = async (init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${await accessToken()}` } });

  return {
    async put(key, bytes, contentType) {
      const url = `${STORAGE_API}/upload/storage/v1/b/${encodeURIComponent(config.bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`;
      const response = await doFetch(url, await authorized({ method: "POST", headers: { "Content-Type": contentType }, body: bytes as BodyInit }));
      if (!response.ok) throw new Error(`Firebase Storage upload failed: HTTP ${response.status}`);
    },
    async get(key) {
      const response = await doFetch(`${objectUrl(key)}?alt=media`, await authorized());
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Firebase Storage download failed: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async delete(keys) {
      for (const key of keys) {
        const response = await doFetch(objectUrl(key), await authorized({ method: "DELETE" }));
        if (!response.ok && response.status !== 404) throw new Error(`Firebase Storage delete failed: HTTP ${response.status}`);
      }
    },
  };
}
