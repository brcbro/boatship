import type { Buffer } from "node:buffer";

/**
 * A plain Uint8Array over a Buffer's memory, without copying, when the Buffer
 * owns its whole ArrayBuffer (large decodes, driver results). Small Buffers can
 * be slices of Node's shared allocation pool; those are copied (cheaply) so the
 * result never exposes neighbouring pool memory through `.buffer`.
 */
export function ownedBytes(buffer: Buffer): Uint8Array {
  if (buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength) return new Uint8Array(buffer.buffer, 0, buffer.byteLength);
  return Uint8Array.from(buffer);
}
