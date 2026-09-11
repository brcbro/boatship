import { Resend } from "resend";

const FROM = process.env.RESEND_FROM || "Boatship Onboarding <onboarding@resend.dev>";

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail(payload: EmailPayload) {
  if (!process.env.RESEND_API_KEY) {
    console.info("[email:demo]", payload.to, payload.subject);
    return { id: `demo_${Date.now()}`, demo: true as const };
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: FROM,
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
  tempPassword?: string;
  ctaLabel?: string;
}) {
  const cta = params.ctaLabel || "Sign in to your portal";
  return `
    <div style="font-family:Georgia,serif;color:#0f172a;line-height:1.5">
      <h1 style="color:#0b1f3a">Welcome to Boatship Onboarding</h1>
      <p>Hi ${params.name},</p>
      <p>You've been invited to complete onboarding for <strong>${params.companyName}</strong>.</p>
      ${
        params.tempPassword
          ? `<p>Temporary password: <code>${params.tempPassword}</code></p>`
          : ""
      }
      <p><a href="${params.loginUrl}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">${cta}</a></p>
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
      <p>Hi ${params.name},</p>
      <p>We received a request to reset your password. This link expires in 24 hours.</p>
      <p><a href="${params.resetUrl}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">Set a new password</a></p>
      <p style="font-size:13px;color:#64748b">If you did not request this, you can ignore this email.</p>
    </div>
  `;
}

export function taskAssignedEmailHtml(params: { name: string; taskTitle: string; link: string }) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a">
      <h2>New task assigned</h2>
      <p>Hi ${params.name},</p>
      <p>You have a new onboarding task: <strong>${params.taskTitle}</strong>.</p>
      <p><a href="${params.link}">Open task</a></p>
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
      <h2>Document ${params.status}</h2>
      <p>Hi ${params.name},</p>
      <p>Your document <strong>${params.fileName}</strong> was marked as <strong>${params.status}</strong>.</p>
      ${params.note ? `<p>Note: ${params.note}</p>` : ""}
      <p><a href="${params.link}">View documents</a></p>
    </div>
  `;
}

export function onboardingCompleteEmailHtml(params: { name: string; companyName: string }) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a">
      <h2>Onboarding complete</h2>
      <p>Hi ${params.name},</p>
      <p>Congratulations — onboarding for <strong>${params.companyName}</strong> is complete.</p>
    </div>
  `;
}

export function overdueTaskEmailHtml(params: { name: string; taskTitle: string; dueDate: string; link: string }) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a">
      <h2>Overdue task</h2>
      <p>Hi ${params.name},</p>
      <p>Task <strong>${params.taskTitle}</strong> was due on ${params.dueDate}.</p>
      <p><a href="${params.link}">Open task</a></p>
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
      <p>Hi ${params.name},</p>
      <p>
        Just a reminder to keep going on onboarding for
        <strong>${params.companyName}</strong>.
        You're at <strong>${params.progress}%</strong>
        (${params.completedTasks} of ${params.totalTasks} tasks complete).
      </p>
      <p><a href="${params.link}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">Continue in your portal</a></p>
    </div>
  `;
}

export function teamInviteEmailHtml(params: {
  name: string;
  role: string;
  loginUrl: string;
  tempPassword: string;
}) {
  return `
    <div style="font-family:Georgia,serif;color:#0f172a;line-height:1.5">
      <h2>You're on the Boatship team</h2>
      <p>Hi ${params.name},</p>
      <p>You've been invited as <strong>${params.role}</strong>.</p>
      <p>Temporary password: <code>${params.tempPassword}</code></p>
      <p><a href="${params.loginUrl}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">Sign in</a></p>
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
              `<li><strong>${t.title}</strong> — ${t.clientName} (due ${t.dueDate})</li>`
          )
          .join("")}</ul>`;
  const pending =
    params.pendingDocuments.length === 0
      ? "<p>No documents pending review.</p>"
      : `<ul>${params.pendingDocuments
          .map((d) => `<li><strong>${d.fileName}</strong> — ${d.clientName}</li>`)
          .join("")}</ul>`;
  return `
    <div style="font-family:Georgia,serif;color:#0f172a;line-height:1.5">
      <h2>Your Boatship digest</h2>
      <p>Hi ${params.name},</p>
      <h3>Overdue tasks (${params.overdueTasks.length})</h3>
      ${overdue}
      <h3>Pending documents (${params.pendingDocuments.length})</h3>
      ${pending}
      <p><a href="${params.link}" style="background:#0b1f3a;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">Open dashboard</a></p>
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
      <p>Hi ${params.name},</p>
      <p>
        <strong>${params.fileName}</strong> for
        <strong>${params.clientName}</strong> expires on
        <strong>${params.expiresAt}</strong>.
      </p>
      <p><a href="${params.link}">Review document</a></p>
    </div>
  `;
}
