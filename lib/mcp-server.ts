import type { McpContext } from "@/lib/mcp-context";
import { validateGitProgress } from "@/lib/git-validation";
import type { GitCheckName, GitValidationRequest } from "@/lib/git-validation-types";
import {
  authorizedConversation,
  progressEvidence,
  projectContext,
  searchContext,
  sanitizeForMcp,
  taskDetails,
  hasMcpScope,
  visibleTask,
  visibleTasks,
} from "@/lib/mcp-context";
import { contextPack, runApprovedTaskAction, sessionHistory } from "@/lib/mcp-controls";

export const MCP_PROTOCOL_VERSION = "2024-11-05";

type JsonRpcId = string | number | null;
export interface McpJsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const tools = [
  { name: "list_assigned_tasks", description: "List tasks visible to the authenticated Boatship user.", inputSchema: { type: "object", properties: { clientId: { type: "string" } } } },
  { name: "get_task_details", description: "Get an authorized task and its linked project context.", inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } } },
  { name: "get_project_context", description: "Get authorized project and company context.", inputSchema: { type: "object", required: ["clientId"], properties: { clientId: { type: "string" } } } },
  { name: "get_authorized_conversation", description: "Get authorized task or project conversation text.", inputSchema: { type: "object", properties: { taskId: { type: "string" }, clientId: { type: "string" } } } },
  { name: "search_context", description: "Search authorized Boatship context.", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } } },
  { name: "get_progress_evidence", description: "Return progress evidence from Boatship records, excluding agent summaries and Git validation.", inputSchema: { type: "object", properties: { taskId: { type: "string" } } } },
  { name: "validate_task_progress", description: "Validate an authorized task using Git-derived evidence only. Agent summaries are never used as evidence.", inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, repositoryPath: { type: "string" }, repositoryUrl: { type: "string" }, branch: { type: "string" }, baseSha: { type: "string" }, headSha: { type: "string" }, checks: { type: "array", items: { type: "string", enum: ["git-diff-check", "typecheck", "lint", "test", "build"] } } } } },
  { name: "get_task_context_pack", description: "Get a minimal, task-specific context pack with only relevant project records.", inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } } },
  { name: "get_mcp_session_history", description: "Get recent sanitized MCP tool activity for this identity.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "update_task_status", description: "Request or apply a task status update. Writes require a returned approvalId.", inputSchema: { type: "object", required: ["taskId", "status"], properties: { taskId: { type: "string" }, status: { type: "string" }, approved: { type: "boolean" }, approvalId: { type: "string" } } } },
  { name: "add_task_comment", description: "Request or add a task comment with approval.", inputSchema: { type: "object", required: ["taskId", "body"], properties: { taskId: { type: "string" }, body: { type: "string" }, approved: { type: "boolean" }, approvalId: { type: "string" } } } },
  { name: "create_follow_up_task", description: "Request or create a follow-up task with approval.", inputSchema: { type: "object", required: ["taskId", "title"], properties: { taskId: { type: "string" }, title: { type: "string" }, description: { type: "string" }, dueDate: { type: "string" }, approved: { type: "boolean" }, approvalId: { type: "string" } } } },
  { name: "request_task_review", description: "Request manager/client review for a task with approval.", inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, note: { type: "string" }, approved: { type: "boolean" }, approvalId: { type: "string" } } } },
  { name: "attach_task_evidence", description: "Attach a URL, commit, pull request, or evidence note to a task with approval.", inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, url: { type: "string" }, note: { type: "string" }, approved: { type: "boolean" }, approvalId: { type: "string" } } } },
];

const resources = [
  { uri: "boatship://me/tasks", name: "Assigned tasks", description: "Tasks visible to the authenticated user.", mimeType: "application/json" },
  { uri: "boatship://me", name: "Boatship identity", description: "The authenticated MCP identity.", mimeType: "application/json" },
];

function textResult(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(sanitizeForMcp(value)) }] };
}

function error(id: JsonRpcId, code: number, message: string): McpJsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function stringArg(params: Record<string, unknown>, key: string) {
  return typeof params[key] === "string" ? params[key].trim() : "";
}

type McpRequiredScope = "tasks:read" | "projects:read" | "context:read" | "git:validate" | "tasks:write" | "session:read";

function missingScope(id: JsonRpcId, context: McpContext, scope: McpRequiredScope) {
  return hasMcpScope(context, scope)
    ? null
    : error(id, -32001, `MCP scope required: ${scope}`);
}

const GIT_CHECKS: readonly GitCheckName[] = ["git-diff-check", "typecheck", "lint", "test", "build"];

function gitValidationRequest(args: Record<string, unknown>): GitValidationRequest {
  const rawChecks = args.checks;
  if (rawChecks !== undefined && !Array.isArray(rawChecks)) throw new Error("checks must be an array");
  const checks = rawChecks?.map((check) => {
    if (typeof check !== "string" || !GIT_CHECKS.includes(check as GitCheckName)) {
      throw new Error("checks contains an unsupported check");
    }
    return check as GitCheckName;
  });
  return {
    repositoryPath: stringArg(args, "repositoryPath") || undefined,
    repositoryUrl: stringArg(args, "repositoryUrl") || undefined,
    branch: stringArg(args, "branch") || undefined,
    baseSha: stringArg(args, "baseSha") || undefined,
    headSha: stringArg(args, "headSha") || undefined,
    checks: checks?.length ? checks : undefined,
  };
}

export async function handleMcpRequest(request: McpJsonRpcRequest, context: McpContext): Promise<McpJsonRpcResponse | null> {
  const id = request.id ?? null;
  const method = request.method || "";
  const params = request.params || {};
  if (request.jsonrpc !== "2.0" || !method) return error(id, -32600, "Invalid JSON-RPC request");

  if (method === "notifications/initialized" || method.startsWith("notifications/")) return null;
  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {}, resources: {} }, serverInfo: { name: "boatship-mcp", version: "1.0.0" } } };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
  if (method === "resources/list") return { jsonrpc: "2.0", id, result: { resources } };
  if (method === "resources/read") {
    const uri = stringArg(params, "uri");
    if (uri === "boatship://me") return { jsonrpc: "2.0", id, result: { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ mcpId: context.mcpId, user: sanitizeForMcp({ uid: context.session.uid, email: context.session.email, name: context.session.name, role: context.session.role }) }) }] } };
    if (uri === "boatship://me/tasks") {
      const denied = missingScope(id, context, "tasks:read");
      if (denied) return denied;
      return { jsonrpc: "2.0", id, result: { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(await visibleTasks(context)) }] } };
    }
    return error(id, -32004, "Resource not found or not authorized");
  }
  if (method === "tools/call") {
    const name = stringArg(params, "name");
    const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
    try {
      const requiredScope: McpRequiredScope | undefined =
        name === "list_assigned_tasks" || name === "get_task_details" || name === "get_progress_evidence"
          ? "tasks:read"
          : name === "get_project_context"
            ? "projects:read"
            : name === "get_authorized_conversation" || name === "search_context"
              ? "context:read"
              : name === "validate_task_progress"
                ? "git:validate"
                : name === "get_task_context_pack"
                  ? "tasks:read"
                  : name === "get_mcp_session_history"
                    ? "session:read"
                    : ["update_task_status", "add_task_comment", "create_follow_up_task", "request_task_review", "attach_task_evidence"].includes(name)
                      ? "tasks:write"
                : undefined;
      if (!requiredScope) return error(id, -32601, "Unknown tool");
      const denied = missingScope(id, context, requiredScope);
      if (denied) return denied;
      let value: unknown;
      if (name === "list_assigned_tasks") value = await visibleTasks(context, stringArg(args, "clientId") || undefined);
      else if (name === "get_task_details") value = await taskDetails(context, stringArg(args, "taskId"));
      else if (name === "get_project_context") value = await projectContext(context, stringArg(args, "clientId"));
      else if (name === "get_authorized_conversation") value = await authorizedConversation(context, { taskId: stringArg(args, "taskId") || undefined, clientId: stringArg(args, "clientId") || undefined });
      else if (name === "search_context") value = await searchContext(context, stringArg(args, "query"));
      else if (name === "get_progress_evidence") value = await progressEvidence(context, stringArg(args, "taskId") || undefined);
      else if (name === "get_task_context_pack") value = await contextPack(context, stringArg(args, "taskId"));
      else if (name === "get_mcp_session_history") value = context.identityId ? await sessionHistory(context.identityId, typeof args.limit === "number" ? args.limit : 50) : [];
      else if (name === "update_task_status") value = await runApprovedTaskAction({ context, action: "update_task_status", taskId: stringArg(args, "taskId"), payload: { status: stringArg(args, "status") }, approved: args.approved === true, approvalId: stringArg(args, "approvalId") });
      else if (name === "add_task_comment") value = await runApprovedTaskAction({ context, action: "add_comment", taskId: stringArg(args, "taskId"), payload: { body: stringArg(args, "body") }, approved: args.approved === true, approvalId: stringArg(args, "approvalId") });
      else if (name === "create_follow_up_task") value = await runApprovedTaskAction({ context, action: "create_follow_up", taskId: stringArg(args, "taskId"), payload: { title: stringArg(args, "title"), description: stringArg(args, "description"), dueDate: stringArg(args, "dueDate") }, approved: args.approved === true, approvalId: stringArg(args, "approvalId") });
      else if (name === "request_task_review") value = await runApprovedTaskAction({ context, action: "request_review", taskId: stringArg(args, "taskId"), payload: { note: stringArg(args, "note") }, approved: args.approved === true, approvalId: stringArg(args, "approvalId") });
      else if (name === "attach_task_evidence") value = await runApprovedTaskAction({ context, action: "attach_evidence", taskId: stringArg(args, "taskId"), payload: { url: stringArg(args, "url"), note: stringArg(args, "note") }, approved: args.approved === true, approvalId: stringArg(args, "approvalId") });
      else if (name === "validate_task_progress") {
        const taskId = stringArg(args, "taskId");
        if (!taskId) return error(id, -32602, "taskId is required");
        if (!(await visibleTask(context, taskId))) return error(id, -32003, "Task not found or not authorized");
        let request: GitValidationRequest;
        try {
          request = gitValidationRequest(args);
        } catch {
          return error(id, -32602, "Invalid Git validation arguments");
        }
        const evidence = await validateGitProgress(taskId, request);
        value = { source: "git", evidence, agentSummaryUsed: false, note: "This result is derived from Git state and configured checks, never from an agent summary." };
      }
      return { jsonrpc: "2.0", id, result: textResult(value) };
    } catch (cause) {
      console.error("Boatship MCP tool failed", cause);
      return error(id, -32000, "Tool failed");
    }
  }
  return error(id, -32601, "Method not found");
}
