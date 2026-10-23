import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { Collection, isHostedStore, nowIso } from "@/lib/firestore";
import { documentObjectKey, getDocumentObjectStore, type DocumentObjectStore } from "@/lib/document-objects";
import { readSnapshotSlice } from "@/lib/store";
import type { DocumentRecord, DocumentVersion } from "@/types";

const localDirectory = path.join(process.cwd(), ".data", "document-content");
const relational = () => isHostedStore();

/** Only the Firestore fallback stores bytes inline; it caps a document at 1 MiB. */
const INLINE_BYTES_LIMIT = 900_000;

export type DocumentContentDoc = {
  id: string; documentId: string; clientId: string; bytes: Uint8Array | null; objectKey: string | null; contentType: string; size: number; createdAt: string;
};
export const DOCUMENT_CONTENT = new Collection<DocumentContentDoc>("DocumentContent");

/**
 * Hosted bytes live in the object store (the PostgreSQL blob table, or
 * Firebase Storage for the Firestore fallback) and inline in the
 * DocumentContent document only when neither exists (small files only). The
 * document is the ownership record either way, so reads always authorize
 * through the database before touching the object.
 */
export async function saveDocumentContent(documentId: string, clientId: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const id = randomUUID();
  if (relational()) {
    const objects = getDocumentObjectStore();
    const objectKey = objects ? documentObjectKey(clientId, documentId, id) : null;
    if (!objects && bytes.length > INLINE_BYTES_LIMIT) throw new Error("Files over 900 KB need an object store: PostgreSQL (DATABASE_URL) or Firebase Storage (FIREBASE_STORAGE_BUCKET).");
    if (objects && objectKey) await objects.put(objectKey, bytes, contentType);
    try {
      await DOCUMENT_CONTENT.create(id, { id, documentId, clientId, contentType, size: bytes.length, bytes: objectKey ? null : Uint8Array.from(bytes), objectKey, createdAt: nowIso() });
    } catch (error) {
      if (objects && objectKey) await objects.delete([objectKey]).catch(() => undefined);
      throw error;
    }
  } else if (process.env.ALLOW_LOCAL_STORE === "1") {
    await fs.mkdir(localDirectory, { recursive: true });
    await fs.writeFile(path.join(localDirectory, `${id}.bin`), bytes, { flag: "wx" });
  } else throw new Error("Document storage is not configured.");
  return id;
}

export async function readDocumentContent(document: DocumentRecord, version: DocumentRecord | DocumentVersion): Promise<Uint8Array | null> {
  if (version.contentId) {
    if (relational()) {
      const content = await DOCUMENT_CONTENT.get(version.contentId);
      if (!content || content.documentId !== document.id || content.clientId !== document.clientId) return null;
      if (content.objectKey) {
        const objects = getDocumentObjectStore();
        if (!objects) { console.error("Document bytes are in object storage but no object store is configured"); return null; }
        return objects.get(content.objectKey);
      }
      return content.bytes ? Uint8Array.from(content.bytes) : null;
    }
    if (!/^[0-9a-f-]{36}$/i.test(version.contentId)) return null;
    try { return Uint8Array.from(await fs.readFile(path.join(localDirectory, `${version.contentId}.bin`))); }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null; throw error; }
  }
  // Legacy files remain readable in local demo fixtures or during rollout.
  return version.contentBase64 ? Uint8Array.from(Buffer.from(version.contentBase64.replace(/^data:[^,]*,/, ""), "base64")) : null;
}

export async function removeUnreferencedDocumentContent(id: string) {
  if (relational()) {
    const documents = await readSnapshotSlice("documents");
    // A network failure may occur after metadata committed. Never delete a
    // referenced file while handling an uncertain upload result.
    if (documents.some((document) => document.contentId === id || document.versions.some((version) => version.contentId === id))) return;
    const removed = await DOCUMENT_CONTENT.get(id);
    await DOCUMENT_CONTENT.delete(id);
    if (removed?.objectKey) await getDocumentObjectStore()?.delete([removed.objectKey]).catch((error) => console.error("Document object cleanup failed", error));
  }
  else if (/^[0-9a-f-]{36}$/i.test(id)) await fs.unlink(path.join(localDirectory, `${id}.bin`)).catch(() => undefined);
}

/** Object keys for a client's files; call before the cascade removes their records. */
export async function listClientDocumentObjectKeys(clientId: string): Promise<string[]> {
  if (!relational()) return [];
  const rows = await DOCUMENT_CONTENT.find([{ field: "clientId", op: "==", value: clientId }, { field: "objectKey", op: "is-not-null" }]);
  return rows.flatMap((row) => (row.objectKey ? [row.objectKey] : []));
}

export async function deleteDocumentObjects(keys: string[]) {
  if (!keys.length) return;
  await getDocumentObjectStore()?.delete(keys).catch((error) => console.error("Document object deletion failed", { count: keys.length }, error));
}

/**
 * Moves inline bytes into the object store one bounded batch at a time.
 * Idempotent: a record is only cleared after its object write succeeded, and
 * a repeated call re-copies any record whose previous update was interrupted.
 */
export async function migrateDocumentContentToObjects(limit = 5, objects: DocumentObjectStore | null = getDocumentObjectStore()) {
  if (!relational()) throw new Error("Document content migration requires the hosted store.");
  if (!objects) throw new Error("No object store is configured.");
  const batch = Math.max(1, Math.min(20, Math.floor(limit)));
  const pending = [{ field: "objectKey", op: "is-null" } as const];
  const rows = (await DOCUMENT_CONTENT.find(pending, { orderBy: [{ field: "createdAt" }], limit: batch })).filter((row) => row.bytes);
  let moved = 0;
  for (const row of rows) {
    const objectKey = documentObjectKey(row.clientId, row.documentId, row.id);
    await objects.put(objectKey, Uint8Array.from(row.bytes!), row.contentType);
    await DOCUMENT_CONTENT.update(row.id, { objectKey, bytes: null });
    moved += 1;
  }
  const remaining = await DOCUMENT_CONTENT.count(pending);
  return { moved, remaining };
}
