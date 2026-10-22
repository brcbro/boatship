import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { getPrisma } from "@/lib/prisma";
import { documentObjectKey, getDocumentObjectStore, type DocumentObjectStore } from "@/lib/document-objects";
import type { DocumentRecord, DocumentVersion } from "@/types";

const localDirectory = path.join(process.cwd(), ".data", "document-content");
const relational = () => Boolean(process.env.DATABASE_URL?.trim());

/**
 * Hosted bytes live in Firebase Storage when its secrets are configured and
 * in the DocumentContent row otherwise. The row is the ownership record either way,
 * so reads always authorize through the database before touching the object.
 */
export async function saveDocumentContent(documentId: string, clientId: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const id = randomUUID();
  if (relational()) {
    const objects = getDocumentObjectStore();
    const objectKey = objects ? documentObjectKey(clientId, documentId, id) : null;
    if (objects && objectKey) await objects.put(objectKey, bytes, contentType);
    try {
      await getPrisma().documentContent.create({ data: {
        id, documentId, clientId, contentType, size: bytes.length,
        bytes: objectKey ? null : Uint8Array.from(bytes), objectKey,
      } });
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
      const content = await getPrisma().documentContent.findFirst({ where: { id: version.contentId, documentId: document.id, clientId: document.clientId }, select: { bytes: true, objectKey: true } });
      if (!content) return null;
      if (content.objectKey) {
        const objects = getDocumentObjectStore();
        if (!objects) { console.error("Document bytes are in object storage but Firebase Storage is not configured"); return null; }
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
    const prisma = getPrisma();
    const snapshot = await prisma.storeSnapshot.findUnique({ where: { id: "main" }, select: { data: true } });
    const documents = (snapshot?.data as { documents?: DocumentRecord[] } | null)?.documents || [];
    // A network failure may occur after metadata committed. Never delete a
    // referenced file while handling an uncertain upload result.
    if (documents.some((document) => document.contentId === id || document.versions.some((version) => version.contentId === id))) return;
    const removed = await prisma.documentContent.delete({ where: { id }, select: { objectKey: true } });
    if (removed.objectKey) await getDocumentObjectStore()?.delete([removed.objectKey]).catch((error) => console.error("Document object cleanup failed", error));
  }
  else if (/^[0-9a-f-]{36}$/i.test(id)) await fs.unlink(path.join(localDirectory, `${id}.bin`)).catch(() => undefined);
}

/** Object keys for a client's files; call before the relational cascade removes their rows. */
export async function listClientDocumentObjectKeys(clientId: string): Promise<string[]> {
  if (!relational()) return [];
  const rows = await getPrisma().documentContent.findMany({ where: { clientId, objectKey: { not: null } }, select: { objectKey: true } });
  return rows.flatMap((row) => (row.objectKey ? [row.objectKey] : []));
}

export async function deleteDocumentObjects(keys: string[]) {
  if (!keys.length) return;
  await getDocumentObjectStore()?.delete(keys).catch((error) => console.error("Document object deletion failed", { count: keys.length }, error));
}

/**
 * Moves row-stored bytes into the object store one bounded batch at a time.
 * Idempotent: a row is only cleared after its object write succeeded, and a
 * repeated call re-copies any row whose previous update was interrupted.
 */
export async function migrateDocumentContentToObjects(limit = 5, objects: DocumentObjectStore | null = getDocumentObjectStore()) {
  if (!relational()) throw new Error("Document content migration requires the relational store.");
  if (!objects) throw new Error("Firebase Storage is not configured.");
  const prisma = getPrisma();
  const batch = Math.max(1, Math.min(20, Math.floor(limit)));
  const rows = await prisma.documentContent.findMany({ where: { objectKey: null, bytes: { not: null } }, orderBy: { createdAt: "asc" }, take: batch, select: { id: true, documentId: true, clientId: true, bytes: true, contentType: true } });
  let moved = 0;
  for (const row of rows) {
    if (!row.bytes) continue;
    const objectKey = documentObjectKey(row.clientId, row.documentId, row.id);
    await objects.put(objectKey, Uint8Array.from(row.bytes), row.contentType);
    await prisma.documentContent.update({ where: { id: row.id }, data: { objectKey, bytes: null } });
    moved += 1;
  }
  const remaining = await prisma.documentContent.count({ where: { objectKey: null, bytes: { not: null } } });
  return { moved, remaining };
}
