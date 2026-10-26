import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import type { AuthSession } from "@/types";
import { getSessionFromRequest } from "@/lib/auth";
import { Collection, getFirestore, nowIso, type FsData, type Where } from "@/lib/firestore";
import { deleteWhere } from "@/lib/firestore/bulk";
import { getStore } from "@/lib/store";
import { isUnsafeDemoUser } from "@/lib/demo-users";
import { accountCanAuthenticate, currentAuthzVersion } from "@/lib/account-status";

export const MCP_TOKEN_PREFIX = "boatship_mcp_";
export const DEFAULT_MCP_SCOPES = ["tasks:read", "projects:read", "context:read"] as const;

/**
 * Firestore documents for MCP identities; timestamps are ISO-8601 strings.
 * `authzVersion` is the owner's authz version when the token was issued; a
 * later password, reset, status, role or permission change bumps the user's
 * version and the token stops verifying, like a browser session. Identities
 * written before the field existed are treated as version 0, so they keep
 * working only for owners whose credentials never changed. `issuedBy` is the
 * uid that minted the token (the owner, or an admin acting for them).
 */
export type McpIdentityDoc = {
  id: string; publicId: string; userId: string; tokenHash: string; status: string; scopes: string[];
  lastUsedAt: string | null; revokedAt: string | null; createdAt: string; updatedAt: string;
  authzVersion?: number; issuedBy?: string | null;
};
export const MCP_IDENTITIES = new Collection<McpIdentityDoc>("McpIdentity");

/** Document id is `${identityId}__${projectId}`; `id` keeps the row id. */
export type McpProjectAccessDoc = { id: string; identityId: string; projectId: string; accessLevel: string; createdAt: string; updatedAt: string };
export const MCP_PROJECT_ACCESS = new Collection<McpProjectAccessDoc>("McpProjectAccess");
export const mcpProjectAccessId = (identityId: string, projectId: string) => `${identityId}__${projectId}`;

export type McpAuditEventDoc = {
  id: string; identityId: string; userId: string; toolName: string; resource: string | null; action: string | null; success: boolean;
  metadata: FsData | null; createdAt: string;
};
export const MCP_AUDIT_EVENTS = new Collection<McpAuditEventDoc>("McpAuditEvent");

export interface McpIdentity {
  mcpId: string;
  session: AuthSession;
  identityId?: string;
  scopes?: string[];
}

export interface IssuedMcpToken {
  publicId: string;
  token: string;
  scopes: string[];
}

export const MCP_SCOPES = [
  "tasks:read", "projects:read", "context:read", "git:validate",
  "tasks:write", "session:read", "audit:read", "subscriptions:manage",
] as const;

export interface McpTokenClaims {
  identityId: string;
  publicId: string;
  userId: string;
  scopes: string[];
}

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hashesMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeScopes(scopes?: readonly string[]) {
  return [...new Set((scopes?.length ? scopes : DEFAULT_MCP_SCOPES).map((scope) => scope.trim()).filter(Boolean))];
}

function bearerToken(req: Request) {
  const value = req.headers.get("authorization");
  return value?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
}

async function sessionForUser(userId: string, tokenAuthzVersion: number): Promise<AuthSession | null> {
  const user = await (await getStore()).getUser(userId);
  if (!user || !accountCanAuthenticate(user) || isUnsafeDemoUser(user)) return null;
  if (tokenAuthzVersion !== currentAuthzVersion(user)) return null;
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.clientId,
    permissions: user.permissions,
  };
}

/**
 * Issues an opaque MCP token. Only its SHA-256 hash is persisted. The token
 * is bound to the owner's current authz version; `issuedBy` defaults to the
 * owner.
 */
export async function issueMcpToken(userId: string, options: { scopes?: readonly string[]; projectIds?: readonly string[]; issuedBy?: string } = {}): Promise<IssuedMcpToken> {
  const identityId = randomUUID();
  const publicId = `${MCP_TOKEN_PREFIX}${randomBytes(12).toString("hex")}`;
  const token = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const scopes = normalizeScopes(options.scopes);
  const projectIds = [...new Set((options.projectIds ?? []).filter(Boolean))];
  const authzVersion = currentAuthzVersion((await (await getStore()).getUser(userId)) ?? {});

  const stamp = nowIso();
  const identity: McpIdentityDoc = { id: identityId, publicId, userId, tokenHash: hashToken(token), status: "active", scopes, lastUsedAt: null, revokedAt: null, createdAt: stamp, updatedAt: stamp, authzVersion, issuedBy: options.issuedBy ?? userId };
  await getFirestore().runTransaction(async (tx) => {
    tx.write({ set: { collection: MCP_IDENTITIES.name, id: identityId, data: identity, precondition: { exists: false } } });
    for (const projectId of projectIds) {
      const access: McpProjectAccessDoc = { id: randomUUID(), identityId, projectId, accessLevel: "read", createdAt: stamp, updatedAt: stamp };
      tx.write({ set: { collection: MCP_PROJECT_ACCESS.name, id: mcpProjectAccessId(identityId, projectId), data: access, precondition: { exists: false } } });
    }
  });
  return { publicId, token, scopes };
}

export async function findMcpIdentityByPublicId(publicId: string) {
  return MCP_IDENTITIES.findFirst([{ field: "publicId", op: "==", value: publicId }]);
}

export async function listMcpProjectAccess(identityId: string) {
  return MCP_PROJECT_ACCESS.find([{ field: "identityId", op: "==", value: identityId }]);
}

async function verifiedIdentity(token: string): Promise<McpIdentityDoc | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX)) return null;
  const tokenHash = hashToken(token);
  const identity = await MCP_IDENTITIES.findFirst([{ field: "tokenHash", op: "==", value: tokenHash }]);
  const ttlDays = Number(process.env.MCP_TOKEN_TTL_DAYS || 180);
  const expired = ttlDays > 0 && identity?.createdAt && Date.now() - new Date(identity.createdAt).getTime() > ttlDays * 86400000;
  if (!identity || !hashesMatch(identity.tokenHash, tokenHash) || identity.status !== "active" || identity.revokedAt || expired) return null;
  await MCP_IDENTITIES.update(identity.id, { lastUsedAt: nowIso() }, { exists: true });
  return identity;
}

/**
 * Verifies a raw Bearer token's record without ever persisting or returning
 * it. Owner checks (account status, authz version) are applied by
 * `resolveMcpIdentity`, which every request path goes through.
 */
export async function verifyMcpToken(token: string): Promise<McpTokenClaims | null> {
  const identity = await verifiedIdentity(token);
  if (!identity) return null;
  return { identityId: identity.id, publicId: identity.publicId, userId: identity.userId, scopes: identity.scopes };
}

/** The authz version an identity was issued under; records that predate the field count as 0. */
export function mcpIdentityAuthzVersion(identity: Pick<McpIdentityDoc, "authzVersion">) {
  return currentAuthzVersion(identity);
}

/** Revokes every active MCP identity of a user (compare-and-set per row); returns the count. */
export async function revokeUserMcpIdentities(userId: string) {
  return revokeIdentitiesWhere({ field: "userId", op: "==", value: userId });
}

async function revokeIdentitiesWhere(where: Where) {
  const count = await getFirestore().runTransaction(async (tx) => {
    const rows = await tx.query<McpIdentityDoc>(MCP_IDENTITIES.spec([where]));
    const eligible = rows.filter((row) => row.data.status !== "revoked");
    const stamp = nowIso();
    for (const row of eligible) tx.write({ update: { collection: MCP_IDENTITIES.name, id: row.id, data: { status: "revoked", revokedAt: stamp, updatedAt: stamp }, precondition: { exists: true } } });
    return eligible.length;
  });
  return { count };
}

/** Compare-and-set: only an identity that is not yet revoked is updated. */
export async function revokeMcpIdentity(publicId: string) {
  return revokeIdentitiesWhere({ field: "publicId", op: "==", value: publicId });
}

/** Removes an identity with its project access and audit events (not atomic; children first). */
export async function deleteMcpIdentity(identityId: string) {
  await deleteWhere(MCP_AUDIT_EVENTS.name, [{ field: "identityId", op: "==", value: identityId }]);
  await deleteWhere(MCP_PROJECT_ACCESS.name, [{ field: "identityId", op: "==", value: identityId }]);
  await MCP_IDENTITIES.delete(identityId);
}

export async function hasMcpScope(identityId: string, scope: string) {
  const identity = await MCP_IDENTITIES.get(identityId);
  return Boolean(identity?.scopes.includes(scope));
}

/** Resolves Bearer MCP auth, while retaining the existing session/header contract. */
export async function resolveMcpIdentity(req: Request, requiredScopes: readonly string[] = []): Promise<McpIdentity | null> {
  const suppliedPublicId = req.headers.get("x-boatship-mcp-id");
  const token = bearerToken(req);
  if (token) {
    const identity = await verifiedIdentity(token);
    if (!identity || (suppliedPublicId && suppliedPublicId !== identity.publicId)) return null;
    if (requiredScopes.some((scope) => !identity.scopes.includes(scope))) return null;
    const session = await sessionForUser(identity.userId, mcpIdentityAuthzVersion(identity));
    return session ? { mcpId: identity.publicId, session, identityId: identity.id, scopes: identity.scopes } : null;
  }

  const session = await getSessionFromRequest(req);
  if (!session) return null;
  const expected = `boatship_${session.uid}`;
  if (suppliedPublicId && suppliedPublicId !== expected) return null;
  return { mcpId: expected, session, scopes: [] };
}

export async function recordMcpAuditEvent(input: { identityId: string; userId: string; toolName: string; resource?: string; action?: string; success?: boolean; metadata?: Record<string, unknown> }) {
  const event: McpAuditEventDoc = {
    id: randomUUID(), identityId: input.identityId, userId: input.userId, toolName: input.toolName, resource: input.resource ?? null, action: input.action ?? null,
    success: input.success ?? true, metadata: input.metadata ? (input.metadata as FsData) : null, createdAt: nowIso(),
  };
  await MCP_AUDIT_EVENTS.create(event.id, event);
  return event;
}
