import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_STAFF_PERMISSIONS,
  DEFAULT_TEAM_PERMISSIONS,
  effectiveStaffPermissions,
  hasPermission,
  parseStaffPermissions,
  requireStaffPermission,
  requireStaffRequestPermissions,
  staffCanUseMcpScope,
} from "../lib/rbac.ts";

const team = (permissions) => ({ uid: "team-1", name: "Staff", email: "staff@example.test", role: "team", clientId: null, permissions });
const request = (path, method = "GET") => new Request(`https://boatship.example.test${path}`, { method });
const forbidden = (fn) => assert.throws(fn, (response) => response instanceof Response && response.status === 403);
const allowed = (session, path, method) => assert.doesNotThrow(() => requireStaffRequestPermissions(session, request(path, method)));
const denied = (session, path, method) => forbidden(() => requireStaffRequestPermissions(session, request(path, method)));

test("omitted permissions use defaults and explicit empty permissions deny every staff capability", () => {
  assert.deepEqual(effectiveStaffPermissions(team(undefined)), DEFAULT_TEAM_PERMISSIONS);
  assert.deepEqual(effectiveStaffPermissions(team([])), []);
  for (const permission of ALL_STAFF_PERMISSIONS) assert.equal(hasPermission(team([]), permission), false);
  assert.equal(hasPermission(team(undefined), "clients.manage"), true);
  assert.equal(hasPermission(team(undefined), "integrations.manage"), false);
  const resolved = effectiveStaffPermissions(team(undefined));
  resolved.length = 0;
  assert.equal(hasPermission(team(undefined), "clients.manage"), true);
});

test("explicit permissions replace defaults and revocation affects subsequent actions", () => {
  const session = team(["clients.view", "clients.manage", "documents.review"]);
  requireStaffPermission(session, "documents.review");
  session.permissions = ["clients.view", "clients.manage"];
  forbidden(() => requireStaffPermission(session, "documents.review"));
  forbidden(() => requireStaffPermission(team(["analytics.view"]), "clients.manage"));
});

test("permission writes accept empty arrays and known deduplicated keys, rejecting malformed input", () => {
  assert.deepEqual(parseStaffPermissions([]), []);
  assert.deepEqual(parseStaffPermissions(["clients.view", "clients.view", "forms.review"]), ["clients.view", "forms.review"]);
  for (const value of [undefined, null, "clients.view", ["unknown.manage"], ["clients.view", 1], [{}], ["admin"], ["*"], [" clients.view"]]) {
    assert.throws(() => parseStaffPermissions(value));
  }
  assert.deepEqual(effectiveStaffPermissions(team(null)), []);
});

test("admin has every capability; client users never gain staff capabilities", () => {
  for (const permission of ALL_STAFF_PERMISSIONS) {
    assert.equal(hasPermission({ ...team([]), role: "admin" }, permission), true);
    assert.equal(hasPermission({ ...team(ALL_STAFF_PERMISSIONS), role: "client" }, permission), false);
  }
});

test("client-management requests require manage even when a member has read access", () => {
  const viewer = team(["clients.view"]);
  for (const path of ["/api/clients", "/api/clients/c1", "/api/clients/c1/contacts", "/api/clients/c1/engagements", "/api/engagements/e1", "/api/tasks", "/api/tasks/t1", "/api/vessels", "/api/project-operations", "/api/messages", "/api/reminders"]) {
    allowed(viewer, path);
    denied(viewer, path, "POST");
    allowed(team(["clients.manage"]), path, "POST");
  }
  denied(viewer, "/api/clients/bulk", "PATCH");
  denied(viewer, "/api/clients/import", "POST");
  denied(viewer, "/api/clients/c1/invite", "POST");
  denied(viewer, "/api/tasks/t1/comments", "POST");
  denied(viewer, "/api/tasks/t1/approval", "POST");
});

test("revoked review permissions deny both single and bulk document review before work runs", () => {
  const session = team(["clients.view", "clients.manage"]);
  let reviewed = 0;
  const review = () => {
    requireStaffRequestPermissions(session, request("/api/documents/doc1", "PATCH"));
    reviewed += 1;
  };
  forbidden(review);
  assert.equal(reviewed, 0);
  denied(session, "/api/documents/bulk", "POST");
  session.permissions.push("documents.review");
  review();
  assert.equal(reviewed, 1);
  session.permissions = session.permissions.filter((permission) => permission !== "documents.review");
  forbidden(review);
  assert.equal(reviewed, 1);
});

test("document reviewers may read their resource without general client view or upload access", () => {
  const reviewer = team(["documents.review"]);
  allowed(reviewer, "/api/documents");
  allowed(reviewer, "/api/documents/doc1");
  allowed(reviewer, "/api/documents/doc1/content?version=0");
  allowed(reviewer, "/api/documents/doc1", "PATCH");
  denied(reviewer, "/api/clients/c1");
  denied(reviewer, "/api/documents/upload", "POST");
  denied(reviewer, "/api/documents/upload-url", "POST");
});

test("form review is independent of manage and ordinary view permissions", () => {
  denied(team(["clients.view", "clients.manage"]), "/api/forms/form1/review", "PATCH");
  const reviewer = team(["forms.review"]);
  allowed(reviewer, "/api/forms/form1/review", "PATCH");
  allowed(reviewer, "/api/forms?clientId=c1");
  allowed(reviewer, "/api/forms/export?clientId=c1");
  denied(reviewer, "/api/forms/form1/submit", "POST");
});

test("analytics, integration management and audit exports need their own capability", () => {
  const viewer = team(["clients.view"]);
  for (const [permission, path, method] of [
    ["analytics.view", "/api/analytics?format=csv", "GET"],
    ["integrations.manage", "/api/integrations", "GET"],
    ["integrations.manage", "/api/integrations", "POST"],
    ["integrations.manage", "/api/integrations/execute", "POST"],
    ["integrations.manage", "/api/integrations/account1", "DELETE"],
    ["integrations.manage", "/api/settings/secrets", "GET"],
    ["integrations.manage", "/api/settings/secrets/composio", "DELETE"],
    ["audit.export", "/api/audit/export", "GET"],
    ["audit.export", "/api/gdpr/export", "POST"],
  ]) {
    denied(viewer, path, method);
    allowed(team([permission]), path, method);
  }
});

test("template, team and webhook management policies preserve their separate capability", () => {
  for (const [permission, path] of [
    ["templates.manage", "/api/templates"],
    ["templates.manage", "/api/forms/templates/template1"],
    ["team.manage", "/api/users/invite"],
    ["webhooks.manage", "/api/webhooks/hook1"],
  ]) {
    denied(team([]), path, "POST");
    allowed(team([permission]), path, "POST");
  }
  // The request policy only adds requirements. Existing route role guards
  // still reject team users from admin-only management routes.
});

test("empty permissions deny aggregate reads, live message access and Hodi client context", () => {
  for (const path of ["/api/dashboard", "/api/activity", "/api/search?q=brief", "/api/onboarding-health", "/api/reports/weekly", "/api/messages/live-ticket", "/api/hodi/queue", "/api/agent/insights", "/api/calendar"]) {
    denied(team([]), path);
  }
  denied(team([]), "/api/agent/chat", "POST");
  allowed(team(["clients.view"]), "/api/agent/chat", "POST");
  denied(team(["clients.view"]), "/api/hodi/queue", "POST");
  denied(team(["clients.view"]), "/api/hodi/queue/item1", "PATCH");
  allowed(team(["clients.manage"]), "/api/hodi/queue", "POST");
  denied(team(["clients.view"]), "/api/agent/communications/approve", "POST");
  denied(team(["clients.view"]), "/api/calendar", "POST");
  allowed(team(["integrations.manage"]), "/api/calendar", "POST");
});

test("normalization handles encoded paths, trailing slashes, HEAD and mutation casing", () => {
  denied(team([]), "/api/doc%75ments/doc1/");
  denied(team([]), "/api/analytics/", "HEAD");
  forbidden(() => requireStaffRequestPermissions(team(["clients.view"]), { url: "https://boatship.example.test/api/clients/", method: "patch" }));
});

test("client portal and admin requests retain existing role and assignment authorization", () => {
  for (const role of ["admin", "client"]) {
    const session = { ...team([]), role };
    allowed(session, "/api/forms/form1/submit", "POST");
    allowed(session, "/api/documents/upload", "POST");
    allowed(session, "/api/tasks/t1", "PATCH");
    allowed(session, "/api/messages", "POST");
  }
  for (const path of ["/api/account", "/api/account/password", "/api/account/sessions", "/api/auth/session", "/api/notifications", "/api/products", "/api/mcp/identities"]) {
    allowed(team([]), path);
  }
});

test("MCP token scopes cannot bypass current owner permissions", () => {
  for (const scope of ["tasks:read", "projects:read", "context:read", "tasks:write", "git:validate"]) {
    assert.equal(staffCanUseMcpScope(team([]), scope), false);
  }
  assert.equal(staffCanUseMcpScope(team(["clients.view"]), "tasks:read"), true);
  assert.equal(staffCanUseMcpScope(team(["clients.view"]), "tasks:write"), false);
  assert.equal(staffCanUseMcpScope(team(["clients.manage"]), "tasks:write"), true);
  assert.equal(staffCanUseMcpScope(team([]), "session:read"), true);
  assert.equal(staffCanUseMcpScope({ ...team([]), role: "client" }, "tasks:write"), true);
});
