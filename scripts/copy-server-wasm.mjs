import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const source = join(process.cwd(), ".next", "server", "chunks", "static", "wasm");
const destination = join(
  process.cwd(),
  ".open-next",
  "server-functions",
  "default",
  "static",
  "wasm",
);

const files = await readdir(source).catch(() => []);
if (files.length === 0) {
  console.log(`No standalone server WASM files found in ${source}; Prisma runtime assets are bundled in the server function.`);
  process.exit(0);
}

await mkdir(destination, { recursive: true });
for (const file of files) {
  if (file.endsWith(".wasm")) {
    await cp(join(source, file), join(destination, file));
  }
}

console.log(`Copied ${files.filter((file) => file.endsWith(".wasm")).length} server WASM file(s) for OpenNext.`);
