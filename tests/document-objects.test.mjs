import assert from "node:assert/strict";
import test from "node:test";
import { documentObjectKey, memoryDocumentObjectStore, r2DocumentObjectStore } from "../lib/document-objects.ts";

test("object keys are ownership-scoped and reject unsafe identifiers", () => {
  assert.equal(documentObjectKey("client_1", "doc-2", "legacy:doc-2:current"), "documents/client_1/doc-2/legacy:doc-2:current");
  for (const bad of ["", "a/b", "../x", "x".repeat(129), "with space"]) assert.throws(() => documentObjectKey(bad, "d", "c"));
});

test("the R2 adapter round-trips bytes, content type and bulk deletes", async () => {
  const stored = new Map();
  const bucket = {
    async put(key, bytes, options) { stored.set(key, { bytes: Uint8Array.from(bytes), type: options.httpMetadata.contentType }); },
    async get(key) { const hit = stored.get(key); return hit ? { arrayBuffer: async () => hit.bytes.buffer.slice(hit.bytes.byteOffset, hit.bytes.byteOffset + hit.bytes.byteLength) } : null; },
    async delete(keys) { for (const key of keys) stored.delete(key); },
  };
  const store = r2DocumentObjectStore(bucket);
  const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
  await store.put("documents/c/d/x", bytes, "application/pdf");
  assert.equal(stored.get("documents/c/d/x").type, "application/pdf");
  assert.deepEqual(await store.get("documents/c/d/x"), bytes);
  assert.equal(await store.get("documents/c/d/missing"), null);
  await store.delete(["documents/c/d/x"]);
  assert.equal(stored.size, 0);
});

test("the in-memory store copies bytes on write and read", async () => {
  const store = memoryDocumentObjectStore();
  const bytes = Uint8Array.from([1, 2, 3]);
  await store.put("k", bytes, "image/png");
  bytes[0] = 9;
  const read = await store.get("k");
  assert.deepEqual(read, Uint8Array.from([1, 2, 3]));
  read[1] = 9;
  assert.deepEqual(await store.get("k"), Uint8Array.from([1, 2, 3]));
});
