import { NextResponse } from "next/server";
import { DEFAULT_MCP_SCOPES, resolveMcpIdentity } from "@/lib/mcp-auth";
import { getPrisma } from "@/lib/prisma";
import { createMcpContext, type McpContext } from "@/lib/mcp-context";
import { handleMcpRequest, type McpJsonRpcRequest } from "@/lib/mcp-server";
import { checkMcpRateLimit, deviceFingerprint } from "@/lib/mcp-controls";
import { recordMcpAuditEvent } from "@/lib/mcp-auth";

export const runtime = "nodejs";

async function resolveMcpBearer(req: Request): Promise<{ context: McpContext } | null> {
  const publicId = req.headers.get("x-boatship-mcp-id")?.trim() || "";
  const authorization = req.headers.get("authorization") || "";
  if (!publicId || !/^Bearer\s+\S+$/i.test(authorization)) return null;
  const identity = await resolveMcpIdentity(req);
  if (!identity || identity.mcpId !== publicId) return null;
  const projectAccess = identity.identityId
    ? await getPrisma().mcpProjectAccess.findMany({ where: { identityId: identity.identityId }, select: { projectId: true } })
    : [];
  return {
    context: await createMcpContext(
      identity.session,
      identity.mcpId,
      projectAccess.map((access) => access.projectId),
      identity.scopes?.length ? identity.scopes : DEFAULT_MCP_SCOPES,
      identity.identityId
    ),
  };
}

async function authenticate(req: Request) {
  try {
    return await resolveMcpBearer(req);
  } catch (error) {
    console.error("Boatship MCP authentication failed", error);
    return null;
  }
}

export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.context.identityId && !(await checkMcpRateLimit(auth.context.identityId))) return NextResponse.json({ error: "MCP rate limit exceeded" }, { status: 429, headers: { "Retry-After": "60" } });
  let body: McpJsonRpcRequest;
  try {
    body = (await req.json()) as McpJsonRpcRequest;
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const response = await handleMcpRequest(body, auth.context);
  if (auth.context.identityId) await recordMcpAuditEvent({ identityId: auth.context.identityId, userId: auth.context.session.uid, toolName: body.method || "unknown", resource: body.params && typeof body.params.uri === "string" ? body.params.uri : undefined, action: body.params && typeof body.params.name === "string" ? body.params.name : body.method, success: !response?.error, metadata: { device: deviceFingerprint(req), requestId: body.id } });
  if (!response) return new Response(null, { status: 202 });
  return NextResponse.json(response);
}

export async function GET(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ name: "boatship-mcp", transport: "streamable-http", endpoint: "/api/mcp", mcpId: auth.context.mcpId });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
}
