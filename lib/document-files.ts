import { Buffer } from "node:buffer";
import { ownedBytes } from "@/lib/firestore/bytes";

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_MAX_LABEL = "25MB";
const FILE_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"], "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"], "image/webp": ["webp"],
};

export class DocumentInputError extends Error {}

export function sniffDocumentType(bytes: Uint8Array): string | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export function decodeDocumentUpload(input: { base64: unknown; fileName: unknown; contentType: unknown; size?: unknown }) {
  if (typeof input.fileName !== "string" || !input.fileName.trim() || input.fileName.length > 255 || /[\r\n\0]/.test(input.fileName)) throw new DocumentInputError("Choose a file with a valid name of 255 characters or fewer.");
  if (typeof input.contentType !== "string") throw new DocumentInputError("A file type is required.");
  const contentType = input.contentType.toLowerCase() === "image/jpg" ? "image/jpeg" : input.contentType.toLowerCase();
  const extension = input.fileName.split(".").pop()?.toLowerCase() || "";
  if (!FILE_TYPES[contentType]?.includes(extension)) throw new DocumentInputError("File type must be PDF, PNG, JPEG, or WebP and match its extension.");
  if (typeof input.base64 !== "string" || input.base64.length > Math.ceil(DOCUMENT_MAX_BYTES / 3) * 4 + 128) throw new DocumentInputError(`File size must be ${DOCUMENT_MAX_LABEL} or less.`);
  const raw = input.base64.replace(/^data:[^,]*,/, "");
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new DocumentInputError("The file could not be read. Choose it again.");
  // One decode; the Buffer is handed on as a view rather than copied again.
  // The base64 JSON transport itself (about 1.33x the file in the request
  // body, plus the decoded bytes) remains; streaming uploads are a follow-up.
  const bytes = ownedBytes(Buffer.from(raw, "base64"));
  if (!bytes.length || bytes.length > DOCUMENT_MAX_BYTES || (input.size !== undefined && (typeof input.size !== "number" || input.size !== bytes.length))) throw new DocumentInputError(`File size is invalid or exceeds ${DOCUMENT_MAX_LABEL}.`);
  if (sniffDocumentType(bytes) !== contentType) throw new DocumentInputError("The file contents do not match its selected type.");
  return { bytes, contentType, fileName: input.fileName.trim() };
}

export function documentVersionIndex(value: string | null, count: number): number | null {
  if (value === null) return null;
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new DocumentInputError("Choose a valid document version.");
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index >= count) throw new DocumentInputError("Document version not found.");
  return index;
}

export function documentContentHeaders(fileName: string, contentType: string, attachment: boolean): Headers {
  const safeName = fileName.replace(/[\r\n\0"\\]/g, "_").replace(/[^\x20-\x7e]/g, "_") || "document";
  const encodedName = encodeURIComponent(fileName.replace(/[\r\n\0]/g, "_")).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'",
  });
}

export function documentByteRange(range: string | null, size: number): { start: number; end: number } | null {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2]) || !size) throw new DocumentInputError("Invalid byte range.");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (!match[1] && Number(match[2]) === 0)) throw new DocumentInputError("Invalid byte range.");
  return { start, end };
}
