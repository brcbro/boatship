import { createHash, randomBytes, randomUUID } from "crypto";
import type { AccountStatus, AppUser, AuthSession, StaffPermission, UserRole } from "@/types";
import { accountCanAuthenticate, accountStatus, currentAuthzVersion } from "@/lib/account-status";
import { revokeOtherDatabaseSessions } from "@/lib/auth";
import { sendEmail, type EmailPayload } from "@/lib/email";
import { Collection, getFirestore, isFirestoreStatus, isLocalDemoStore, MemoryFirestore, nowIso, type FirestoreClient, type FirestoreTransaction, type FsData } from "@/lib/firestore";
import { DEFAULT_TEAM_PERMISSIONS } from "@/lib/rbac";
import { forgetUserSessions } from "@/lib/session-cache";
import { appUserFromProfile, getStore, userProfileData, userProfilePatch, USER_PROFILES, type UserFieldPatch, type UserProfileDoc } from "@/lib/store";

/*
 * Account foundations (plan phase 0, 2026-10-23).
 *
 * Every record here lives in its own collection next to `UserProfile`:
 *
 * - CredentialAction: one hashed, purpose-bound, single-use token (invitation
 *   setup, password reset). Replaces the `inviteToken` field on the user.
 * - IdentityEmailClaim: the unique owner of a normalised login address. The
 *   JSON table has no unique index on `email`, so concurrent invitations claim
 *   the address with an exists:false precondition inside the transaction that
 *   creates the user.
 * - AccountAuditEvent: append-only, sanitised record of account changes. It is
 *   independent of client activity and survives client deletion.
 * - AccountMailIntent: durable record of an account email (invitation, reset)
 *   committed with the change it belongs to; delivery happens afterwards and
 *   its outcome is written back.
 *
 * Writes that must be atomic (claim + user + action + audit + intent, or token
 * consumption + credential update) run in one storage transaction on the
 * hosted store. The file-based local demo has no transactional client, so the
 * auxiliary records go to an in-memory client there and the user update is a
 * separate write; that mode is for development only.
 */

export type CredentialPurpose = "invite" | "password_reset";

export type CredentialActionDoc = {
  id: string;
  purpose: CredentialPurpose;
  userId: string;
  /** SHA-256 of the raw token; the token itself is only ever in the email link. */
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  correlationId: string;
};
export const CREDENTIAL_ACTIONS = new Collection<CredentialActionDoc>("CredentialAction", accountsClient);

export type IdentityEmailClaimDoc = { email: string; userId: string; createdAt: string; updatedAt: string };
export const IDENTITY_EMAIL_CLAIMS = new Collection<IdentityEmailClaimDoc>("IdentityEmailClaim", accountsClient);

export type AccountAuditResult = "ok" | "denied" | "failed";
export type AccountAuditEventDoc = {
  id: string;
  action: string;
  actorId: string | null;
  actorRole: UserRole | "system" | null;
  targetUserId: string | null;
  result: AccountAuditResult;
  reason: string | null;
  correlationId: string;
  metadata: FsData;
  createdAt: string;
};
export const ACCOUNT_AUDIT_EVENTS = new Collection<AccountAuditEventDoc>("AccountAuditEvent", accountsClient);

export type MailIntentStatus = "queued" | "sent" | "failed";
export type AccountMailIntentDoc = {
  id: string;
  kind: "invitation" | "password_reset";
  userId: string;
  to: string;
  status: MailIntentStatus;
  attempts: number;
  providerMessageId: string | null;
  lastError: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};
export const ACCOUNT_MAIL_INTENTS = new Collection<AccountMailIntentDoc>("AccountMailIntent", accountsClient);

export const STAFF_INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const CLIENT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** One policy for setup, reset and change. Returns the message to show, or null when acceptable. */
export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== "string") return "Password is required";
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

export class AccountError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "AccountError";
  }
}

let demoClient: MemoryFirestore | null = null;
function accountsClient(): FirestoreClient {
  if (isLocalDemoStore()) {
    // The local demo persists users in a JSON file; its account records are
    // kept in memory for the life of the process.
    if (!demoClient) demoClient = new MemoryFirestore();
    return demoClient;
  }
  return getFirestore();
}

/** Hosted stores keep the profile document in the same transaction; the demo store cannot. */
function profilesAreTransactional() {
  return !isLocalDemoStore();
}

/**
 * A concurrent invitation of the same address makes the claim's exists:false
 * precondition fail after the transaction body ran; re-running the body sees
 * the committed claim and takes the existing-account branch.
 */
async function retryOnConflict<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isFirestoreStatus(error, "ALREADY_EXISTS", "ABORTED", "FAILED_PRECONDITION")) throw error;
    }
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function emailClaimId(email: string) {
  // The address itself is not a safe document id (it may contain "/"), so the
  // claim is keyed by its hash and stores the address for inspection.
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export function hashCredentialToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newCredentialToken() {
  return randomBytes(32).toString("base64url");
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): FsData {
  const out: FsData = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (/token|password|secret|hash/i.test(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

type AuditInput = {
  action: string;
  actor: Pick<AuthSession, "uid" | "role"> | "system" | null;
  targetUserId: string | null;
  result?: AccountAuditResult;
  reason?: string | null;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

function auditDocument(input: AuditInput): AccountAuditEventDoc {
  return {
    id: randomUUID(),
    action: input.action,
    actorId: input.actor && input.actor !== "system" ? input.actor.uid : null,
    actorRole: input.actor === "system" ? "system" : input.actor?.role ?? null,
    targetUserId: input.targetUserId,
    result: input.result ?? "ok",
    reason: input.reason ?? null,
    correlationId: input.correlationId ?? randomUUID(),
    metadata: sanitizeMetadata(input.metadata),
    createdAt: nowIso(),
  };
}

/** Appends an audit event outside a transaction (denied attempts, delivery outcomes). */
export async function recordAccountAudit(input: AuditInput) {
  const doc = auditDocument(input);
  await ACCOUNT_AUDIT_EVENTS.create(doc.id, doc);
  return doc;
}

function writeAudit(tx: FirestoreTransaction, input: AuditInput) {
  const doc = auditDocument(input);
  tx.write({ set: { collection: ACCOUNT_AUDIT_EVENTS.name, id: doc.id, data: doc, precondition: { exists: false } } });
  return doc;
}

export async function listAccountAuditEvents(targetUserId: string, limit = 50) {
  return ACCOUNT_AUDIT_EVENTS.find([{ field: "targetUserId", op: "==", value: targetUserId }], { orderBy: [{ field: "createdAt", direction: "desc" }], limit });
}

async function readProfile(tx: FirestoreTransaction, uid: string): Promise<{ doc: UserProfileDoc; user: AppUser } | null> {
  const snapshot = await tx.get<UserProfileDoc>(USER_PROFILES.name, uid);
  if (!snapshot) return null;
  return { doc: snapshot.data, user: appUserFromProfile(snapshot.data) };
}

/**
 * Applies a partial change to one account atomically. The patch is computed
 * from the current record inside the transaction, so a concurrent change to
 * other fields is never overwritten and `authzVersion` increments exactly
 * once per committed change when `bumpAuthz` is set. Returns the stored user.
 */
export async function applyAccountChange(input: {
  uid: string;
  patch: (current: AppUser) => UserFieldPatch | null;
  bumpAuthz?: boolean;
  audit?: Omit<AuditInput, "targetUserId">;
}): Promise<AppUser> {
  const store = await getStore();
  if (!profilesAreTransactional()) {
    const current = await store.getUser(input.uid);
    if (!current) throw new AccountError("User not found", 404, "user_not_found");
    const patch = input.patch(current);
    if (!patch) return current;
    const next = await store.updateUserFields(input.uid, { ...patch, ...(input.bumpAuthz ? { authzVersion: currentAuthzVersion(current) + 1 } : {}) });
    if (input.audit) await recordAccountAudit({ ...input.audit, targetUserId: input.uid });
    return next;
  }
  const uid = await getFirestore().runTransaction(async (tx) => {
    const current = await readProfile(tx, input.uid);
    if (!current) throw new AccountError("User not found", 404, "user_not_found");
    const patch = input.patch(current.user);
    if (!patch) return null;
    const data = userProfilePatch({ ...patch, ...(input.bumpAuthz ? { authzVersion: currentAuthzVersion(current.user) + 1 } : {}) });
    tx.write({ update: { collection: USER_PROFILES.name, id: input.uid, data: data as FsData, precondition: { exists: true } } });
    if (input.audit) writeAudit(tx, { ...input.audit, targetUserId: input.uid });
    return input.uid;
  });
  if (uid === null) return (await store.getUser(input.uid))!;
  const synced = await store.syncUserProfile(input.uid);
  if (!synced) throw new AccountError("User not found", 404, "user_not_found");
  return synced;
}

/** Suspend, reactivate or deactivate. Every issued session becomes invalid with the new authz version. */
export async function setAccountStatus(input: {
  uid: string;
  status: AccountStatus;
  actor: Pick<AuthSession, "uid" | "role"> | "system";
  reason?: string | null;
}): Promise<AppUser> {
  const stamp = nowIso();
  const user = await applyAccountChange({
    uid: input.uid,
    bumpAuthz: true,
    patch: (current) => (accountStatus(current) === input.status ? null : {
      status: input.status,
      statusChangedAt: stamp,
      statusReason: input.reason ?? null,
    }),
    audit: { action: `account.status.${input.status}`, actor: input.actor, reason: input.reason ?? null },
  });
  // Session records are deleted so the list is honest; the version bump is
  // what denies a record that another runtime still holds.
  await revokeOtherDatabaseSessions(input.uid, null);
  forgetUserSessions(input.uid);
  return user;
}

/** Pending invitation/reset links for a user, newest first; never includes the token. */
export async function listCredentialActions(userId: string) {
  return CREDENTIAL_ACTIONS.find([{ field: "userId", op: "==", value: userId }], { orderBy: [{ field: "createdAt", direction: "desc" }] });
}

export function credentialActionIsRedeemable(action: Pick<CredentialActionDoc, "consumedAt" | "revokedAt" | "expiresAt">, at = Date.now()) {
  return !action.consumedAt && !action.revokedAt && new Date(action.expiresAt).getTime() > at;
}

function revokePendingActions(tx: FirestoreTransaction, pending: CredentialActionDoc[], stamp: string) {
  for (const action of pending) {
    if (!credentialActionIsRedeemable(action)) continue;
    tx.write({ update: { collection: CREDENTIAL_ACTIONS.name, id: action.id, data: { revokedAt: stamp }, precondition: { exists: true } } });
  }
}

function newCredentialAction(input: { userId: string; purpose: CredentialPurpose; ttlMs: number; createdBy: string | null; correlationId: string }) {
  const token = newCredentialToken();
  const stamp = nowIso();
  const doc: CredentialActionDoc = {
    id: randomUUID(),
    purpose: input.purpose,
    userId: input.userId,
    tokenHash: hashCredentialToken(token),
    expiresAt: new Date(Date.now() + input.ttlMs).toISOString(),
    consumedAt: null,
    revokedAt: null,
    createdAt: stamp,
    createdBy: input.createdBy,
    correlationId: input.correlationId,
  };
  return { token, doc };
}

function newMailIntent(input: { kind: AccountMailIntentDoc["kind"]; userId: string; to: string; correlationId: string }): AccountMailIntentDoc {
  const stamp = nowIso();
  return { id: randomUUID(), kind: input.kind, userId: input.userId, to: input.to, status: "queued", attempts: 0, providerMessageId: null, lastError: null, correlationId: input.correlationId, createdAt: stamp, updatedAt: stamp, sentAt: null };
}

export type DeliveryOutcome = { status: "sent" | "failed"; intentId: string; error?: string };

/**
 * Sends the email for a committed intent and records the outcome. Provider
 * acceptance is recorded as `sent`; it is not proof the person received it.
 */
export async function deliverMailIntent(intent: AccountMailIntentDoc, payload: EmailPayload): Promise<DeliveryOutcome> {
  const stamp = nowIso();
  try {
    const result = await sendEmail(payload);
    await ACCOUNT_MAIL_INTENTS.update(intent.id, { status: "sent", attempts: intent.attempts + 1, providerMessageId: result.id, lastError: null, sentAt: stamp, updatedAt: stamp });
    return { status: "sent", intentId: intent.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed";
    await ACCOUNT_MAIL_INTENTS.update(intent.id, { status: "failed", attempts: intent.attempts + 1, lastError: message.slice(0, 300), updatedAt: stamp }).catch((updateError) => console.error("Mail intent update failed", updateError));
    await recordAccountAudit({ action: `mail.${intent.kind}.failed`, actor: "system", targetUserId: intent.userId, result: "failed", reason: message.slice(0, 300), correlationId: intent.correlationId }).catch(() => undefined);
    return { status: "failed", intentId: intent.id, error: message };
  }
}

/**
 * Issues a password-reset link for an existing account. Earlier pending reset
 * links are revoked. The raw token is returned once for the email and never
 * stored. Does nothing for accounts that cannot sign in again (suspended,
 * deactivated): a reset must not reactivate them.
 */
export async function issuePasswordReset(input: { user: AppUser; correlationId?: string }): Promise<{ token: string; intent: AccountMailIntentDoc } | null> {
  const status = accountStatus(input.user);
  if (status === "suspended" || status === "deactivated") {
    await recordAccountAudit({ action: "credential.password_reset.denied", actor: "system", targetUserId: input.user.uid, result: "denied", reason: `account ${status}`, correlationId: input.correlationId });
    return null;
  }
  const correlationId = input.correlationId ?? randomUUID();
  const { token, doc } = newCredentialAction({ userId: input.user.uid, purpose: "password_reset", ttlMs: PASSWORD_RESET_TTL_MS, createdBy: null, correlationId });
  const intent = newMailIntent({ kind: "password_reset", userId: input.user.uid, to: input.user.email, correlationId });
  await accountsClient().runTransaction(async (tx) => {
    const pending = await tx.query<CredentialActionDoc>(CREDENTIAL_ACTIONS.spec([{ field: "userId", op: "==", value: input.user.uid }, { field: "purpose", op: "==", value: "password_reset" }]));
    revokePendingActions(tx, pending.map((item) => item.data), doc.createdAt);
    tx.write({ set: { collection: CREDENTIAL_ACTIONS.name, id: doc.id, data: doc, precondition: { exists: false } } });
    tx.write({ set: { collection: ACCOUNT_MAIL_INTENTS.name, id: intent.id, data: intent, precondition: { exists: false } } });
    writeAudit(tx, { action: "credential.password_reset.issued", actor: "system", targetUserId: input.user.uid, correlationId, metadata: { expiresAt: doc.expiresAt } });
  });
  return { token, intent };
}

export type RedeemedCredential = { user: AppUser; action: CredentialActionDoc };

/**
 * Consumes a setup/reset token and sets the password in one transaction. Two
 * concurrent redemptions of the same token elect one winner; the other sees
 * the token as already used. Suspended and deactivated accounts cannot redeem.
 */
export async function redeemCredentialAction(input: { token: string; purposes: CredentialPurpose[]; passwordHash: string }): Promise<RedeemedCredential> {
  const token = input.token.trim();
  if (!token) throw new AccountError("Invalid or expired reset link", 400, "credential_invalid");
  const tokenHash = hashCredentialToken(token);
  const stamp = nowIso();
  const client = accountsClient();
  const store = await getStore();

  const outcome = await client.runTransaction(async (tx) => {
    const [found] = await tx.query<CredentialActionDoc>(CREDENTIAL_ACTIONS.spec([{ field: "tokenHash", op: "==", value: tokenHash }], { limit: 1 }));
    if (!found) return { kind: "missing" as const };
    const action = found.data;
    if (!input.purposes.includes(action.purpose) || !credentialActionIsRedeemable(action)) return { kind: "unusable" as const, action };

    let current: AppUser | null;
    if (profilesAreTransactional()) current = (await readProfile(tx, action.userId))?.user ?? null;
    else current = await store.getUser(action.userId);
    if (!current) return { kind: "unusable" as const, action };
    const status = accountStatus(current);
    if (status === "suspended" || status === "deactivated") {
      writeAudit(tx, { action: `credential.${action.purpose}.denied`, actor: "system", targetUserId: current.uid, result: "denied", reason: `account ${status}`, correlationId: action.correlationId });
      return { kind: "denied" as const, action, status };
    }

    const patch: UserFieldPatch = {
      password: null,
      passwordHash: input.passwordHash,
      mustResetPassword: false,
      inviteToken: null,
      inviteTokenExpiresAt: null,
      status: "active",
      ...(status === "invited" ? { statusChangedAt: stamp, statusReason: null } : {}),
      authzVersion: currentAuthzVersion(current) + 1,
    };
    tx.write({ update: { collection: CREDENTIAL_ACTIONS.name, id: action.id, data: { consumedAt: stamp }, precondition: { updateTime: found.updateTime! } } });
    if (profilesAreTransactional()) {
      tx.write({ update: { collection: USER_PROFILES.name, id: current.uid, data: userProfilePatch(patch) as FsData, precondition: { exists: true } } });
    }
    writeAudit(tx, { action: `credential.${action.purpose}.redeemed`, actor: { uid: current.uid, role: current.role }, targetUserId: current.uid, correlationId: action.correlationId, metadata: { activated: status === "invited" } });
    return { kind: "redeemed" as const, action, patch, uid: current.uid };
  });

  if (outcome.kind === "missing" || outcome.kind === "unusable") throw new AccountError("Invalid or expired reset link", 400, "credential_invalid");
  if (outcome.kind === "denied") throw new AccountError("This account cannot sign in. Contact an administrator.", 403, "account_inactive");

  const user = profilesAreTransactional()
    ? await store.syncUserProfile(outcome.uid)
    : await store.updateUserFields(outcome.uid, outcome.patch);
  if (!user) throw new AccountError("User not found", 404, "user_not_found");
  forgetUserSessions(user.uid);
  return { user, action: outcome.action };
}

export type InviteInput = {
  actor: Pick<AuthSession, "uid" | "role">;
  email: string;
  name: string;
  role: UserRole;
  clientId: string | null;
  /** Staff only; omitted keeps the role defaults, `[]` denies all. */
  permissions?: StaffPermission[];
  ttlMs: number;
  /**
   * Decides what to do with an account that already owns the address. Throw an
   * AccountError to refuse; return "reuse" to send a new link to it.
   */
  resolveExisting: (existing: AppUser) => "reuse";
  /** Builds the email once the link exists. The raw token appears only in that URL. */
  buildEmail: (input: { token: string; user: AppUser }) => EmailPayload;
  correlationId?: string;
};

export type InviteResult = {
  user: AppUser;
  created: boolean;
  /** True when the account already had a usable password; its credentials were left untouched. */
  existingCredentialsKept: boolean;
  delivery: DeliveryOutcome;
};

/**
 * Creates or re-invites an account and sends its setup link.
 *
 * In one transaction: the normalised address is claimed (so two concurrent
 * invitations for one address create one identity), the profile is created
 * with status `invited` or left as it is, earlier pending invitation links are
 * revoked, the new hashed link and a queued mail intent are stored, and the
 * audit event is written. The email is sent after the commit and its outcome
 * is recorded on the intent; a failed send leaves a consistent record that a
 * later invitation of the same address replaces instead of duplicating.
 *
 * An active account is never reset by a re-invitation: its password, status
 * and permissions stay, and the link only lets its owner choose a password.
 */
export async function inviteAccount(input: InviteInput): Promise<InviteResult> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!email || !name) throw new AccountError("Email and name are required", 400, "invalid_input");
  const correlationId = input.correlationId ?? randomUUID();
  const claimId = emailClaimId(email);
  const client = accountsClient();
  const store = await getStore();
  const stamp = nowIso();

  // Accounts created before claims existed have no claim document yet; the
  // profile query covers them and the claim is written on this invitation.
  const unclaimedOwner = await store.getUserByEmail(email);

  const committed = await retryOnConflict(() => client.runTransaction(async (tx) => {
    const claim = await tx.get<IdentityEmailClaimDoc>(IDENTITY_EMAIL_CLAIMS.name, claimId);
    const ownerId = claim?.data.userId ?? unclaimedOwner?.uid ?? null;
    let existing: AppUser | null = null;
    if (ownerId) {
      existing = profilesAreTransactional() ? (await readProfile(tx, ownerId))?.user ?? null : await store.getUser(ownerId);
      if (!existing && claim) {
        // A claim whose user was deleted outside the account service is stale; release it.
        tx.write({ delete: { collection: IDENTITY_EMAIL_CLAIMS.name, id: claimId, precondition: { updateTime: claim.updateTime! } } });
      }
    }

    let user: AppUser;
    let created = false;
    let existingCredentialsKept = false;
    if (existing) {
      input.resolveExisting(existing);
      const status = accountStatus(existing);
      if (status === "suspended" || status === "deactivated") {
        writeAudit(tx, { action: "invitation.denied", actor: input.actor, targetUserId: existing.uid, result: "denied", reason: `account ${status}`, correlationId });
        throw new AccountError("This account is not active. Reactivate it before sending a new invitation.", 409, "account_inactive");
      }
      existingCredentialsKept = Boolean(existing.passwordHash || existing.password);
      const patch: UserFieldPatch = { name, updatedAt: stamp };
      if (profilesAreTransactional()) tx.write({ update: { collection: USER_PROFILES.name, id: existing.uid, data: userProfilePatch(patch) as FsData, precondition: { exists: true } } });
      user = { ...existing, ...patch };
      if (!claim) {
        const claimDoc: IdentityEmailClaimDoc = { email, userId: existing.uid, createdAt: stamp, updatedAt: stamp };
        tx.write({ set: { collection: IDENTITY_EMAIL_CLAIMS.name, id: claimId, data: claimDoc, precondition: { exists: false } } });
      }
    } else {
      created = true;
      user = {
        uid: randomUUID(),
        email,
        name,
        role: input.role,
        clientId: input.clientId,
        createdAt: stamp,
        inviteToken: null,
        inviteTokenExpiresAt: null,
        mustResetPassword: true,
        password: null,
        passwordHash: null,
        permissions: input.role === "team" ? input.permissions ?? [...DEFAULT_TEAM_PERMISSIONS] : undefined,
        digestEnabled: false,
        lastDigestAt: null,
        status: "invited",
        authzVersion: 0,
        updatedAt: stamp,
        statusChangedAt: stamp,
        statusReason: null,
      };
      const claimDoc: IdentityEmailClaimDoc = { email, userId: user.uid, createdAt: stamp, updatedAt: stamp };
      tx.write({ set: { collection: IDENTITY_EMAIL_CLAIMS.name, id: claimId, data: claimDoc, precondition: { exists: false } } });
      if (profilesAreTransactional()) tx.write({ set: { collection: USER_PROFILES.name, id: user.uid, data: userProfileData(user) as unknown as FsData, precondition: { exists: false } } });
    }

    const pending = await tx.query<CredentialActionDoc>(CREDENTIAL_ACTIONS.spec([{ field: "userId", op: "==", value: user.uid }, { field: "purpose", op: "==", value: "invite" }]));
    revokePendingActions(tx, pending.map((item) => item.data), stamp);
    const { token, doc } = newCredentialAction({ userId: user.uid, purpose: "invite", ttlMs: input.ttlMs, createdBy: input.actor.uid, correlationId });
    tx.write({ set: { collection: CREDENTIAL_ACTIONS.name, id: doc.id, data: doc, precondition: { exists: false } } });
    const intent = newMailIntent({ kind: "invitation", userId: user.uid, to: email, correlationId });
    tx.write({ set: { collection: ACCOUNT_MAIL_INTENTS.name, id: intent.id, data: intent, precondition: { exists: false } } });
    writeAudit(tx, { action: created ? "invitation.created" : "invitation.resent", actor: input.actor, targetUserId: user.uid, correlationId, metadata: { role: user.role, clientId: user.clientId, expiresAt: doc.expiresAt, existingCredentialsKept } });
    return { user, created, existingCredentialsKept, token, intent };
  }));

  // Keep secondary copies (local demo file, legacy snapshot slice, session memo) in step.
  const stored = profilesAreTransactional()
    ? await store.syncUserProfile(committed.user.uid)
    : committed.created ? await store.upsertUser(committed.user) : await store.updateUserFields(committed.user.uid, { name, updatedAt: stamp });
  const user = stored ?? committed.user;
  forgetUserSessions(user.uid);

  const delivery = await deliverMailIntent(committed.intent, input.buildEmail({ token: committed.token, user }));
  return { user, created: committed.created, existingCredentialsKept: committed.existingCredentialsKept, delivery };
}

/** The address a user profile currently claims, when a claim exists. */
export async function findEmailClaim(email: string) {
  return IDENTITY_EMAIL_CLAIMS.get(emailClaimId(email));
}

export { accountCanAuthenticate, accountStatus };
