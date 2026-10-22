import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Match Cloudflare's imported Module for CLI tests of the generated client. */
export function installQaWasmLoader(root = process.cwd()) {
  const compiler = path.resolve(root, "generated", "prisma", "internal", "query_compiler_bg.wasm");
  return registerHooks({
    load(url, context, nextLoad) {
      const target = new URL(url);
      if (target.protocol === "file:" && target.searchParams.has("module") && fileURLToPath(target) === compiler) {
        const bytes = readFileSync(compiler).toString("base64");
        return {
          format: "module", shortCircuit: true,
          source: `export default new WebAssembly.Module(Uint8Array.from(Buffer.from('${bytes}', 'base64')));`,
        };
      }
      return nextLoad(url, context);
    },
  });
}
