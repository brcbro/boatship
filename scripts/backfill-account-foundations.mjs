import { config } from "dotenv";
import { getFirestore, storeTargetId } from "./lib/firestore-cli.mjs";
import { planAccountBackfill } from "./lib/account-backfill.mjs";

/**
 * Brings user records written before the account foundations (2026-10-23) up
 * to date: explicit `status`, `authzVersion`, and one IdentityEmailClaim per
 * address. Dry run by default; `--apply` writes. The guard
 * `--expect-target <host>` must name the PostgreSQL host (or Firebase project)
 * so the script cannot run against the wrong database by accident.
 *
 * The script stops without writing when it finds anything it would have to
 * guess about (duplicate addresses, conflicting claims, unknown statuses) and
 * prints each problem. Fix those by hand, then run again. Legacy invitation
 * links (`inviteToken` on the profile) are counted but left alone: they keep
 * working until they expire and the reset endpoint clears them.
 */
config({ path: ".env.local", quiet: true });
config({ quiet: true });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const expected = args[args.indexOf("--expect-target") + 1];
if (!args.includes("--expect-target") || !expected) throw new Error("--expect-target <database host or project id> is required");
const target = storeTargetId();
if (target !== expected) throw new Error(`Refusing to run: the configured store is ${target}, not ${expected}`);

const firestore = getFirestore();

async function read(reader) {
  const profiles = (await reader.query({ collection: "UserProfile" })).map((doc) => ({ ...doc.data, uid: doc.id }));
  const claims = (await reader.query({ collection: "IdentityEmailClaim" })).map((doc) => ({ ...doc.data, id: doc.id }));
  return { profiles, claims };
}

const plan = planAccountBackfill(await read(firestore));
console.log(`Target ${target}: ${JSON.stringify(plan.summary)}`);
for (const problem of plan.problems) console.log(`PROBLEM ${JSON.stringify(problem)}`);
if (plan.problems.length) {
  console.log(`${plan.problems.length} problem(s) must be resolved by hand before this backfill can apply.`);
  process.exit(1);
}
console.log(`${plan.writes.length} write(s) planned.`);
if (!apply) {
  console.log("Dry run. Re-run with --apply to write.");
  process.exit(0);
}

// One transaction: the plan is recomputed on the transaction's reads so a
// record changed since the dry run aborts the commit instead of being overwritten.
const applied = await firestore.runTransaction(async (tx) => {
  const current = planAccountBackfill(await read(tx));
  if (current.problems.length) throw new Error(`Records changed since planning: ${JSON.stringify(current.problems)}`);
  for (const write of current.writes) tx.write(write);
  return current.writes.length;
});
console.log(`Applied ${applied} write(s) on ${target}.`);
