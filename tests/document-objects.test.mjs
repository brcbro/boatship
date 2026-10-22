import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { documentObjectKey, memoryDocumentObjectStore } from "../lib/document-objects.ts";
import { firebaseDocumentObjectStore, firebaseStorageConfigFromEnv } from "../lib/firebase-storage.ts";
import { createServiceAccountAssertion, createTokenProvider, projectIdFromEmail, serviceAccountFromEnv } from "../lib/google-auth.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
const account = { projectId: "qa-project", clientEmail: "svc@qa-project.iam.gserviceaccount.com", privateKeyPem };
const config = { bucket: "qa-project.appspot.com", account };

test("object keys are ownership-scoped and reject unsafe identifiers", () => {
  assert.equal(documentObjectKey("client_1", "doc-2", "legacy:doc-2:current"), "documents/client_1/doc-2/legacy:doc-2:current");
  for (const bad of ["", "a/b", "../x", "x".repeat(129), "with space"]) assert.throws(() => documentObjectKey(bad, "d", "c"));
});

test("service-account configuration accepts JSON or a bare key, and derives the project", () => {
  assert.equal(serviceAccountFromEnv({}), null);
  assert.equal(projectIdFromEmail("firebase-adminsdk-x@my-proj.iam.gserviceaccount.com"), "my-proj");
  assert.throws(() => serviceAccountFromEnv({ FIREBASE_SERVICE_ACCOUNT: "{not json" }));
  assert.throws(() => serviceAccountFromEnv({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "x" }) }));
  assert.throws(() => serviceAccountFromEnv({ FIREBASE_SERVICE_ACCOUNT: privateKeyPem }), /FIREBASE_CLIENT_EMAIL/);
  const json = serviceAccountFromEnv({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: "p", client_email: "svc@x", private_key: privateKeyPem, token_uri: "https://oauth2.googleapis.com/token" }) });
  assert.deepEqual(json, { projectId: "p", clientEmail: "svc@x", privateKeyPem, tokenUri: "https://oauth2.googleapis.com/token" });
  const split = serviceAccountFromEnv({ FIREBASE_CLIENT_EMAIL: "svc@derived.iam.gserviceaccount.com", FIREBASE_SERVICE_ACCOUNT: privateKeyPem.replace(/\n/g, "\\n") });
  assert.deepEqual(split, { projectId: "derived", clientEmail: "svc@derived.iam.gserviceaccount.com", privateKeyPem });
  assert.equal(firebaseStorageConfigFromEnv({ FIREBASE_SERVICE_ACCOUNT: privateKeyPem, FIREBASE_CLIENT_EMAIL: "svc@d.iam.gserviceaccount.com" }), null, "no bucket means no storage");
  assert.throws(() => firebaseStorageConfigFromEnv({ FIREBASE_STORAGE_BUCKET: "bad bucket/name", FIREBASE_SERVICE_ACCOUNT: privateKeyPem, FIREBASE_CLIENT_EMAIL: "svc@d.iam.gserviceaccount.com" }));
});

test("the service-account assertion is a valid RS256 JWT for the requested scopes", async () => {
  const jwt = await createServiceAccountAssertion(account, ["https://www.googleapis.com/auth/datastore"], 1_700_000_000);
  const [header, payload, signature] = jwt.split(".");
  const decode = (segment) => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decode(payload), { iss: account.clientEmail, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat: 1_700_000_000, exp: 1_700_003_600 });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, "base64url")), true);
});

test("the token provider caches per scope set and refreshes on expiry", async () => {
  let clock = 1_700_000_000_000;
  const calls = [];
  const fakeFetch = async (url, init) => { calls.push(String(init.body)); return new Response(JSON.stringify({ access_token: `tok-${calls.length}`, expires_in: 3600 }), { status: 200 }); };
  const tokens = createTokenProvider(account, { fetch: fakeFetch, now: () => clock });
  assert.equal(await tokens(["a"]), "tok-1");
  assert.equal(await tokens(["a"]), "tok-1");
  assert.equal(await tokens(["b"]), "tok-2");
  clock += 3600 * 1000;
  assert.equal(await tokens(["a"]), "tok-3");
  assert.ok(calls.every((body) => body.includes("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer")));
});

test("the Firebase Storage adapter uploads, downloads and deletes through the JSON API", async () => {
  const objects = new Map();
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.Authorization });
    if (String(url) === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 });
    const upload = /\/upload\/storage\/v1\/b\/qa-project\.appspot\.com\/o\?uploadType=media&name=(.+)$/.exec(String(url));
    if (upload) { objects.set(decodeURIComponent(upload[1]), { bytes: new Uint8Array(init.body), type: init.headers["Content-Type"] }); return new Response("{}", { status: 200 }); }
    const object = /\/storage\/v1\/b\/qa-project\.appspot\.com\/o\/([^?]+)(\?alt=media)?$/.exec(String(url));
    const key = object && decodeURIComponent(object[1]);
    if (init.method === "DELETE") { const existed = objects.delete(key); return new Response(null, { status: existed ? 204 : 404 }); }
    const hit = objects.get(key);
    return hit ? new Response(hit.bytes, { status: 200 }) : new Response("not found", { status: 404 });
  };
  const store = firebaseDocumentObjectStore(config, { fetch: fakeFetch });
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
