"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Mail, MessageCircleMore, ShieldAlert, Smartphone, Unplug } from "lucide-react";
import { Button, Card } from "@/components/shared/ui";
import type { HodiCommunicationChannel, HodiCommunicationPlan, HodiCommunicationType } from "@/lib/hodi-communications";

type Props = {
  plan: HodiCommunicationPlan;
  onChange?: (change: { channel: HodiCommunicationChannel; recipient: string; subject: string; body: string }) => void;
  onApprove?: () => void;
  approving?: boolean;
};

const channelLabels: Record<HodiCommunicationChannel, string> = {
  email: "Email",
  slack: "Slack",
  sms: "SMS (coming soon)",
  whatsapp: "WhatsApp (coming soon)",
};

const channelIcons = { email: Mail, slack: MessageCircleMore, sms: Smartphone, whatsapp: Smartphone };

export function CommunicationDraftCard({ plan, onChange, onApprove, approving = false }: Props) {
  const [channel, setChannel] = useState(plan.channel);
  const [recipient, setRecipient] = useState(plan.recipient);
  const [subject, setSubject] = useState(plan.subject || "");
  const [body, setBody] = useState(plan.body);
  const ChannelIcon = channelIcons[channel];
  const approved = plan.approval.state === "approved";

  function update(next: Partial<{ channel: HodiCommunicationChannel; recipient: string; subject: string; body: string }>) {
    const values = { channel, recipient, subject, body, ...next };
    if (next.channel) setChannel(next.channel);
    if (next.recipient !== undefined) setRecipient(next.recipient);
    if (next.subject !== undefined) setSubject(next.subject);
    if (next.body !== undefined) setBody(next.body);
    onChange?.(values);
  }

  async function copyDraft() {
    const content = [subject ? `Subject: ${subject}` : "", body].filter(Boolean).join("\n\n");
    await navigator.clipboard?.writeText(content);
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Hodi communication draft</p>
          <h3 className="mt-1 font-semibold text-[var(--ink)]">{plan.client.companyName}</h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f3ead2] px-3 py-1 text-xs font-medium text-[var(--ink)]">
          {approved ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> : <ShieldAlert className="h-3.5 w-3.5 text-[var(--warning)]" />}
          {approved ? "Approved for handoff" : "Approval required"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-[var(--ink)]">
          Channel
          <span className="relative">
            <select value={channel} onChange={(event) => update({ channel: event.target.value as HodiCommunicationChannel })} className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 pr-9 text-sm font-normal text-[var(--ink)]">
              {(Object.keys(channelLabels) as HodiCommunicationChannel[]).map((item) => <option key={item} value={item}>{channelLabels[item]}</option>)}
            </select>
            <ChannelIcon className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-[var(--ink-muted)]" />
          </span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-[var(--ink)]">
          Recipient
          <input value={recipient} onChange={(event) => update({ recipient: event.target.value })} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-normal text-[var(--ink)]" />
        </label>
      </div>

      {channel === "email" ? (
        <label className="grid gap-1.5 text-sm font-medium text-[var(--ink)]">
          Subject
          <input value={subject} onChange={(event) => update({ subject: event.target.value })} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-normal text-[var(--ink)]" />
        </label>
      ) : null}

      <label className="grid gap-1.5 text-sm font-medium text-[var(--ink)]">
        Draft message
        <textarea value={body} onChange={(event) => update({ body: event.target.value })} rows={8} className="resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-normal leading-6 text-[var(--ink)]" />
      </label>

      <div className="flex gap-2 rounded-lg border border-[var(--warning)]/30 bg-[#f3ead2]/60 p-3 text-sm text-[var(--ink)]">
        <Unplug className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" />
        <div><p className="font-medium">{plan.connection.required}</p><p className="mt-1 text-[var(--ink-muted)]">{plan.fallback}</p></div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
        <p className="max-w-lg text-xs leading-5 text-[var(--ink-muted)]">{plan.sendEligibility.reason}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={copyDraft}><Copy className="h-4 w-4" /> Copy draft</Button>
          <Button size="sm" onClick={onApprove} disabled={approved || approving || !onApprove}>{approved ? "Approved" : approving ? "Approving..." : "Approve plan"}</Button>
        </div>
      </div>
    </Card>
  );
}
