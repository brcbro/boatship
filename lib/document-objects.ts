import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Minimal object-store contract for document bytes. Cloudflare R2 satisfies it
 * in the Worker; tests use an in-memory implementation. Keys are built from
 * ownership identifiers so a leaked key still needs the authenticated route.
 */
export type DocumentObjectStore = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(keys: string[]): Promise<void>;
};

declare global {
  interface CloudflareEnv {
    // Optional until the R2 bucket exists and [[r2_buckets]] is enabled.
    DOCUMENT_FILES?: R2Bucket;
  }
}

const KEY_PART = /^[A-Za-z0-9._:-]{1,128}$/;

export function documentObjectKey(clientId: string, documentId: string, contentId: string): string {
  for (const part of [clientId, documentId, contentId]) {
    if (!KEY_PART.test(part)) throw new Error("Document object identifiers must be bounded URL-safe strings.");
  }
  return `documents/${clientId}/${documentId}/${contentId}`;
}

export function r2DocumentObjectStore(bucket: R2Bucket): DocumentObjectStore {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
    async get(key) {
      const object = await bucket.get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
    async delete(keys) {
      if (keys.length) await bucket.delete(keys);
    },
  };
}

/** The hosted R2 store when its binding is present; null under `next dev` and tests. */
export function getDocumentObjectStore(): DocumentObjectStore | null {
  try {
    const bucket = getCloudflareContext().env.DOCUMENT_FILES;
    return bucket ? r2DocumentObjectStore(bucket) : null;
  } catch {
    return null;
  }
}

export function memoryDocumentObjectStore(): DocumentObjectStore & { objects: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(key, bytes, contentType) { objects.set(key, { bytes: Uint8Array.from(bytes), contentType }); },
    async get(key) { const hit = objects.get(key); return hit ? Uint8Array.from(hit.bytes) : null; },
    async delete(keys) { for (const key of keys) objects.delete(key); },
  };
}
