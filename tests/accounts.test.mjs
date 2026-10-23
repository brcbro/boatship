import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFirestore } from "../lib/firestore/memory.ts";
import { setFirestoreForTests } from "../lib/firestore/index.ts";
import { planAccountBackfill } from "../scripts/lib/account-backfill.mjs";

process.env.ALLOW_LOCAL_STORE = "0";
process.env.NODE_ENV = "test";

const { getStore, resetSnapshotCache } = await import("../lib/store.ts");
const { clearSessionCache } = await import("../lib/session-cache.ts");
const { createDatabaseSession, verifyIdToken, getSessionFromRequest, listDatabaseSessions, rotateDatabaseSession, sessionPublicId } = await import("../lib/auth.ts");
const {
  inviteAccount, redeemCredentialAction, issuePasswordReset, applyAccountChange, setAccountStatus, listCredentialActions,
  AccountError, CREDENTIAL_ACTIONS, IDENTITY_EMAIL_CLAIMS, ACCOUNT_AUDIT_EVENTS, ACCOUNT_MAIL_INTENTS, STAFF_INVITATION_TTL_MS, CLIENT_INVITATION_TTL_MS, emailClaimId,
} = await import("../lib/accounts.ts");
const { hashPassword, verifyPassword } = await import("../lib/password.ts");
const { accountStatus } = await import("../lib/account-status.ts");

const admin = { uid: "admin", email: "admin@example.com", name: "Admin", role: "admin", clientId: null, permissions: [] };

function fresh() {
  const db = new MemoryFirestore();
  setFirestoreForTests(db);
  resetSnapshotCache();
  clearSessionCache();
  return db;
}

async function seedAdmin() {
  const store = await getStore();
  await store.upsertUser({ ...admin, createdAt: new Date().toISOString(), passwordHash: hashPassword("admin-password-1"), status: "active", authzVersion: 0 });
  return store;
}

const staffInvite = (email, name = "New Person") => ({
  actor: admin, email, name, role: "team", clientId: null, permissions: ["clients.view"], ttlMs: STAFF_INVITATION_TTL_MS,
  resolveExisting: () => { throw new AccountError("A team member with this email already exists", 400, "email_conflict"); },
  buildEmail: ({ token }) => ({ to: email, subject: "Invite", html: `<a href="https://x/login?reset=${token}">set</a>` }),
});

const clientInvite = (email, clientId, name = "Client Person") => ({
  actor: admin, email, name, role: "client", clientId, ttlMs: CLIENT_INVITATION_TTL_MS,
  resolveExisting: (existing) => { if (existing.role !== "client" || existing.clientId !== clientId) throw new AccountError("conflict", 400, "email_conflict"); return "reuse"; },
  buildEmail: ({ token }) => ({ to: email, subject: "Invite", html: token }),
});

test("a profile save replaces only its own fields and never overwrites a concurrent credential change", async () => {
  fresh();
  const store = await seedAdmin();
  const before = await store.getUser("admin");
  // A password change lands while an older copy of the user is still in hand.
  await applyAccountChange({ uid: "admin", bumpAuthz: true, patch: () => ({ passwordHash: hashPassword("rotated-password-1") }), audit: { action: "credential.password.changed", actor: admin } });
  const renamed = await store.updateUserFields("admin", { name: "Renamed" });
  assert.equal(renamed.name, "Renamed");
  assert.ok(verifyPassword("rotated-password-1", renamed.passwordHash), "the newer password hash survived the name save");
  assert.equal(renamed.authzVersion, 1);
  assert.notEqual(renamed.passwordHash, before.passwordHash);
  await assert.rejects(store.updateUserFields("ghost", { name: "x" }), /No document to update|does not exist/);
  const audit = await ACCOUNT_AUDIT_EVENTS.find([{ field: "targetUserId", op: "==", value: "admin" }]);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "credential.password.changed");
  assert.equal(JSON.stringify(audit[0]).includes("rotated-password-1"), false);
});

test("concurrent staff invitations for one address create one identity and one claim", async () => {
  const db = fresh();
  await seedAdmin();
  const results = await Promise.allSettled([inviteAccount(staffInvite("Dup@Example.com")), inviteAccount(staffInvite("dup@example.com"))]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one invitation creates the account");
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /already exists/);
  const profiles = await db.query({ collection: "UserProfile", where: [{ field: "email", op: "==", value: "dup@example.com" }] });
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].data.status, "invited");
  assert.equal(profiles[0].data.passwordHash, null);
  assert.equal(profiles[0].data.inviteToken, null, "no token is stored on the user");
  const claim = await IDENTITY_EMAIL_CLAIMS.get(emailClaimId("dup@example.com"));
  assert.equal(claim.userId, profiles[0].id);
  const actions = await CREDENTIAL_ACTIONS.find([{ field: "userId", op: "==", value: profiles[0].id }]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].purpose, "invite");
  assert.equal(actions[0].tokenHash.length, 64);
  const intents = await ACCOUNT_MAIL_INTENTS.find([{ field: "userId", op: "==", value: profiles[0].id }]);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].status, "sent", "the demo mailer accepts the message");
});

test("an invitation link is consumed exactly once and activates the account", async () => {
  fresh();
  await seedAdmin();
  let token;
  const result = await inviteAccount({ ...staffInvite("once@example.com"), buildEmail: ({ token: raw }) => { token = raw; return { to: "once@example.com", subject: "s", html: "h" }; } });
  assert.equal(result.created, true);
  assert.equal(accountStatus(result.user), "invited");
  assert.equal(await verifyIdToken(await createDatabaseSession({ uid: result.user.uid, email: "once@example.com", name: "N", role: "team", clientId: null })), null, "an invited account cannot hold a session");

  const hashes = [hashPassword("first-choice-123"), hashPassword("second-choice-123")];
  const redemptions = await Promise.allSettled(hashes.map((passwordHash) => redeemCredentialAction({ token, purposes: ["invite", "password_reset"], passwordHash })));
  assert.equal(redemptions.filter((item) => item.status === "fulfilled").length, 1, "one redemption wins");
  assert.equal(redemptions.filter((item) => item.status === "rejected").length, 1);
  const winner = redemptions.find((item) => item.status === "fulfilled").value.user;
  assert.equal(accountStatus(winner), "active");
  assert.equal(winner.mustResetPassword, false);
  assert.ok(hashes.includes(winner.passwordHash));
  await assert.rejects(redeemCredentialAction({ token, purposes: ["invite"], passwordHash: hashPassword("third-choice-123") }), /Invalid or expired/);
  const [action] = await listCredentialActions(winner.uid);
  assert.ok(action.consumedAt);
  const session = await createDatabaseSession({ uid: winner.uid, email: winner.email, name: winner.name, role: "team", clientId: null, permissions: ["clients.view"] });
  assert.equal((await verifyIdToken(session))?.uid, winner.uid, "the activated account signs in");
});

test("re-inviting an active client user keeps their password and revokes the earlier link", async () => {
  fresh();
  const store = await seedAdmin();
  // A record from before claims existed: no claim document, password set.
  await store.upsertUser({ uid: "c1", email: "client@example.com", name: "Cara", role: "client", clientId: "client_a", createdAt: new Date().toISOString(), passwordHash: hashPassword("client-password-1"), status: "active", authzVersion: 2 });
  const first = await inviteAccount(clientInvite("client@example.com", "client_a"));
  assert.equal(first.created, false);
  assert.equal(first.existingCredentialsKept, true);
  const second = await inviteAccount(clientInvite("client@example.com", "client_a", "Cara Updated"));
  const user = await store.getUser("c1");
  assert.ok(verifyPassword("client-password-1", user.passwordHash), "password untouched");
  assert.equal(Boolean(user.mustResetPassword), false, "no reset forced");
  assert.equal(accountStatus(user), "active");
  assert.equal(user.name, "Cara Updated");
  assert.equal(user.authzVersion, 2, "sessions are not invalidated by a re-invitation");
  assert.equal((await IDENTITY_EMAIL_CLAIMS.get(emailClaimId("client@example.com"))).userId, "c1", "the claim is written for the legacy record");
  const actions = await listCredentialActions("c1");
  assert.equal(actions.length, 2);
  assert.equal(actions.filter((action) => !action.revokedAt && !action.consumedAt).length, 1, "only the newest link is live");
  await assert.rejects(inviteAccount(clientInvite("client@example.com", "client_b")), /conflict/);
  assert.equal(second.user.uid, "c1");
});

test("a failed invitation email is recorded truthfully and a retry reuses the same account", async () => {
  fresh();
  await seedAdmin();
  const previous = { key: process.env.ZEPTOMAIL_API_KEY, from: process.env.ZEPTOMAIL_FROM, fetch: globalThis.fetch };
  process.env.ZEPTOMAIL_API_KEY = "test-key";
  process.env.ZEPTOMAIL_FROM = "noreply@example.com";
  globalThis.fetch = async () => { throw new Error("provider unreachable"); };
  try {
    const failed = await inviteAccount(staffInvite("flaky@example.com"));
    assert.equal(failed.delivery.status, "failed");
    const [intent] = await ACCOUNT_MAIL_INTENTS.find([{ field: "userId", op: "==", value: failed.user.uid }]);
    assert.equal(intent.status, "failed");
    assert.equal(intent.attempts, 1);
    assert.match(intent.lastError, /unreachable/);
    globalThis.fetch = async () => new Response(JSON.stringify({ request_id: "req_1" }), { status: 200 });
    const retried = await inviteAccount({ ...staffInvite("flaky@example.com"), resolveExisting: () => "reuse" });
    assert.equal(retried.user.uid, failed.user.uid, "no duplicate identity");
    assert.equal(retried.delivery.status, "sent");
    assert.equal((await ACCOUNT_MAIL_INTENTS.find([{ field: "userId", op: "==", value: failed.user.uid }])).length, 2);
  } finally {
    process.env.ZEPTOMAIL_API_KEY = previous.key;
    process.env.ZEPTOMAIL_FROM = previous.from;
    if (previous.key === undefined) delete process.env.ZEPTOMAIL_API_KEY;
    if (previous.from === undefined) delete process.env.ZEPTOMAIL_FROM;
    globalThis.fetch = previous.fetch;
  }
});

test("suspension denies mutations at once on every runtime and reads after the memo expires", async () => {
  const db = fresh();
  await seedAdmin();
  const token = await createDatabaseSession(admin);
  assert.equal((await verifyIdToken(token))?.uid, "admin");

  // Another runtime instance suspends the user: the change reaches the
  // database but not this instance's memo.
  const profile = await db.get("UserProfile", "admin");
  await db.commit([{ update: { collection: "UserProfile", id: "admin", data: { status: "suspended", authzVersion: profile.data.authzVersion + 1 } } }]);
  const cookie = `boatship_session=${encodeURIComponent(token)}`;
  assert.equal((await getSessionFromRequest(new Request("https://app.example/api/account", { method: "GET", headers: { cookie } })))?.uid, "admin", "a read may still be served from the memo");
  assert.equal(await getSessionFromRequest(new Request("https://app.example/api/account", { method: "PATCH", headers: { cookie } })), null, "a mutation is verified against the database");
  assert.equal(await verifyIdToken(token, { authoritative: true }), null);
  clearSessionCache();
  assert.equal(await verifyIdToken(token), null, "after the memo the read path denies too");
  assert.equal(await db.get("AuthSession", (await import("node:crypto")).createHash("sha256").update(token).digest("hex")), null, "the stale session record is removed when it fails verification");

  // The local path: status changes made here clear the memo immediately.
  const again = await createDatabaseSession({ ...admin }, { authzVersion: profile.data.authzVersion + 1 });
  await db.commit([{ update: { collection: "UserProfile", id: "admin", data: { status: "active" } } }]);
  assert.equal((await verifyIdToken(again))?.uid, "admin");
  await setAccountStatus({ uid: "admin", status: "suspended", actor: "system", reason: "test" });
  assert.equal(await verifyIdToken(again), null);
  assert.equal((await listDatabaseSessions("admin")).length, 0);
  const reactivated = await setAccountStatus({ uid: "admin", status: "active", actor: "system" });
  assert.equal(await verifyIdToken(again), null, "reactivation restores no old session");
  assert.equal(reactivated.authzVersion, profile.data.authzVersion + 3);
  const events = (await ACCOUNT_AUDIT_EVENTS.find([{ field: "targetUserId", op: "==", value: "admin" }])).map((event) => event.action).sort();
  assert.deepEqual(events, ["account.status.active", "account.status.suspended"]);
});

test("a password reset never reactivates a suspended account, and an old invite link cannot either", async () => {
  fresh();
  const store = await seedAdmin();
  let token;
  const invited = await inviteAccount({ ...staffInvite("later@example.com"), buildEmail: ({ token: raw }) => { token = raw; return { to: "later@example.com", subject: "s", html: "h" }; } });
  await setAccountStatus({ uid: invited.user.uid, status: "suspended", actor: admin, reason: "left before joining" });
  await assert.rejects(redeemCredentialAction({ token, purposes: ["invite"], passwordHash: hashPassword("whatever-123") }), /cannot sign in/);
  assert.equal(accountStatus(await store.getUser(invited.user.uid)), "suspended");
  assert.equal(await issuePasswordReset({ user: await store.getUser(invited.user.uid) }), null);
  await assert.rejects(inviteAccount({ ...staffInvite("later@example.com"), resolveExisting: () => "reuse" }), /not active/);

  // An active account's reset: earlier reset links die when a new one is issued.
  const first = await issuePasswordReset({ user: await store.getUser("admin") });
  const second = await issuePasswordReset({ user: await store.getUser("admin") });
  await assert.rejects(redeemCredentialAction({ token: first.token, purposes: ["password_reset"], passwordHash: hashPassword("new-admin-pass-1") }), /Invalid or expired/);
  const { user } = await redeemCredentialAction({ token: second.token, purposes: ["password_reset"], passwordHash: hashPassword("new-admin-pass-1") });
  assert.ok(verifyPassword("new-admin-pass-1", user.passwordHash));
  await assert.rejects(redeemCredentialAction({ token: second.token, purposes: ["invite"], passwordHash: hashPassword("x") }), /Invalid or expired/, "a token is bound to its purpose and single use");
});

test("sessions are named by opaque public ids and rotate after a credential change", async () => {
  fresh();
  await seedAdmin();
  const token = await createDatabaseSession(admin);
  const other = await createDatabaseSession(admin);
  const records = await listDatabaseSessions("admin");
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.match(sessionPublicId(record), /^ses_[0-9a-f]{32}$/);
    assert.notEqual(sessionPublicId(record), record.tokenHash);
    assert.equal(record.authzVersion, 0);
  }
  const legacy = sessionPublicId({ tokenHash: "a".repeat(64) });
  assert.match(legacy, /^legacy_[0-9a-f]{32}$/);

  const updated = await applyAccountChange({ uid: "admin", bumpAuthz: true, patch: () => ({ passwordHash: hashPassword("another-pass-1") }) });
  const rotated = await rotateDatabaseSession(token, admin, { authzVersion: updated.authzVersion });
  assert.equal(rotated.revoked, 1, "one other session was signed out");
  assert.equal(await verifyIdToken(token), null, "the old current session is gone");
  assert.equal(await verifyIdToken(other), null);
  assert.equal((await verifyIdToken(rotated.token))?.uid, "admin");
  assert.equal((await listDatabaseSessions("admin")).length, 1);
});

test("the backfill planner adds status, version and claims, and refuses to guess", () => {
  const profiles = [
    { uid: "a", email: "A@x.io", mustResetPassword: false, passwordHash: "s:h" },
    { uid: "b", email: "b@x.io", mustResetPassword: true, passwordHash: null, password: null, inviteToken: "legacy" },
    { uid: "c", email: "c@x.io", status: "active", authzVersion: 3 },
  ];
  const plan = planAccountBackfill({ profiles, claims: [] });
  assert.equal(plan.problems.length, 0);
  assert.deepEqual(plan.summary, { profiles: 3, statusAdded: 2, versionAdded: 2, claimsAdded: 3, legacyLinks: 1, duplicateEmails: 0, missingEmails: 0 });
  const updates = plan.writes.filter((write) => write.update);
  assert.equal(updates.find((write) => write.update.id === "a").update.data.status, "active");
  assert.equal(updates.find((write) => write.update.id === "b").update.data.status, "invited");
  assert.equal(updates.some((write) => write.update.id === "c"), false, "already current records are untouched");

  const dup = planAccountBackfill({ profiles: [...profiles, { uid: "d", email: "a@x.io" }], claims: [{ id: "zz", email: "c@x.io", userId: "gone" }] });
  assert.equal(dup.problems.length, 2);
  assert.match(dup.problems[0].problem, /owned by 2 profiles/);
  assert.match(dup.problems[1].problem, /missing user/);
});
