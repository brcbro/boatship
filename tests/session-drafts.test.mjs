import assert from "node:assert/strict";
import test from "node:test";
import { clearSessionDrafts, discardSessionDraft, readSessionDraft, sessionDraftKey, SESSION_DRAFT_TTL_MS, writeSessionDraft } from "../lib/session-drafts.ts";

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
  };
}
const decode = (value) => typeof value === "string" ? value : null;

test("draft keys isolate users, clients, engagements and forms", () => {
  const base = { userId: "user-a", area: "form", resourceId: "form-a", context: "client-a:engagement-a" };
  const keys = [base, { ...base, userId: "user-b" }, { ...base, resourceId: "form-b" }, { ...base, context: "client-b:engagement-a" }, { ...base, context: "client-a:engagement-b" }].map(sessionDraftKey);
  assert.equal(new Set(keys).size, keys.length);
  const storage = memoryStorage();
  assert.equal(writeSessionDraft(keys[0], "unfinished", storage, 1000), true);
  assert.equal(readSessionDraft(keys[1], decode, storage, 1001), null);
  assert.equal(readSessionDraft(keys[0], decode, storage, 1001).value, "unfinished");
});

test("expired, malformed and incompatible drafts are removed and never restored", () => {
  const storage = memoryStorage();
  const key = sessionDraftKey({ userId: "user-a", area: "intake", resourceId: "new-client" });
  writeSessionDraft(key, "unfinished", storage, 1000);
  assert.equal(readSessionDraft(key, decode, storage, 1000 + SESSION_DRAFT_TTL_MS), null);
  assert.equal(storage.getItem(key), null);
  storage.setItem(key, "malformed");
  assert.equal(readSessionDraft(key, decode, storage, 1000), null);
  writeSessionDraft(key, { unsupported: true }, storage, 1000);
  assert.equal(readSessionDraft(key, decode, storage, 1001), null);
  writeSessionDraft(key, "future", storage, 2000);
  assert.equal(readSessionDraft(key, decode, storage, 1000), null);
});

test("submission/discard removes a draft and logout clears drafts without deleting other browser state", () => {
  const storage = memoryStorage();
  const key = sessionDraftKey({ userId: "user-a", area: "form", resourceId: "form-a" });
  storage.setItem("unrelated", "kept");
  writeSessionDraft(key, "unfinished", storage);
  assert.equal(discardSessionDraft(key, storage), true);
  assert.equal(storage.getItem(key), null);
  writeSessionDraft(key, "unfinished", storage);
  clearSessionDrafts(storage);
  assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem("unrelated"), "kept");
});

test("unavailable or full browser storage cannot report a false saved draft or prevent logout", () => {
  const blocked = { get length() { throw new Error("denied"); }, getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("denied"); }, key() { throw new Error("denied"); } };
  assert.equal(writeSessionDraft("key", "unfinished", blocked), false);
  assert.equal(readSessionDraft("key", decode, blocked), null);
  assert.equal(discardSessionDraft("key", blocked), false);
  assert.doesNotThrow(() => clearSessionDrafts(blocked));
  assert.equal(writeSessionDraft("key", "unfinished", null), false);
});
