import { executeTool, isComposioConfiguredForUser, listBoatshipConnections } from "@/lib/composio";
import { sendEmail } from "@/lib/email";
import { getStore } from "@/lib/store";
import type { AppUser, Client } from "@/types";

export type ReminderChannel = "email" | "telegram" | "slack";
export type ReminderReason = "overdue" | "stale" | "suspicious_completion";

export type ReminderFinding = {
  taskId: string;
  clientId: string;
  clientName: string;
  taskTitle: string;
  assigneeId: string | null;
  assigneeName: string | null;
  reason: ReminderReason;
  detail: string;
  dueDate: string | null;
  lastGitActivityAt: string | null;
};

export type ReminderScanOptions = {
  now?: Date;
  staleHours?: number;
  clientId?: string;
  taskId?: string;
  reasons?: ReminderReason[];
};

export type ReminderDispatchOptions = ReminderScanOptions & {
  dryRun?: boolean;
  channels?: ReminderChannel[];
  actorId: string;
  actorName: string;
  baseUrl?: string;
};

type DispatchResult = {
  finding: ReminderFinding;
  channels: Array<{ channel: ReminderChannel; status: "sent" | "skipped" | "failed" | "dry_run"; reason?: string }>;
};

const DEFAULT_STALE_HOURS = 72;
const CHANNELS: ReminderChannel[] = ["email", "telegram", "slack"];

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

function isGitActivity(action: string) {
  return action.startsWith("git.") || action.includes("pull_request") || action.includes("commit") || action.includes("validation");
}

function latestGitActivity(activity: Awaited<ReturnType<Awaited<ReturnType<typeof getStore>>["listActivity"]>>, taskId: string) {
  const matches = activity.filter((entry) => {
    if (!isGitActivity(entry.action)) return false;
    const meta = entry.meta && typeof entry.meta === "object" ? entry.meta as Record<string, unknown> : {};
    return meta.taskId === taskId || entry.action.includes("git") || entry.action.includes("validation");
  });
  matches.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return matches[0]?.timestamp || null;
}

export async function scanReminderFindings(options: ReminderScanOptions = {}): Promise<ReminderFinding[]> {
  const store = await getStore();
  const now = options.now || new Date();
  const staleHours = Math.max(1, options.staleHours || DEFAULT_STALE_HOURS);
  const reasons = new Set(options.reasons?.length ? options.reasons : ["overdue", "stale", "suspicious_completion"]);
  const clients = options.clientId
    ? ([await store.getClient(options.clientId)].filter(Boolean) as Client[])
    : await store.listClients();
  const users = await store.listUsers();
  const userMap = new Map(users.map((user) => [user.uid, user]));
  const findings: ReminderFinding[] = [];

  for (const client of clients) {
    const activity = await store.listActivity(client.id);
    const tasks = (await store.listTasks(client.id)).filter((task) => !options.taskId || task.id === options.taskId);
    for (const task of tasks) {
      const lastGitActivityAt = latestGitActivity(activity, task.id);
      const lastGitMs = validDate(lastGitActivityAt)?.getTime() || 0;
      const assignee = task.assignedTo ? userMap.get(task.assignedTo) : null;
      const common = {
        taskId: task.id,
        clientId: client.id,
        clientName: client.companyName || client.name,
        taskTitle: task.title,
        assigneeId: task.assignedTo,
        assigneeName: assignee?.name || null,
        dueDate: task.dueDate,
        lastGitActivityAt,
      };

      if (reasons.has("overdue") && task.status !== "completed" && validDate(task.dueDate)?.getTime() !== undefined && validDate(task.dueDate)!.getTime() < now.getTime()) {
        findings.push({ ...common, reason: "overdue", detail: `Due ${task.dueDate}; task is still ${task.status}.` });
      }

      const referenceMs = validDate(task.createdAt)?.getTime() || 0;
      if (reasons.has("stale") && task.status !== "completed" && now.getTime() - Math.max(lastGitMs, referenceMs) >= staleHours * 60 * 60 * 1000) {
        findings.push({ ...common, reason: "stale", detail: `No Git activity for at least ${staleHours} hours.` });
      }

      if (reasons.has("suspicious_completion") && task.status === "completed") {
        const completedMs = validDate(task.completedAt)?.getTime() || 0;
        const hasGitAfterStart = lastGitMs > 0 && lastGitMs >= (completedMs || referenceMs);
        const hasValidation = activity.some((entry) => entry.action === "task.progress_validated" && (entry.meta as Record<string, unknown> | undefined)?.taskId === task.id);
        if (!hasGitAfterStart && !hasValidation) {
          findings.push({ ...common, reason: "suspicious_completion", detail: "Completed without matching Git evidence or a recorded validation." });
        }
      }
    }
  }
  return findings;
}

function messageFor(finding: ReminderFinding) {
  return `[Boatship] ${finding.reason.replace("_", " ")}: ${finding.taskTitle} · ${finding.clientName}. ${finding.detail}`;
}

async function recipients(store: Awaited<ReturnType<typeof getStore>>, finding: ReminderFinding) {
  const users = await store.listUsers();
  const target = finding.assigneeId ? users.find((user) => user.uid === finding.assigneeId) : null;
  const admins = users.filter((user) => user.role === "admin");
  const unique = new Map<string, AppUser>();
  for (const user of [target, ...admins]) if (user) unique.set(user.uid, user);
  return [...unique.values()];
}

async function sendComposioNotification(userId: string, channel: ReminderChannel, text: string) {
  if (!(await isComposioConfiguredForUser(userId))) return { status: "skipped" as const, reason: "composio_not_configured" };
  const connections = await listBoatshipConnections(userId);
  const slug = channel === "slack" ? "slack" : channel === "telegram" ? "telegram" : "";
  if (!slug || !connections.some((connection) => connection.slug === slug && connection.connected)) {
    return { status: "skipped" as const, reason: `${slug || channel}_not_connected` };
  }
  const toolSlug = channel === "slack" ? "SLACK_SENDS_A_MESSAGE" : "TELEGRAM_BOT_SEND_MESSAGE";
  const args = channel === "slack"
    ? { channel: process.env.COMPOSIO_SLACK_CHANNEL || "general", text }
    : { chat_id: process.env.COMPOSIO_TELEGRAM_CHAT_ID || "", text };
  if (channel === "telegram" && !args.chat_id) return { status: "skipped" as const, reason: "telegram_chat_id_not_configured" };
  try {
    await executeTool({ boatshipUid: userId, toolSlug, arguments: args });
    return { status: "sent" as const };
  } catch (error) {
    return { status: "failed" as const, reason: error instanceof Error ? error.message : "provider_error" };
  }
}

export async function dispatchReminderFindings(options: ReminderDispatchOptions) {
  const store = await getStore();
  const findings = await scanReminderFindings(options);
  const requestedChannels: string[] = options.channels?.length ? options.channels : ["email", "telegram", "slack"];
  const channels = requestedChannels.filter((channel): channel is ReminderChannel => CHANNELS.includes(channel as ReminderChannel));
  const results: DispatchResult[] = [];
  for (const finding of findings) {
    const targets = await recipients(store, finding);
    const result: DispatchResult = { finding, channels: [] };
    for (const channel of channels) {
      if (options.dryRun !== false) {
        result.channels.push({ channel, status: "dry_run" });
        continue;
      }
      if (channel === "email") {
        const target = targets.find((user) => Boolean(user.email));
        if (!target) {
          result.channels.push({ channel, status: "skipped", reason: "no_email_recipient" });
          continue;
        }
        try {
          await sendEmail({ to: target.email, subject: `Boatship reminder: ${finding.taskTitle}`, html: `<p>${messageFor(finding)}</p>` });
          result.channels.push({ channel, status: "sent" });
        } catch (error) {
          result.channels.push({ channel, status: "failed", reason: error instanceof Error ? error.message : "email_error" });
        }
      } else {
        const target = targets[0];
        if (!target) result.channels.push({ channel, status: "skipped", reason: "no_staff_recipient" });
        else result.channels.push({ channel, ...(await sendComposioNotification(target.uid, channel, messageFor(finding))) });
      }
    }

    await store.addActivity({
      clientId: finding.clientId,
      actorId: options.actorId,
      actorName: options.actorName,
      action: options.dryRun === false ? "reminder.dispatched" : "reminder.scan.dry_run",
      meta: { taskId: finding.taskId, reason: finding.reason, channels: result.channels },
    });
    results.push(result);
  }
  return { dryRun: options.dryRun !== false, findings, results, count: findings.length };
}
