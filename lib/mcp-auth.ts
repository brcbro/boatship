import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import type { Prisma } from "@prisma/client";
import type { AuthSession } from "@/types";
import { getSessionFromRequest } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";

export const MCP_TOKEN_PREFIX = "boatship_mcp_";
export const DEFAULT_MCP_SCOPES = ["tasks:read", "projects:read", "context:read"] as const;

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

async function sessionForUser(userId: string): Promise<AuthSession | null> {
  const user = await (await getStore()).getUser(userId);
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    clientId: user.clientId,
    permissions: user.permissions,
  };
}

/** Issues an opaque MCP token. Only its SHA-256 hash is persisted. */
export async function issueMcpToken(userId: string, options: { scopes?: readonly string[]; projectIds?: readonly string[] } = {}): Promise<IssuedMcpToken> {
  const identityId = randomUUID();
  const publicId = `${MCP_TOKEN_PREFIX}${randomBytes(12).toString("hex")}`;
  const token = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const scopes = normalizeScopes(options.scopes);
  const projectIds = [...new Set((options.projectIds ?? []).filter(Boolean))];

  await getPrisma().mcpIdentity.create({
    data: {
      id: identityId,
      publicId,
      userId,
      tokenHash: hashToken(token),
      scopes,
      projectAccess: { create: projectIds.map((projectId) => ({ id: randomUUID(), projectId, accessLevel: "read" })) },
    },
  });
  return { publicId, token, scopes };
}

/** Verifies a raw Bearer token without ever persisting or returning it. */
export async function verifyMcpToken(token: string): Promise<McpTokenClaims | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX)) return null;
  const tokenHash = hashToken(token);
  const identity = await getPrisma().mcpIdentity.findUnique({
    where: { tokenHash },
    select: { id: true, publicId: true, userId: true, tokenHash: true, scopes: true, status: true, revokedAt: true, createdAt: true },
  });
  const ttlDays = Number(process.env.MCP_TOKEN_TTL_DAYS || 180);
  const expired = ttlDays > 0 && identity?.createdAt && Date.now() - identity.createdAt.getTime() > ttlDays * 86400000;
  if (!identity || !hashesMatch(identity.tokenHash, tokenHash) || identity.status !== "active" || identity.revokedAt || expired) return null;
  await getPrisma().mcpIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: new Date() } });
  return { identityId: identity.id, publicId: identity.publicId, userId: identity.userId, scopes: identity.scopes };
}

export async function revokeMcpIdentity(publicId: string) {
  return getPrisma().mcpIdentity.updateMany({ where: { publicId, status: { not: "revoked" } }, data: { status: "revoked", revokedAt: new Date() } });
}

export async function hasMcpScope(identityId: string, scope: string) {
  const identity = await getPrisma().mcpIdentity.findUnique({ where: { id: identityId }, select: { scopes: true } });
  return Boolean(identity?.scopes.includes(scope));
}

/** Resolves Bearer MCP auth, while retaining the existing session/header contract. */
export async function resolveMcpIdentity(req: Request, requiredScopes: readonly string[] = []): Promise<McpIdentity | null> {
  const suppliedPublicId = req.headers.get("x-boatship-mcp-id");
  const token = bearerToken(req);
  if (token) {
    const claims = await verifyMcpToken(token);
    if (!claims || (suppliedPublicId && suppliedPublicId !== claims.publicId)) return null;
    if (requiredScopes.some((scope) => !claims.scopes.includes(scope))) return null;
    const session = await sessionForUser(claims.userId);
    return session ? { mcpId: claims.publicId, session, identityId: claims.identityId, scopes: claims.scopes } : null;
  }

  const session = await getSessionFromRequest(req);
  if (!session) return null;
  const expected = `boatship_${session.uid}`;
  if (suppliedPublicId && suppliedPublicId !== expected) return null;
  return { mcpId: expected, session, scopes: [] };
}

export async function recordMcpAuditEvent(input: { identityId: string; userId: string; toolName: string; resource?: string; action?: string; success?: boolean; metadata?: Record<string, unknown> }) {
  return getPrisma().mcpAuditEvent.create({
    data: { id: randomUUID(), identityId: input.identityId, userId: input.userId, toolName: input.toolName, resource: input.resource, action: input.action, success: input.success ?? true, metadata: input.metadata as Prisma.InputJsonObject | undefined },
  });
}
