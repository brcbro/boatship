import { firebaseDocumentObjectStore, firebaseStorageConfigFromEnv } from "@/lib/firebase-storage";
import { getFirestore, isHostedStore, PostgresFirestore } from "@/lib/firestore";

/**
 * Minimal object-store contract for document bytes. The PostgreSQL blob table
 * satisfies it in production (Firebase Storage remains for the Firestore
 * fallback); tests use an in-memory implementation. Keys are built from
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

/**
 * The PostgreSQL blob table whenever the database is PostgreSQL, else Firebase
 * Storage when its secrets are set; null under the in-memory test client and
 * the local demo.
 */
export function getDocumentObjectStore(): DocumentObjectStore | null {
  if (isHostedStore()) {
    const client = getFirestore();
    if (client instanceof PostgresFirestore) return postgresDocumentObjectStore(client);
  }
  const config = firebaseStorageConfigFromEnv();
  return config ? firebaseDocumentObjectStore(config) : null;
}

export function postgresDocumentObjectStore(client: PostgresFirestore): DocumentObjectStore {
  return {
    put: (key, bytes, contentType) => client.putBlob(key, bytes, contentType),
    get: (key) => client.getBlob(key),
    delete: (keys) => client.deleteBlobs(keys),
  };
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
