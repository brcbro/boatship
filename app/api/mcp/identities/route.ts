import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { findMcpIdentityByPublicId, issueMcpToken, listMcpProjectAccess, MCP_IDENTITIES, MCP_PROJECT_ACCESS, MCP_SCOPES, revokeMcpIdentity, type McpIdentityDoc } from "@/lib/mcp-auth";
import { getStore } from "@/lib/store";
import { recordAccountAudit } from "@/lib/accounts";
import { canAccessClient } from "@/lib/client-access";
import type { AppUser, AuthSession } from "@/types";

export const runtime = "nodejs";

function serializeIdentity(identity: McpIdentityDoc, projectAccess: Array<{ projectId: string; accessLevel: string }>) {
  return {
    publicId: identity.publicId,
    userId: identity.userId,
    issuedBy: identity.issuedBy ?? null,
    status: identity.status,
    scopes: identity.scopes,
    projectAccess,
    lastUsedAt: identity.lastUsedAt ?? null,
    revokedAt: identity.revokedAt ?? null,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  };
}

async function readJson(req: Request) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    throw jsonError("Request body must be valid JSON", 400);
  }
}

function stringArray(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw jsonError(`${field} must be an array of non-empty strings`, 400);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function validateScopes(scopes: string[] | undefined) {
  if (!scopes) return undefined;
  const unknown = scopes.filter((scope) => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]));
  if (unknown.length) throw jsonError(`Unsupported MCP scope: ${unknown[0]}`, 400);
  return scopes;
}

/** Projects (clients) the token owner could not open with their own session; a token never grants more. */
async function inaccessibleProjects(owner: AppUser, projectIds: string[]) {
  const store = await getStore();
  const ownerSession: AuthSession = { uid: owner.uid, email: owner.email, name: owner.name, role: owner.role, clientId: owner.clientId, permissions: owner.permissions };
  const denied: string[] = [];
  for (const projectId of projectIds) {
    if (!(await store.getClient(projectId)) || !(await canAccessClient(ownerSession, projectId))) denied.push(projectId);
  }
  return denied;
}

async function recordIssue(actor: AuthSession, userId: string, issued: { publicId: string; scopes: string[] }, projectIds: string[], kind: "issued" | "regenerated", replaces?: string) {
  await recordAccountAudit({
    action: `mcp.identity.${kind}`,
    actor: { uid: actor.uid, role: actor.role },
    targetUserId: userId,
    metadata: { publicId: issued.publicId, issuedBy: actor.uid, scopes: issued.scopes, projectIds, ...(replaces ? { replaces } : {}) },
  });
}

export async function GET(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const isAdmin = session.role === "admin";
    if (isAdmin) await requireRoles(req, ["admin"]);

    const identities = (await MCP_IDENTITIES.find(isAdmin ? [] : [{ field: "userId", op: "==", value: session.uid }]))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // The former `projectAccess` include: one query per identity's rows, joined in memory.
    const access = identities.length
      ? await MCP_PROJECT_ACCESS.find([{ field: "identityId", op: "in", value: identities.map((identity) => identity.id) }])
      : [];
    const byIdentity = new Map<string, Array<{ projectId: string; accessLevel: string }>>();
    for (const row of access) {
      const list = byIdentity.get(row.identityId) || [];
      list.push({ projectId: row.projectId, accessLevel: row.accessLevel });
      byIdentity.set(row.identityId, list);
    }
    return { identities: identities.map((identity) => serializeIdentity(identity, byIdentity.get(identity.id) || [])) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const body = await readJson(req);
    const requestedUserId = typeof body.userId === "string" ? body.userId.trim() : "";
    const userId = requestedUserId || session.uid;

    if (userId !== session.uid) await requireRoles(req, ["admin"]);
    if (!userId) throw jsonError("userId is required", 400);
    const target = await (await getStore()).getUser(userId);
    if (!target) throw jsonError("User not found", 404);

    const scopes = validateScopes(stringArray(body.scopes, "scopes"));
    const projectIds = stringArray(body.projectIds, "projectIds");
    const denied = await inaccessibleProjects(target, projectIds ?? []);
    if (denied.length) throw jsonError(`The token owner cannot access project: ${denied[0]}`, 400);
    const issued = await issueMcpToken(userId, { scopes, projectIds, issuedBy: session.uid });
    await recordIssue(session, userId, issued, projectIds ?? [], "issued");

    return {
      identity: { publicId: issued.publicId, userId, scopes: issued.scopes },
      token: issued.token,
      warning: "Store this token now. It will not be returned again.",
    };
  });
}

async function revoke(req: Request, publicId: string) {
  const session = await requireSession(req);
  const identity = await findMcpIdentityByPublicId(publicId);
  if (!identity) throw jsonError("MCP identity not found", 404);
  if (identity.userId !== session.uid) await requireRoles(req, ["admin"]);
  await revokeMcpIdentity(publicId);
  return { ok: true, publicId, status: "revoked" };
}

export async function DELETE(req: Request) {
  return handleApi(async () => {
    const publicId = new URL(req.url).searchParams.get("publicId")?.trim();
    if (!publicId) throw jsonError("publicId is required", 400);
    return revoke(req, publicId);
  });
}

export async function PATCH(req: Request) {
  return handleApi(async () => {
    const body = await readJson(req);
    const publicId = typeof body.publicId === "string" ? body.publicId.trim() : "";
    if (!publicId) throw jsonError("publicId is required", 400);
    if (body.action === "regenerate") {
      const session = await requireSession(req);
      const identity = await findMcpIdentityByPublicId(publicId);
      if (!identity) throw jsonError("MCP identity not found", 404);
      if (identity.userId !== session.uid) await requireRoles(req, ["admin"]);
      const owner = await (await getStore()).getUser(identity.userId);
      if (!owner) throw jsonError("User not found", 404);
      const previous = (await listMcpProjectAccess(identity.id)).map((item) => item.projectId);
      // Access the owner has since lost is not carried over to the new token.
      const lost = new Set(await inaccessibleProjects(owner, previous));
      const projectIds = previous.filter((projectId) => !lost.has(projectId));
      await revokeMcpIdentity(publicId);
      const issued = await issueMcpToken(identity.userId, { scopes: identity.scopes, projectIds, issuedBy: session.uid });
      await recordIssue(session, identity.userId, issued, projectIds, "regenerated", publicId);
      return { identity: { publicId: issued.publicId, userId: identity.userId, scopes: issued.scopes }, token: issued.token, warning: "Store this token now. It will not be returned again." };
    }
    return revoke(req, publicId);
  });
}
