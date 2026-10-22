import assert from "node:assert/strict";
import test from "node:test";
import { inlinePreviewManifest } from "../scripts/lib/cloudflare-preview-manifest.mjs";

test("Worker loader returns the exact preview manifest while preserving other and unknown manifest behavior", () => {
  const source = 'function loadManifest(path2){if(path2.endsWith("/routes-manifest.json"))return{routes:true};throw new Error(`Unexpected loadManifest(${path2}) call!`)}';
  const preview = { previewModeId: "test-id", previewModeSigningKey: "test-signing", previewModeEncryptionKey: "test-encryption" };
  const patched = inlinePreviewManifest(source, preview);
  const loader = new Function(`${patched};return loadManifest;`)();
  assert.deepEqual(loader("/.next/server/preview-props.json"), preview);
  assert.deepEqual(loader("/.next/routes-manifest.json"), { routes: true });
  assert.throws(() => loader("/.next/server/unknown.json"), /Unexpected loadManifest/);
  assert.equal(inlinePreviewManifest(patched, preview), patched);
  assert.throws(() => inlinePreviewManifest(source, {}), /Invalid preview manifest/);
  assert.throws(() => inlinePreviewManifest("changed upstream loader", preview), /loader changed/);
});
