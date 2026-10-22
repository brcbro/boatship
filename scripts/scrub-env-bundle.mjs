import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * OpenNext copies every `.env*` value into `.open-next/cloudflare/next-env.mjs`
 * and ships it inside the Worker, which would bake local secrets into the
 * deployed script. Keep only public/non-secret keys; everything else must be a
 * Wrangler secret (see scripts/worker-secrets.mjs).
 */
const ALLOWED = new Set(["OPENROUTER_MODEL", "APP_URL", "FIREBASE_STORAGE_BUCKET", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PROJECT_ID", "FIRESTORE_DATABASE", "WEBHOOK_ALLOWED_ORIGINS", "ZEPTOMAIL_FROM", "RESEND_FROM"]);
const file = resolve(".open-next/cloudflare/next-env.mjs");
if (!existsSync(file)) { console.log("No next-env.mjs to scrub."); process.exit(0); }

const source = readFileSync(file, "utf8");
const removed = new Set();
const scrubbed = source.replace(/export const (\w+) = (\{.*?\});/gs, (match, mode, json) => {
  const values = JSON.parse(json);
  const kept = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith("NEXT_PUBLIC_") || ALLOWED.has(key)) kept[key] = value;
    else removed.add(key);
  }
  return `export const ${mode} = ${JSON.stringify(kept)};`;
});
if (/BEGIN PRIVATE KEY/.test(scrubbed)) throw new Error("A private key survived the env scrub; refusing to continue.");
writeFileSync(file, scrubbed);
console.log(removed.size ? `Removed ${[...removed].sort().join(", ")} from the bundled env; they must be Wrangler secrets.` : "No secret env keys were bundled.");
