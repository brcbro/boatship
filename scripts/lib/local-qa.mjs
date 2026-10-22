import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { execFileSync, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { scryptSync, randomBytes } from "node:crypto";
import dotenv from "dotenv";

export const QA_PASSWORD = "Boatship-QA-only-2026!";
const stamp = "2026-10-14T12:00:00.000Z";

export async function createLocalQa({ web = false, port = 3100, log = () => {} } = {}) {
  const root = process.cwd();
  const directory = path.join(root, ".data", "local-qa");
  await fs.mkdir(directory, { recursive: true });
  const schema = await fs.readFile(path.join(root, "prisma", "schema.prisma"), "utf8");
  const baselinePath = path.join(directory, "baseline.prisma");
  await fs.writeFile(baselinePath, schema.replace(/model (DocumentContent|IntegrationJob) \{[\s\S]*?\n\}/g, ""));
  const baselineSql = execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", baselinePath, "--script"], { encoding: "utf8", env: { ...process.env, DIRECT_URL: "postgresql://qa:qa@127.0.0.1:55432/qa" }, timeout: 60000 });
  const db = await PGlite.create();
  await db.exec(baselineSql);
  const currentBytes = await fs.readFile(path.join(root, "public", "brand", "boatship-b-white.png"));
  const oldBytes = await fs.readFile(path.join(root, "public", "brand", "boatship-favicon.png"));
  const client = (id, name, owner) => ({ id, name, companyName: `${name} Studio`, primaryContactEmail: `${id}@qa.invalid`, status: "not_started", pipelineStage: "intake", assignedTeamMemberId: owner, templateId: "qa_template", tags: [], customFields: {}, driveFolderId: null, driveFolderUrl: null, pauseReason: null, pausedAt: null, createdAt: stamp, updatedAt: stamp });
  const task = (id, engagementId) => ({ id, clientId: "qa_client", engagementId, title: "Share project assets", description: "Upload the agreed project assets.", type: "client_facing", assignedTo: null, assignedRole: "client", status: "pending", priority: "medium", dueDate: null, order: 1, section: "Client tasks", internalNotes: "", formTemplateId: null, requiresUpload: true, subtasks: [], dependsOnTaskIds: [], watcherIds: [], reminderSentAt: null, escalatedAt: null, createdAt: stamp, completedAt: null });
  const snapshot = { users: [], clients: [client("qa_client", "Harbour", "qa_team"), client("qa_other", "Other", "qa_other_team")], tasks: [task("qa_task", "qa_active"), task("qa_legacy_task", "onboarding_qa_client")], documents: [{ id: "qa_document", clientId: "qa_client", engagementId: "qa_active", taskId: "qa_task", fileName: "qa-current.png", storagePath: "db://clients/qa_client/qa-current.png", uploadedBy: "qa_client_user", uploadedAt: stamp, contentType: "image/png", size: currentBytes.length, contentBase64: currentBytes.toString("base64"), status: "pending_review", reviewNote: "", documentType: null, expiresAt: null, expiryAlertSentAt: null, versions: [{ fileName: "qa-previous.png", storagePath: "db://clients/qa_client/qa-previous.png", uploadedBy: "qa_client_user", uploadedAt: stamp, contentType: "image/png", size: oldBytes.length, contentBase64: oldBytes.toString("base64") }] }], templates: [{ id: "qa_template", name: "Website QA", description: "Website test playbook", taskList: [], version: 1, publishStatus: "published", parentTemplateId: null, industry: null, createdAt: stamp, updatedAt: stamp }], formTemplates: [{ id: "qa_form_template", name: "Project brief", description: "Tell us what you need.", googleFormUrl: "", mode: "native", fields: [{ key: "email", label: "Contact email", type: "email", required: true }, { key: "choice", label: "Project goal", type: "dropdown", required: true, options: ["Website", "App"] }], createdAt: stamp, updatedAt: stamp }], forms: [{ id: "qa_form", clientId: "qa_client", engagementId: "qa_active", formTemplateId: "qa_form_template", taskId: "qa_task", responses: {}, status: "not_started", riskScore: null, submittedAt: null, reviewedAt: null, reviewNote: "" }], activity: [], taskComments: [], notifications: [], messages: [], vessels: [], webhooks: [{ id: "qa_hook", url: "https://blocked.qa.invalid", secret: "test-only", active: true, events: ["form.submitted"], createdAt: stamp }], webhookDeliveries: [], integrationRuns: [], smartLists: [], agentChatMessages: [], agentChatSessions: [], projectOps: { milestones: [{ id: "qa_milestone", clientId: "qa_client", engagementId: "qa_active", title: "Launch", description: "Launch the website", dueDate: null, status: "planned", taskIds: ["qa_task"], createdAt: stamp, updatedAt: stamp }], approvals: [{ id: "qa_approval", clientId: "qa_client", engagementId: "qa_active", subject: "Approve the design", description: "Review the proposed direction.", kind: "design", status: "pending", requestedBy: "qa_admin", reviewedBy: null, reviewedAt: null, createdAt: stamp }], schedules: [{ id: "qa_private_schedule", clientId: "qa_other", title: "Other client private meeting", description: "Private fixture", start: stamp, end: stamp, createdBy: "qa_admin", externalEventId: null, createdAt: stamp }], workspace: { name: "Boatship QA", slug: "qa", policies: [] } } };
  await db.query('INSERT INTO "StoreSnapshot" (id, data, version, "updatedAt") VALUES ($1,$2,0,$3)', ["main", JSON.stringify(snapshot), stamp]);
  snapshot.forms.push({ ...snapshot.forms[0], id: "qa_api_form" });
  await db.query('UPDATE "StoreSnapshot" SET data=$1 WHERE id=$2', [JSON.stringify(snapshot), "main"]);
  await db.exec(await fs.readFile(path.join(root, "prisma", "migrations", "20261014000000_separate_document_content_and_integration_jobs", "migration.sql"), "utf8"));
  // Later migrations are additive to the October schema; apply them in order so the
  // fixture matches the generated client without re-running the legacy backfill.
  const migrationsDirectory = path.join(root, "prisma", "migrations");
  for (const name of (await fs.readdir(migrationsDirectory)).filter((entry) => /^\d{14}_/.test(entry) && entry.slice(0, 14) > "20261014000000").sort()) {
    await db.exec(await fs.readFile(path.join(migrationsDirectory, name, "migration.sql"), "utf8"));
  }
  const permissions = ["clients.view", "clients.manage", "documents.review", "forms.review", "analytics.view", "integrations.manage", "team.manage"];
  for (const [uid, email, role, clientId, grants] of [ ["qa_admin", "admin@qa.invalid", "admin", null, []], ["qa_team", "team@qa.invalid", "team", null, permissions], ["qa_viewer", "viewer@qa.invalid", "team", null, ["clients.view"]], ["qa_none", "none@qa.invalid", "team", null, []], ["qa_client_user", "client@qa.invalid", "client", "qa_client", []], ["qa_other_user", "other@qa.invalid", "client", "qa_other", []] ]) {
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `${salt}:${scryptSync(QA_PASSWORD, salt, 64).toString("hex")}`;
    await db.query('INSERT INTO "UserProfile" (uid,email,name,role,"clientId","createdAt","passwordHash",permissions,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6)', [uid, email, uid.replace("qa_", "QA "), role, clientId, stamp, passwordHash, grants]);
  }
  for (const [id, status, name] of [["onboarding_qa_client", "planned", "Onboarding"], ["qa_active", "active", "Website launch"], ["qa_closed", "completed", "Past campaign"]]) await db.query('INSERT INTO "Engagement" (id,"clientId",name,type,status,"ownerId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$7)', [id, "qa_client", name, "project", status, "qa_team", stamp]);
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 64 });
  await server.start();
  const connectionString = `postgresql://qa:qa@${server.getServerConn()}/qa`;
  let child;
  if (web) {
    const env = { ...process.env };
    const localConfig = await fs.readFile(path.join(root, ".env.local"), "utf8").catch(() => "");
    for (const key of Object.keys(dotenv.parse(localConfig))) env[key] = "";
    Object.assign(env, { DATABASE_URL: connectionString, DIRECT_URL: connectionString, NODE_ENV: "development", NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`, APP_URL: `http://127.0.0.1:${port}`, PRISMA_CLIENT_FORCE_WASM: "1", BOATSHIP_CRON_SECRET: "local-qa-only", ALLOW_LOCAL_STORE: "0", NEXT_TELEMETRY_DISABLED: "1" });
    child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (data) => log(data.toString()));
    child.stderr.on("data", (data) => log(data.toString()));
  }
  return { db, server, connectionString, currentBytes, oldBytes, child,
    async close() { if (child && child.exitCode === null) { child.kill(); await new Promise((resolve) => { child.once("exit", resolve); setTimeout(resolve, 5000); }); } await server.stop(); await db.close(); }
  };
}
