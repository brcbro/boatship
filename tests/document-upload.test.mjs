import test from "node:test";
import assert from "node:assert/strict";
import { applyDocumentUpload } from "../lib/document-upload.ts";

test("replacements preserve current classification, scope and every competing file version", () => {
  const existing = { id: "doc", clientId: "client", taskId: "task", engagementId: "project", documentType: "Contract", expiresAt: "2027-01-01", expiryAlertSentAt: null, versions: [], contentId: "first", fileName: "first.pdf", uploadedAt: "2026-10-14T00:00:00Z", uploadedBy: "u", storagePath: "db://first", contentType: "application/pdf", size: 8, status: "approved", reviewNote: "Approved" };
  const data = { documents: [existing], clients: [{ id: "client" }], activity: [] };
  const stale = { ...existing, documentType: "Old classification", expiresAt: "2026-01-01", contentId: "second", fileName: "second.pdf" };
  applyDocumentUpload(data, stale, { uid: "u", name: "User" });
  applyDocumentUpload(data, { ...stale, contentId: "third", fileName: "third.pdf" }, { uid: "u", name: "User" });
  const current = data.documents[0];
  assert.equal(current.documentType, "Contract");
  assert.equal(current.expiresAt, "2027-01-01");
  assert.deepEqual(current.versions.map((version) => version.contentId), ["first", "second"]);
  assert.equal(current.contentId, "third");
  assert.equal(current.status, "pending_review");
  assert.equal(data.activity.length, 2);
});
