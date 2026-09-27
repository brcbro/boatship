import { Resend } from "resend";

type SenderName = "Boatship" | "Boatship Team" | "Boatship Updates";

function senderAddress(value: string | undefined) {
  const address = (value?.trim().match(/<([^<>]+)>$/)?.[1] || value?.trim())?.toLowerCase();
  return address && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address) && !/^onboarding@/i.test(address)
    ? address
    : null;
}

function escapeHtml(value: string | number) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function emailDeliveryConfigured() {
  if (process.env.ZEPTOMAIL_API_KEY) return Boolean(senderAddress(process.env.ZEPTOMAIL_FROM));
  return Boolean(process.env.RESEND_API_KEY && senderAddress(process.env.RESEND_FROM));
}

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  senderName?: SenderName;
};

export async function sendEmail(payload: EmailPayload) {
  if (process.env.ZEPTOMAIL_API_KEY) {
    const from = senderAddress(process.env.ZEPTOMAIL_FROM);
    if (!from) throw new Error("Email sender is not configured");
    const response = await fetch("https://cpaas.zoho.in/v1.1/email", {
      method: "POST",
      headers: {
        Authorization: `Zoho-enczapikey ${process.env.ZEPTOMAIL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: { address: from, name: payload.senderName || "Boatship" },
        to: [{ email_address: { address: payload.to } }],
        subject: payload.subject,
        htmlbody: payload.html,
      }),
    });
    if (!response.ok) throw new Error(`Email delivery failed (${response.status})`);
    const result = (await response.json()) as { request_id?: string };
    return { id: result.request_id || "sent", demo: false as const };
  }
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") throw new Error("Email delivery is not configured");
    console.info("[email:demo]", payload.to, payload.subject);
    return { id: `demo_${Date.now()}`, demo: true as const };
  }
  const from = senderAddress(process.env.RESEND_FROM);
  if (!from) throw new Error("Email sender is not configured");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: `${payload.senderName || "Boatship"} <${from}>`,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });
  if (result.error) {
    throw new Error(result.error.message);
  }
  return { id: result.data?.id || "sent", demo: false as const };
}

export function inviteEmailHtml(params: {
  name: string;
  companyName: string;
  loginUrl: string;
}) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a;line-height:1.5">
      <h1 style="color:#0b1f3a">Welcome to your Boatship workspace</h1>
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>You've been invited to work with <strong>${escapeHtml(params.companyName)}</strong> in Boatship. View engagements, tasks, documents, and messages in one place.</p>
      <p>Use the link below to set your password. It can only be used once.</p>
      <p><a href="${escapeHtml(params.loginUrl)}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">Set your password and open workspace</a></p>
    </div>
  `;
}

export function resetPasswordEmailHtml(params: {
  name: string;
  resetUrl: string;
}) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a;line-height:1.5">
      <h1 style="color:#0b1f3a">Reset your Boatship password</h1>
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>We received a request to reset your password. This link expires in 24 hours.</p>
      <p><a href="${escapeHtml(params.resetUrl)}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">Set a new password</a></p>
      <p style="font-size:13px;color:#64748b">If you did not request this, you can ignore this email.</p>
    </div>
  `;
}

export function taskAssignedSubject(taskTitle: string, engagement?: { type: string; name: string } | null) {
  const context = engagement?.type === "onboarding" ? "onboarding" : engagement?.name?.trim();
  return `New ${context ? `${context} ` : ""}task: ${taskTitle}`;
}

export function taskAssignedEmailHtml(params: { name: string; taskTitle: string; link: string; engagement?: { type: string; name: string } | null }) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a">
      <h2>New task assigned</h2>
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>You have a new task${params.engagement ? ` in <strong>${escapeHtml(params.engagement.name)}</strong>` : ""}: <strong>${escapeHtml(params.taskTitle)}</strong>.</p>
      <p><a href="${escapeHtml(params.link)}">Open task</a></p>
    </div>
  `;
}

export function documentReviewedEmailHtml(params: {
  name: string;
  fileName: string;
  status: string;
  note?: string;
  link: string;
}) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a">
      <h2>Document ${escapeHtml(params.status)}</h2>
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>Your document <strong>${escapeHtml(params.fileName)}</strong> was marked as <strong>${escapeHtml(params.status)}</strong>.</p>
      ${params.note ? `<p>Note: ${escapeHtml(params.note)}</p>` : ""}
      <p><a href="${escapeHtml(params.link)}">View documents</a></p>
    </div>
  `;
}

export function onboardingCompleteEmailHtml(params: { name: string; companyName: string }) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a">
      <h2>Onboarding complete</h2>
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>Congratulations — onboarding for <strong>${escapeHtml(params.companyName)}</strong> is complete.</p>
    </div>
  `;
}

export function overdueTaskEmailHtml(params: { name: string; taskTitle: string; dueDate: string; link: string }) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a">
      <h2>Overdue task</h2>
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>Task <strong>${escapeHtml(params.taskTitle)}</strong> was due on ${escapeHtml(params.dueDate)}.</p>
      <p><a href="${escapeHtml(params.link)}">Open task</a></p>
    </div>
  `;
}

export function nudgeEmailHtml(params: {
  name: string;
  companyName: string;
  progress: number;
  completedTasks: number;
  totalTasks: number;
  link: string;
}) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a;line-height:1.5">
      <h2>Friendly nudge</h2>
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>
        Just a reminder to keep going on onboarding for
        <strong>${escapeHtml(params.companyName)}</strong>.
        You're at <strong>${escapeHtml(params.progress)}%</strong>
        (${escapeHtml(params.completedTasks)} of ${escapeHtml(params.totalTasks)} tasks complete).
      </p>
      <p><a href="${escapeHtml(params.link)}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">Continue in your workspace</a></p>
    </div>
  `;
}

export function teamInviteEmailHtml(params: {
  name: string;
  role: string;
  loginUrl: string;
}) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a;line-height:1.5">
      <h2>You're on the Boatship team</h2>
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>You've been invited to the Boatship team as <strong>${escapeHtml(params.role)}</strong>. Manage client accounts and engagements in your workspace.</p>
      <p>Use the link below to set your password. It can only be used once.</p>
      <p><a href="${escapeHtml(params.loginUrl)}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">Set your password</a></p>
    </div>
  `;
}

export const TEAM_WELCOME_SUBJECT = "Your Boatship Client OS is ready";

export function teamWelcomeEmailHtml(params: { name: string; loginUrl: string }) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a;line-height:1.5">
      <h2>Your Boatship workspace is ready</h2>
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>Boatship now brings client accounts, engagements, tasks, documents, and messages into one workspace. Sign in with your existing account to take a look.</p>
      <p><a href="${escapeHtml(params.loginUrl)}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">Open Boatship</a></p>
    </div>
  `;
}

export function digestEmailHtml(params: {
  name: string;
  overdueTasks: Array<{ title: string; dueDate: string; clientName: string }>;
  pendingDocuments: Array<{ fileName: string; clientName: string }>;
  link: string;
}) {
  const overdue =
    params.overdueTasks.length === 0
      ? "<p>No overdue tasks.</p>"
      : `<ul>${params.overdueTasks
          .map(
            (t) =>
              `<li><strong>${escapeHtml(t.title)}</strong> — ${escapeHtml(t.clientName)} (due ${escapeHtml(t.dueDate)})</li>`
          )
          .join("")}</ul>`;
  const pending =
    params.pendingDocuments.length === 0
      ? "<p>No documents pending review.</p>"
      : `<ul>${params.pendingDocuments
          .map((d) => `<li><strong>${escapeHtml(d.fileName)}</strong> — ${escapeHtml(d.clientName)}</li>`)
          .join("")}</ul>`;
  return `
    <div style="font-family:Georgia,serif;color:#0f172a;line-height:1.5">
      <h2>Your Boatship digest</h2>
      <p>Hi ${escapeHtml(params.name)},</p>
      <h3>Overdue tasks (${params.overdueTasks.length})</h3>
      ${overdue}
      <h3>Pending documents (${params.pendingDocuments.length})</h3>
      ${pending}
      <p><a href="${escapeHtml(params.link)}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">Open dashboard</a></p>
    </div>
  `;
}

export function documentExpiringEmailHtml(params: {
  name: string;
  fileName: string;
  clientName: string;
  expiresAt: string;
  link: string;
}) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a;line-height:1.5">
      <h2>Document expiring soon</h2>
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>
        <strong>${escapeHtml(params.fileName)}</strong> for
        <strong>${escapeHtml(params.clientName)}</strong> expires on
        <strong>${escapeHtml(params.expiresAt)}</strong>.
      </p>
      <p><a href="${escapeHtml(params.link)}">Review document</a></p>
    </div>
  `;
}
