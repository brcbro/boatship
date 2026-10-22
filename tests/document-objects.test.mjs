import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { documentObjectKey, memoryDocumentObjectStore } from "../lib/document-objects.ts";
import { createServiceAccountAssertion, firebaseDocumentObjectStore, firebaseStorageConfigFromEnv } from "../lib/firebase-storage.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const config = { bucket: "qa-project.appspot.com", clientEmail: "svc@qa-project.iam.gserviceaccount.com", privateKeyPem };

test("object keys are ownership-scoped and reject unsafe identifiers", () => {
  assert.equal(documentObjectKey("client_1", "doc-2", "legacy:doc-2:current"), "documents/client_1/doc-2/legacy:doc-2:current");
  for (const bad of ["", "a/b", "../x", "x".repeat(129), "with space"]) assert.throws(() => documentObjectKey(bad, "d", "c"));
});

test("Firebase configuration requires both secrets and a parseable service account", () => {
  assert.equal(firebaseStorageConfigFromEnv({}), null);
  assert.equal(firebaseStorageConfigFromEnv({ FIREBASE_STORAGE_BUCKET: "b.appspot.com" }), null);
  assert.throws(() => firebaseStorageConfigFromEnv({ FIREBASE_STORAGE_BUCKET: "b.appspot.com", FIREBASE_SERVICE_ACCOUNT: "{not json" }));
  assert.throws(() => firebaseStorageConfigFromEnv({ FIREBASE_STORAGE_BUCKET: "b.appspot.com", FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "x" }) }));
  assert.throws(() => firebaseStorageConfigFromEnv({ FIREBASE_STORAGE_BUCKET: "bad bucket/name", FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "x", private_key: "y" }) }));
  const parsed = firebaseStorageConfigFromEnv({ FIREBASE_STORAGE_BUCKET: "b.appspot.com", FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "svc@x", private_key: privateKeyPem, token_uri: "https://oauth2.googleapis.com/token" }) });
  assert.deepEqual(parsed, { bucket: "b.appspot.com", clientEmail: "svc@x", privateKeyPem, tokenUri: "https://oauth2.googleapis.com/token" });
  assert.throws(() => firebaseStorageConfigFromEnv({ FIREBASE_STORAGE_BUCKET: "b.appspot.com", FIREBASE_SERVICE_ACCOUNT: privateKeyPem }), /FIREBASE_CLIENT_EMAIL/);
  const split = firebaseStorageConfigFromEnv({ FIREBASE_STORAGE_BUCKET: "b.appspot.com", FIREBASE_CLIENT_EMAIL: "svc@x", FIREBASE_SERVICE_ACCOUNT: privateKeyPem.replace(/\n/g, "\\n") });
  assert.deepEqual(split, { bucket: "b.appspot.com", clientEmail: "svc@x", privateKeyPem });
});

test("the service-account assertion is a valid RS256 JWT for the storage scope", async () => {
  const jwt = await createServiceAccountAssertion(config, 1_700_000_000);
  const [header, payload, signature] = jwt.split(".");
  const decode = (segment) => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decode(payload), { iss: config.clientEmail, scope: "https://www.googleapis.com/auth/devstorage.read_write", aud: "https://oauth2.googleapis.com/token", iat: 1_700_000_000, exp: 1_700_003_600 });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, "base64url")), true);
});

test("the Firebase adapter exchanges one token, then uploads, downloads and deletes through the JSON API", async () => {
  const calls = [];
  const objects = new Map();
  let clock = 1_700_000_000_000;
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", auth: init.headers?.Authorization, type: init.headers?.["Content-Type"] });
    if (String(url) === "https://oauth2.googleapis.com/token") {
      assert.equal(init.method, "POST");
      assert.match(String(init.body), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/);
      return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 });
    }
    const upload = /\/upload\/storage\/v1\/b\/qa-project\.appspot\.com\/o\?uploadType=media&name=(.+)$/.exec(String(url));
    if (upload) { objects.set(decodeURIComponent(upload[1]), { bytes: new Uint8Array(init.body), type: init.headers["Content-Type"] }); return new Response("{}", { status: 200 }); }
    const object = /\/storage\/v1\/b\/qa-project\.appspot\.com\/o\/([^?]+)(\?alt=media)?$/.exec(String(url));
    const key = object && decodeURIComponent(object[1]);
    if (init.method === "DELETE") { const existed = objects.delete(key); return new Response(null, { status: existed ? 204 : 404 }); }
    const hit = objects.get(key);
    return hit ? new Response(hit.bytes, { status: 200 }) : new Response("not found", { status: 404 });
  };
  const store = firebaseDocumentObjectStore(config, { fetch: fakeFetch, now: () => clock });
  const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
  await store.put("documents/c/d/x", bytes, "application/pdf");
  assert.deepEqual(await store.get("documents/c/d/x"), bytes);
  assert.equal(objects.get("documents/c/d/x").type, "application/pdf");
  assert.equal(await store.get("documents/c/d/missing"), null);
  await store.delete(["documents/c/d/x", "documents/c/d/missing"]);
  assert.equal(objects.size, 0);
  assert.equal(calls.filter((call) => call.url.endsWith("/token")).length, 1, "token is cached across calls");
  assert.ok(calls.filter((call) => !call.url.endsWith("/token")).every((call) => call.auth === "Bearer tok-1"));
  assert.ok(calls.every((call) => !call.url.includes("tok-1")), "credentials never appear in URLs");
  clock += 3600 * 1000;
  await store.get("documents/c/d/missing");
  assert.equal(calls.filter((call) => call.url.endsWith("/token")).length, 2, "an expired token is refreshed");
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
