import assert from "node:assert/strict";
import test from "node:test";
import { documentMetadata } from "../lib/document-response.ts";

test("document metadata responses omit current and previous file contents without changing stored records", () => {
  const document = {
    id: "doc-1",
    fileName: "sample.pdf",
    contentBase64: "current-secret",
    versions: [{ fileName: "old.pdf", contentBase64: "old-secret" }],
  };
  const metadata = documentMetadata(document);

  assert.equal("contentBase64" in metadata, false);
  assert.equal("contentBase64" in metadata.versions[0], false);
  assert.equal(metadata.fileName, "sample.pdf");
  assert.equal(metadata.versions[0].fileName, "old.pdf");
  assert.equal(document.contentBase64, "current-secret");
  assert.equal(document.versions[0].contentBase64, "old-secret");
});
