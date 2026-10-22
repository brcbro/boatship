import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { inlinePreviewManifest } from "./lib/cloudflare-preview-manifest.mjs";

const preview = JSON.parse(await readFile(".next/server/preview-props.json", "utf8"));
const root = ".open-next/server-functions";
let verified = 0;
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = join(root, entry.name, "handler.mjs");
  const source = await readFile(path, "utf8");
  const patched = inlinePreviewManifest(source, preview);
  if (patched !== source) await writeFile(path, patched);
  verified++;
}
if (!verified) throw new Error("No OpenNext server functions found");
console.log(`Verified Next preview manifest in ${verified} OpenNext server function(s).`);
