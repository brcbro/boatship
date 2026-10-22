import type { DocumentObjectStore } from "@/lib/document-objects";
import { createTokenProvider, serviceAccountFromEnv, sharedTokenProvider, type ServiceAccount, type TokenProvider } from "@/lib/google-auth";

/**
 * Firebase Storage (a Google Cloud Storage bucket) reached through the JSON
 * API with a service account. Runs in Cloudflare Workers and Node because it
 * only needs fetch and WebCrypto; the Firebase Admin SDK is not used.
 */
export type FirebaseStorageConfig = { bucket: string; account: ServiceAccount };

type Deps = { fetch?: typeof fetch; now?: () => number; tokens?: TokenProvider };

export const STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const STORAGE_API = "https://storage.googleapis.com";

/** FIREBASE_STORAGE_BUCKET plus the shared service account; null when either is absent. */
export function firebaseStorageConfigFromEnv(env: Record<string, string | undefined> = process.env): FirebaseStorageConfig | null {
  const bucket = env.FIREBASE_STORAGE_BUCKET?.trim();
  const account = serviceAccountFromEnv(env);
  if (!bucket || !account) return null;
  if (!/^[a-z0-9][a-z0-9._-]{1,221}$/i.test(bucket)) throw new Error("FIREBASE_STORAGE_BUCKET must be a bucket name such as project-id.appspot.com.");
  return { bucket, account };
}

export function firebaseDocumentObjectStore(config: FirebaseStorageConfig, deps: Deps = {}): DocumentObjectStore {
  const doFetch = deps.fetch || fetch;
  const tokens = deps.tokens || (deps.fetch || deps.now ? createTokenProvider(config.account, deps) : sharedTokenProvider(config.account));
  const objectUrl = (key: string) => `${STORAGE_API}/storage/v1/b/${encodeURIComponent(config.bucket)}/o/${encodeURIComponent(key)}`;
  const authorized = async (init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${await tokens([STORAGE_SCOPE])}` } });

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
