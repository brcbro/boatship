import { createLocalQa, QA_PASSWORD } from "./lib/local-qa.mjs";

const fixture = await createLocalQa({ web: true, log: (message) => process.stdout.write(message) });
console.log(`Isolated QA: http://127.0.0.1:3100 — admin@qa.invalid / client@qa.invalid / team@qa.invalid; password: ${QA_PASSWORD}`);
async function close() { await fixture.close(); process.exit(0); }
process.once("SIGINT", close);
process.once("SIGTERM", close);
