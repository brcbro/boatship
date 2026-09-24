import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

// The old marketing export remains in source as a reference. Keep it out of
// deployment assets so it cannot replace the current Next.js homepage.
const assetsRoot = resolve(".open-next/assets");
const legacyExport = join(assetsRoot, "reference-home-static");

if (!legacyExport.startsWith(`${assetsRoot}\\`) && !legacyExport.startsWith(`${assetsRoot}/`)) {
  throw new Error("Refusing to prune assets outside the OpenNext asset directory.");
}

if (existsSync(legacyExport)) {
  rmSync(legacyExport, { recursive: true, force: true });
  console.log("Pruned the retired marketing export from deployment assets.");
}
