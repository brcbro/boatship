import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { RestFirestore } from "../../lib/firestore/client.ts";
import { PostgresFirestore } from "../../lib/firestore/postgres.ts";

export const QA_PASSWORD = "local-qa-password-1";
const stamp = "2026-10-14T12:00:00.000Z";
export const QA_PROJECT = "demo-boatship";

/**
 * Isolated QA fixture. With QA_DATABASE_URL it runs on PostgreSQL in a scratch
 * table named for this process (dropped on close), so the production
 * `documents` table is never touched. Otherwise FIRESTORE_EMULATOR_HOST must
 * point at a local emulator (`npm run test:e2e` wraps the test in
 * `firebase emulators:exec`). Hosted credentials are never read.
 */
export async function createLocalQa({ web = false, port = 3100, log = () => {} } = {}) {
  const root = process.cwd();
  const databaseUrl = process.env.QA_DATABASE_URL?.trim();
  const emulator = process.env.FIRESTORE_EMULATOR_HOST?.trim();
  let firestore, host = null, storeEnv;
  if (databaseUrl) {
    const table = `qa_${process.pid}_${Date.now().toString(36)}`;
    firestore = new PostgresFirestore({ url: databaseUrl, table, max: 2 });
    await firestore.drop();
    storeEnv = { DATABASE_URL: databaseUrl, DATABASE_TABLE: table, FIRESTORE_EMULATOR_HOST: "", FIREBASE_PROJECT_ID: "", FIREBASE_SERVICE_ACCOUNT: "" };
  } else {
    if (!emulator) throw new Error("QA_DATABASE_URL or FIRESTORE_EMULATOR_HOST is required; run through `firebase emulators:exec --only firestore` for the emulator.");
    host = emulator.startsWith("http") ? emulator : `http://${emulator}`;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(host).hostname)) throw new Error("QA must never contact a remote Firestore");
    // Wipe the emulator database so every run starts from the same fixture.
    const wipe = await fetch(`${host}/emulator/v1/projects/${QA_PROJECT}/databases/(default)/documents`, { method: "DELETE" });
    if (!wipe.ok) throw new Error(`Could not clear the Firestore emulator: HTTP ${wipe.status}`);
    firestore = new RestFirestore({ projectId: QA_PROJECT, host });
    storeEnv = { FIRESTORE_EMULATOR_HOST: emulator, FIREBASE_PROJECT_ID: QA_PROJECT, FIREBASE_SERVICE_ACCOUNT: "", DATABASE_URL: "", DATABASE_TABLE: "" };
  }

  const currentBytes = await fs.readFile(path.join(root, "public", "brand", "boatship-b-white.png"));
  const oldBytes = await fs.readFile(path.join(root, "public", "brand", "boatship-favicon.png"));
  const client = (id, name, owner) => ({ id, name, companyName: `${name} Studio`, primaryContactEmail: `${id}@qa.invalid`, status: "not_started", pipelineStage: "intake", assignedTeamMemberId: owner, templateId: "qa_template", tags: [], customFields: {}, driveFolderId: null, driveFolderUrl: null, pauseReason: null, pausedAt: null, createdAt: stamp, updatedAt: stamp });
  const task = (id, engagementId) => ({ id, clientId: "qa_client", engagementId, title: "Share project assets", description: "Upload the agreed project assets.", type: "client_facing", assignedTo: null, assignedRole: "client", status: "pending", priority: "medium", dueDate: null, order: 1, section: "Client tasks", internalNotes: "", formTemplateId: null, requiresUpload: true, subtasks: [], dependsOnTaskIds: [], watcherIds: [], reminderSentAt: null, escalatedAt: null, createdAt: stamp, completedAt: null });
  // The document fixture is already in post-migration shape: bytes live in
  // DocumentContent records and the snapshot holds content references.
  const snapshot = { users: [], clients: [client("qa_client", "Harbour", "qa_team"), client("qa_other", "Other", "qa_other_team")], tasks: [task("qa_task", "qa_active"), task("qa_legacy_task", "onboarding_qa_client")], documents: [{ id: "qa_document", clientId: "qa_client", engagementId: "qa_active", taskId: "qa_task", fileName: "qa-current.png", storagePath: "db://clients/qa_client/qa-current.png", uploadedBy: "qa_client_user", uploadedAt: stamp, contentType: "image/png", size: currentBytes.length, contentId: "legacy:qa_document:current", contentBase64: null, status: "pending_review", reviewNote: "", documentType: null, expiresAt: null, expiryAlertSentAt: null, versions: [{ fileName: "qa-previous.png", storagePath: "db://clients/qa_client/qa-previous.png", uploadedBy: "qa_client_user", uploadedAt: stamp, contentType: "image/png", size: oldBytes.length, contentId: "legacy:qa_document:version:0" }] }], templates: [{ id: "qa_template", name: "Website QA", description: "Website test playbook", taskList: [], version: 1, publishStatus: "published", parentTemplateId: null, industry: null, createdAt: stamp, updatedAt: stamp }], formTemplates: [{ id: "qa_form_template", name: "Project brief", description: "Tell us what you need.", googleFormUrl: "", mode: "native", fields: [{ key: "email", label: "Contact email", type: "email", required: true }, { key: "choice", label: "Project goal", type: "dropdown", required: true, options: ["Website", "App"] }], createdAt: stamp, updatedAt: stamp }], forms: [{ id: "qa_form", clientId: "qa_client", engagementId: "qa_active", formTemplateId: "qa_form_template", taskId: "qa_task", responses: {}, status: "not_started", riskScore: null, submittedAt: null, reviewedAt: null, reviewNote: "" }], activity: [], taskComments: [], notifications: [], messages: [], vessels: [], webhooks: [{ id: "qa_hook", url: "https://blocked.qa.invalid", secret: "test-only", active: true, events: ["form.submitted"], createdAt: stamp }], webhookDeliveries: [], integrationRuns: [], smartLists: [], agentChatMessages: [], agentChatSessions: [], projectOps: { milestones: [{ id: "qa_milestone", clientId: "qa_client", engagementId: "qa_active", title: "Launch", description: "Launch the website", dueDate: null, status: "planned", taskIds: ["qa_task"], createdAt: stamp, updatedAt: stamp }], approvals: [{ id: "qa_approval", clientId: "qa_client", engagementId: "qa_active", subject: "Approve the design", description: "Review the proposed direction.", kind: "design", status: "pending", requestedBy: "qa_admin", reviewedBy: null, reviewedAt: null, createdAt: stamp }], schedules: [{ id: "qa_private_schedule", clientId: "qa_other", title: "Other client private meeting", description: "Private fixture", start: stamp, end: stamp, createdBy: "qa_admin", externalEventId: null, createdAt: stamp }], workspace: { name: "Boatship QA", slug: "qa", policies: [] } } };
  snapshot.forms.push({ ...snapshot.forms[0], id: "qa_api_form" });

  const writes = [{ set: { collection: "StoreSnapshot", id: "main", data: { version: 1, updatedAt: stamp } } }];
  for (const [key, value] of Object.entries(snapshot)) writes.push({ set: { collection: "StoreSnapshot", id: `main:${key}`, data: { json: JSON.stringify(value), version: 1 } } });
  for (const [id, bytes] of [["legacy:qa_document:current", currentBytes], ["legacy:qa_document:version:0", oldBytes]]) {
    writes.push({ set: { collection: "DocumentContent", id, data: { id, documentId: "qa_document", clientId: "qa_client", bytes: Uint8Array.from(bytes), objectKey: null, contentType: "image/png", size: bytes.length, createdAt: stamp } } });
  }
  const permissions = ["clients.view", "clients.manage", "documents.review", "forms.review", "analytics.view", "integrations.manage", "team.manage"];
  for (const [uid, email, role, clientId, grants] of [ ["qa_admin", "admin@qa.invalid", "admin", null, []], ["qa_team", "team@qa.invalid", "team", null, permissions], ["qa_viewer", "viewer@qa.invalid", "team", null, ["clients.view"]], ["qa_none", "none@qa.invalid", "team", null, []], ["qa_client_user", "client@qa.invalid", "client", "qa_client", []], ["qa_other_user", "other@qa.invalid", "client", "qa_other", []] ]) {
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `${salt}:${scryptSync(QA_PASSWORD, salt, 64).toString("hex")}`;
    writes.push({ set: { collection: "UserProfile", id: uid, data: { uid, email, name: uid.replace("qa_", "QA "), role, clientId, createdAt: stamp, inviteToken: null, inviteTokenExpiresAt: null, mustResetPassword: false, password: null, passwordHash, permissions: grants, digestEnabled: false, lastDigestAt: null } } });
  }
  for (const [id, status, name] of [["onboarding_qa_client", "planned", "Onboarding"], ["qa_active", "active", "Website launch"], ["qa_closed", "completed", "Past campaign"]]) {
    writes.push({ set: { collection: "Engagement", id, data: { id, clientId: "qa_client", name, type: "project", status, ownerId: "qa_team", startDate: null, targetDate: null, completedAt: status === "completed" ? stamp : null, createdAt: stamp, updatedAt: stamp } } });
  }
  await firestore.commit(writes);

  let child;
  if (web) {
    const env = { ...process.env };
    const localConfig = await fs.readFile(path.join(root, ".env.local"), "utf8").catch(() => "");
    for (const key of Object.keys(dotenv.parse(localConfig))) env[key] = "";
    Object.assign(env, storeEnv, { FIREBASE_STORAGE_BUCKET: "", ALLOW_LOCAL_STORE: "0", NODE_ENV: "development", NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`, APP_URL: `http://127.0.0.1:${port}`, BOATSHIP_CRON_SECRET: "local-qa-only" });
    child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (data) => log(data.toString()));
    child.stderr.on("data", (data) => log(data.toString()));
  }
  return { firestore, host, storeEnv, currentBytes, oldBytes, child,
    async close() {
      if (child && child.exitCode === null) { child.kill(); await new Promise((resolve) => { child.once("exit", resolve); setTimeout(resolve, 5000); }); }
      if (firestore instanceof PostgresFirestore) { await firestore.drop(); await firestore.close(); }
    }
  };
}
