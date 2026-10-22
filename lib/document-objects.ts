import { firebaseDocumentObjectStore, firebaseStorageConfigFromEnv } from "@/lib/firebase-storage";

/**
 * Minimal object-store contract for document bytes. Firebase Storage satisfies
 * it in production; tests use an in-memory implementation. Keys are built from
 * ownership identifiers so a leaked key still needs the authenticated route.
 */
export type DocumentObjectStore = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(keys: string[]): Promise<void>;
};

const KEY_PART = /^[A-Za-z0-9._:-]{1,128}$/;

export function documentObjectKey(clientId: string, documentId: string, contentId: string): string {
  for (const part of [clientId, documentId, contentId]) {
    if (!KEY_PART.test(part)) throw new Error("Document object identifiers must be bounded URL-safe strings.");
  }
  return `documents/${clientId}/${documentId}/${contentId}`;
}

/** The Firebase Storage store when its secrets are set; null under plain `next dev` and tests. */
export function getDocumentObjectStore(): DocumentObjectStore | null {
  const config = firebaseStorageConfigFromEnv();
  return config ? firebaseDocumentObjectStore(config) : null;
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
