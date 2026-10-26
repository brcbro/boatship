import assert from "node:assert/strict";
import test from "node:test";
import {
  averageDurationDays,
  averageOnboardingDays,
  dueDateKey,
  dueDateToStorage,
  formatDate,
  formatDueDate,
  parseDateValue,
  safeNextPath,
} from "../lib/utils.ts";
import { NAV_GROUPS, SETTINGS_ITEMS, canOpenNavItem, visibleNavItems } from "../components/admin/navigation.ts";
import { staffRequestPermissionRules } from "../lib/rbac.ts";

const DAY = 86_400_000;
const team = (permissions) => ({ uid: "team-1", name: "Staff", email: "staff@example.test", role: "team", clientId: null, permissions });
const admin = { uid: "admin-1", name: "Admin", email: "admin@example.test", role: "admin", clientId: null };

test("average onboarding days divides by a whole day", () => {
  assert.equal(averageDurationDays([]), 0);
  assert.equal(averageDurationDays([3 * DAY, 4 * DAY]), 3.5);
  const engagements = [
    { type: "onboarding", status: "completed", startDate: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-11T00:00:00.000Z", createdAt: "2025-12-01T00:00:00.000Z" },
    { type: "onboarding", status: "active", startDate: null, completedAt: null, createdAt: "2026-01-01T00:00:00.000Z" },
    { type: "delivery", status: "completed", startDate: null, completedAt: "2026-03-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" },
  ];
  assert.equal(averageOnboardingDays(engagements, []), 10);
  const clients = [{ status: "completed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" }];
  assert.equal(averageOnboardingDays([], clients), 2);
});

test("safeNextPath keeps same-origin paths for the role's own area", () => {
  assert.equal(safeNextPath("/clients/abc?tab=documents", "team"), "/clients/abc?tab=documents");
  assert.equal(safeNextPath("/dashboard", "admin"), "/dashboard");
  assert.equal(safeNextPath("/portal/tasks?taskId=1", "client"), "/portal/tasks?taskId=1");
  assert.equal(safeNextPath("/portal", "team"), null);
  assert.equal(safeNextPath("/clients", "client"), null);
  assert.equal(safeNextPath("/dashboardevil", "admin"), null);
});

test("safeNextPath rejects open redirects", () => {
  for (const next of [null, "", "dashboard", "//evil.example/dashboard", "/\\evil.example", "/\\/evil.example", "https://evil.example/dashboard", "javascript:alert(1)", "/dash\tboard", "/clients/%5C%5Cevil", "\\\\evil.example"]) {
    const result = safeNextPath(next, "admin");
    if (result !== null) {
      // Encoded characters may remain only as an inert same-origin path.
      assert.ok(result.startsWith("/clients/"), `unexpected ${result} for ${next}`);
    }
  }
  assert.equal(safeNextPath("//evil.example/dashboard", "admin"), null);
  assert.equal(safeNextPath("/\\evil.example", "admin"), null);
  assert.equal(safeNextPath("https://evil.example/dashboard", "admin"), null);
});

test("date-only values are local calendar days", () => {
  const date = parseDateValue("2026-10-26");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 26);
  assert.equal(formatDate("2026-10-26"), new Date(2026, 9, 26).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));
  assert.equal(formatDate("not a date"), "—");
  assert.equal(dueDateKey("2026-10-26T00:00:00.000Z"), "2026-10-26");
  assert.equal(dueDateKey("2026-10-26"), "2026-10-26");
  assert.equal(dueDateToStorage("2026-10-26"), "2026-10-26T00:00:00.000Z");
  assert.equal(formatDueDate("2026-10-26T00:00:00.000Z"), formatDate("2026-10-26"));
});

test("nav items match the API permissions behind them", () => {
  const api = {
    "/messages": "/api/messages", "/calendar": "/api/calendar", "/clients": "/api/clients", "/projects": "/api/project-operations",
    "/workload": "/api/clients", "/analytics": "/api/analytics", "/agent": "/api/agent/chat", "/hodi": "/api/hodi/queue",
    "/workspace": "/api/project-operations", "/reminders": "/api/reminders/scan", "/automations": "/api/automations",
    "/integrations": "/api/integrations", "/webhooks": "/api/webhooks", "/compliance": "/api/audit/export",
  };
  const items = [...NAV_GROUPS.flatMap((group) => group.items), ...SETTINGS_ITEMS];
  for (const item of items) {
    const path = api[item.href];
    if (!path) continue;
    const required = staffRequestPermissionRules(`https://boatship.example.test${path}`, "GET").flatMap((rule) => rule.anyOf);
    assert.ok(required.length === 0 || required.includes(item.permission), `${item.href} needs ${required.join(" or ")}, nav has ${item.permission}`);
  }
});

test("visibleNavItems hides pages a team member cannot use", () => {
  const limited = team(["documents.review"]);
  const settings = visibleNavItems(SETTINGS_ITEMS, limited).map((item) => item.href);
  assert.ok(!settings.includes("/integrations"));
  assert.ok(!settings.includes("/compliance"));
  assert.ok(!settings.includes("/webhooks"));
  assert.ok(settings.includes("/account"));
  const integrations = SETTINGS_ITEMS.find((item) => item.href === "/integrations");
  assert.equal(canOpenNavItem(integrations, team(["integrations.manage"])), true);
  assert.equal(visibleNavItems(SETTINGS_ITEMS, admin).length, SETTINGS_ITEMS.length);
});
