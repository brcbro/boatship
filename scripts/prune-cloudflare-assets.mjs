import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

// `reference-home-static/dist` is an unreferenced export of the same legacy
// marketing site. OpenNext copies `public/` verbatim, so omitting it from the
// generated deployment assets saves roughly 26 MB without changing source.
const duplicateExport = resolve(".open-next/assets/reference-home-static/dist");
const referenceHomepage = resolve(".open-next/assets/reference-home-static/index.html");
const rootHomepage = resolve(".open-next/assets/index.html");

if (existsSync(duplicateExport)) {
  rmSync(duplicateExport, { recursive: true, force: true });
  console.log("Pruned the unused reference-home-static/dist deployment assets.");
}

// Keep authoring backups and the standalone export's development files out of
// Cloudflare Static Assets. They are not requested by the site and only make
// every deployment larger.
const referenceAssets = resolve(".open-next/assets/reference-home-static");
const unusedFiles = new Set([
  ".assetsignore",
  ".gitignore",
  ".DS_Store",
  "desktop.ini",
  "README.md",
  "package.json",
  "pnpm-lock.yaml",
  "wrangler.jsonc",
]);
const unusedDirectories = new Set([
  ".claude",
  ".playwright-mcp",
  "data",
  "functions",
  "selected works",
  "src",
  "templates",
  "worker",
]);
let removed = 0;

function prune(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory === referenceAssets && unusedDirectories.has(entry.name)) {
        rmSync(path, { recursive: true, force: true });
        removed += 1;
      } else {
        prune(path);
      }
      continue;
    }

    if (
      unusedFiles.has(entry.name) ||
      /\.(?:bak|bluebak|brand_bak)$/i.test(entry.name) ||
      /\.original_static\.html$/i.test(entry.name)
    ) {
      rmSync(path, { force: true });
      removed += 1;
    }
  }
}

prune(referenceAssets);
if (removed > 0) console.log(`Pruned ${removed} unused backup/development assets.`);

// The Next.js rewrite keeps `/` working in local development. In production,
// also place the same document at the static asset root so Cloudflare can serve
// the homepage without starting the Worker. The document's <base> keeps its
// relative CSS, scripts, and images under /reference-home-static/.
if (existsSync(referenceHomepage)) {
  copyFileSync(referenceHomepage, rootHomepage);
  console.log("Copied the marketing homepage to the static asset root.");
}
