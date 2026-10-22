import assert from "node:assert/strict";
import test from "node:test";
import { projectApprovalSchema, projectMilestoneSchema, ProjectContextError, resolveHodiProjectContext } from "../lib/hodi-project-context.ts";

test("project proposal schemas preserve optional engagement selection and reject malformed IDs", () => {
  assert.equal(projectMilestoneSchema.parse({ clientId: "client-a", title: "Launch", engagementId: " project-a " }).engagementId, "project-a");
  assert.equal(projectApprovalSchema.parse({ clientId: "client-a", subject: "Approve", engagementId: "project-a" }).engagementId, "project-a");
  assert.equal(projectApprovalSchema.parse({ clientId: "client-a", subject: "Approve", engagementId: null }).engagementId, null);
  assert.equal(projectMilestoneSchema.parse({ clientId: "client-a", title: "Launch" }).engagementId, undefined);
  for (const engagementId of ["", " ", false, 12, {}]) {
    assert.equal(projectMilestoneSchema.safeParse({ clientId: "client-a", title: "Launch", engagementId }).success, false);
    assert.equal(projectApprovalSchema.safeParse({ clientId: "client-a", subject: "Approve", engagementId }).success, false);
  }
});

test("unlinked milestones preserve account-wide default but validate an explicit engagement", async () => {
  const calls = [];
  const resolve = async (...args) => { calls.push(args); return args[1] || null; };
  assert.equal(await resolveHodiProjectContext("client-a", undefined, [], resolve), null);
  assert.equal(await resolveHodiProjectContext("client-a", null, [], resolve), null);
  assert.equal(await resolveHodiProjectContext("client-a", "project-a", [], resolve), "project-a");
  assert.deepEqual(calls, [["client-a", undefined, undefined], ["client-a", null, undefined], ["client-a", "project-a", undefined]]);
});

test("the first linked task supplies omitted context and every later task is checked against it", async () => {
  const calls = [];
  const resolve = async (clientId, requested, taskId) => {
    calls.push({ clientId, requested, taskId });
    return requested || "onboarding_client-a";
  };
  assert.equal(await resolveHodiProjectContext("client-a", undefined, ["legacy-a", "legacy-b"], resolve), "onboarding_client-a");
  assert.deepEqual(calls, [
    { clientId: "client-a", requested: undefined, taskId: "legacy-a" },
    { clientId: "client-a", requested: "onboarding_client-a", taskId: "legacy-b" },
  ]);
});

test("mixed linked engagements and duplicate tasks cannot create milestones", async () => {
  await assert.rejects(() => resolveHodiProjectContext("client-a", undefined, ["a", "b"], async (_clientId, _requested, taskId) => taskId === "a" ? "project-a" : "project-b"), (error) => error instanceof ProjectContextError && /share one engagement/.test(error.message));
  let called = false;
  await assert.rejects(() => resolveHodiProjectContext("client-a", "project-a", ["a", "a"], async () => { called = true; return "project-a"; }), (error) => error instanceof ProjectContextError && /Duplicate/.test(error.message));
  assert.equal(called, false);
});

test("current ownership or closed-engagement failures propagate at every validation pass", async () => {
  const denied = Object.assign(new Error("This engagement is closed"), { status: 409 });
  let open = true;
  const resolve = async () => { if (!open) throw denied; return "project-a"; };
  assert.equal(await resolveHodiProjectContext("client-a", "project-a", ["task-a"], resolve), "project-a");
  open = false;
  await assert.rejects(() => resolveHodiProjectContext("client-a", "project-a", ["task-a"], resolve), (error) => error === denied);
  const wrongClient = Object.assign(new Error("The related task must belong to this client"), { status: 400 });
  await assert.rejects(() => resolveHodiProjectContext("client-a", "project-a", ["task-a", "foreign-task"], async (_client, _requested, taskId) => {
    if (taskId === "foreign-task") throw wrongClient;
    return "project-a";
  }), (error) => error === wrongClient);
});
