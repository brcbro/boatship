import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { getPrisma } from "@/lib/prisma";
import type { DocumentRecord, DocumentVersion } from "@/types";

const localDirectory = path.join(process.cwd(), ".data", "document-content");
const relational = () => Boolean(process.env.DATABASE_URL?.trim());

export async function saveDocumentContent(documentId: string, clientId: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const id = randomUUID();
  if (relational()) {
    await getPrisma().documentContent.create({ data: { id, documentId, clientId, bytes: Uint8Array.from(bytes), contentType, size: bytes.length } });
  } else if (process.env.ALLOW_LOCAL_STORE === "1") {
    await fs.mkdir(localDirectory, { recursive: true });
    await fs.writeFile(path.join(localDirectory, `${id}.bin`), bytes, { flag: "wx" });
  } else throw new Error("Document storage is not configured.");
  return id;
}

export async function readDocumentContent(document: DocumentRecord, version: DocumentRecord | DocumentVersion): Promise<Uint8Array | null> {
  if (version.contentId) {
    if (relational()) {
      const content = await getPrisma().documentContent.findFirst({ where: { id: version.contentId, documentId: document.id, clientId: document.clientId }, select: { bytes: true } });
      return content ? Uint8Array.from(content.bytes) : null;
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
    await prisma.documentContent.delete({ where: { id } });
  }
  else if (/^[0-9a-f-]{36}$/i.test(id)) await fs.unlink(path.join(localDirectory, `${id}.bin`)).catch(() => undefined);
}
