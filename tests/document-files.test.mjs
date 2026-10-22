import assert from "node:assert/strict";
import test from "node:test";
import { decodeDocumentUpload, documentVersionIndex, documentContentHeaders, documentByteRange } from "../lib/document-files.ts";

test("uploads must match file signature, extension, size and encoding", () => {
  const bytes = Buffer.from("%PDF-1.7\nhello");
  assert.deepEqual(decodeDocumentUpload({ base64: bytes.toString("base64"), fileName: "contract.pdf", contentType: "application/pdf", size: bytes.length }).bytes, Uint8Array.from(bytes));
  for (const bad of [ { base64: Buffer.from("<script>bad</script>").toString("base64") }, { base64: "not base64" }, { size: bytes.length + 1 }, { fileName: "contract.html" }, { contentType: "text/html" }, { fileName: "x\r\nHeader: injected.pdf" } ]) {
    assert.throws(() => decodeDocumentUpload({ base64: bytes.toString("base64"), fileName: "contract.pdf", contentType: "application/pdf", ...bad }));
  }
});

test("history selection accepts bounded integer indexes only", () => {
  assert.equal(documentVersionIndex(null, 2), null);
  assert.equal(documentVersionIndex("0", 2), 0);
  for (const value of ["-1", "2", "0.5", "01", "9999999999999999999999"]) assert.throws(() => documentVersionIndex(value, 2));
});

test("file headers resist injection and keep responses private", () => {
  const headers = documentContentHeaders('Café "contract"\r\n.pdf', "application/pdf", true);
  assert.match(headers.get("content-disposition"), /^attachment;/);
  assert.ok(!/[\r\n]/.test(headers.get("content-disposition")));
  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
});

test("PDF byte ranges are validated and bounded", () => {
  assert.deepEqual(documentByteRange("bytes=2-99", 10), { start: 2, end: 9 });
  assert.deepEqual(documentByteRange("bytes=-4", 10), { start: 6, end: 9 });
  for (const range of ["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=0-1,2-3"]) assert.throws(() => documentByteRange(range, 10));
});
