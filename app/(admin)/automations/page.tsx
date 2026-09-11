"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Clock3, Play, ShieldCheck, Sparkles } from "lucide-react";
import type { HodiAutomationReview, HodiAutomationRule } from "@/lib/hodi-automations";

const SESSION_KEY = "boatship-hodi-automation-rules";

const authorityStyle: Record<HodiAutomationRule["authority"], string> = {
  Observe: "bg-sky-50 text-sky-700 ring-sky-200",
  Draft: "bg-violet-50 text-violet-700 ring-violet-200",
  "Internal autopilot": "bg-amber-50 text-amber-800 ring-amber-200",
  "External approved": "bg-rose-50 text-rose-700 ring-rose-200",
};

export default function AutomationsPage() {
  const [rules, setRules] = useState<readonly HodiAutomationRule[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [clientName, setClientName] = useState("");
  const [review, setReview] = useState<HodiAutomationReview | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setEnabled(parsed.filter((value): value is string => typeof value === "string"));
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
      }
    }

    void fetch("/api/automations")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load automations.");
        setRules(payload.rules || []);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load automations."));
  }, []);

  const enabledCount = useMemo(() => enabled.filter((id) => rules.some((rule) => rule.id === id)).length, [enabled, rules]);

  function toggleRule(id: string) {
    setEnabled((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function runRule(ruleId: string) {
    setRunning(ruleId);
    setError("");
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId, clientName }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to run this check.");
      setReview(payload.review);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to run this check.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-sm">
        <div className="grid gap-6 bg-[radial-gradient(circle_at_top_right,_rgba(14,116,144,.14),_transparent_36%),linear-gradient(135deg,#062c34,#0b4f58)] px-6 py-8 text-white md:grid-cols-[1fr_auto] md:px-9 md:py-10">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-cyan-100"><Sparkles className="h-4 w-4" /> Hodi Automation Center</div>
            <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-tight md:text-4xl">A reliable work queue for onboarding.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-cyan-50/85">Hodi can scan, prepare drafts, and queue internal work. Every result is reviewable and no external message is sent without explicit approval.</p>
          </div>
          <div className="self-end rounded-xl border border-white/15 bg-white/10 px-5 py-4 backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-100">Enabled this session</p>
            <p className="mt-1 text-3xl font-semibold">{enabledCount}<span className="text-base font-normal text-cyan-100"> / {rules.length}</span></p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-6 py-4 text-sm text-[var(--muted)] md:px-9">
          <ShieldCheck className="h-4 w-4 text-emerald-600" /> Rule selection is saved only for this browser session. Scheduled background runs are not enabled yet.
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div><h2 className="text-xl font-semibold text-[var(--ink)]">Automation rules</h2><p className="mt-1 text-sm text-[var(--muted)]">Enable the routines Hodi should keep ready for your next working session.</p></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {rules.map((rule) => {
              const isEnabled = enabled.includes(rule.id);
              return <article key={rule.id} className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div><h3 className="font-semibold text-[var(--ink)]">{rule.name}</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{rule.description}</p></div>
                  <button type="button" onClick={() => toggleRule(rule.id)} aria-pressed={isEnabled} className={`relative h-7 w-12 shrink-0 rounded-full transition ${isEnabled ? "bg-[var(--brand)]" : "bg-slate-200"}`}>
                    <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${isEnabled ? "left-6" : "left-1"}`} />
                    <span className="sr-only">{isEnabled ? "Disable" : "Enable"} {rule.name}</span>
                  </button>
                </div>
                <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium">
                  <span className={`rounded-full px-2.5 py-1 ring-1 ${authorityStyle[rule.authority]}`}>{rule.authority}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[var(--muted)]"><Clock3 className="h-3.5 w-3.5" />{rule.schedule}</span>
                </div>
                <p className="mt-4 text-xs leading-5 text-[var(--muted)]">{rule.output}</p>
                <button type="button" onClick={() => void runRule(rule.id)} disabled={running === rule.id} className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--brand)] px-3 py-2 text-sm font-medium text-[var(--brand)] transition hover:bg-[var(--surface-2)] disabled:cursor-wait disabled:opacity-60"><Play className="h-4 w-4" />{running === rule.id ? "Preparing..." : "Run review now"}</button>
              </article>;
            })}
          </div>
        </div>

        <aside className="h-fit rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-sm lg:sticky lg:top-6">
          <div className="flex items-center gap-2"><Bot className="h-5 w-5 text-[var(--brand)]" /><h2 className="font-semibold text-[var(--ink)]">Run a focused check</h2></div>
          <label className="mt-5 block text-sm font-medium text-[var(--ink)]" htmlFor="automation-client">Client or project</label>
          <input id="automation-client" value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="e.g. Acme website launch" className="mt-2 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15" />
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Optional. Add a client name so the review result is easy to identify.</p>
          <div className="mt-6 border-t border-[var(--border)] pt-5"><p className="text-sm font-medium text-[var(--ink)]">Authority levels</p><div className="mt-3 space-y-3 text-xs leading-5 text-[var(--muted)]"><p><strong className="text-[var(--ink)]">Observe:</strong> inspect and report.</p><p><strong className="text-[var(--ink)]">Draft:</strong> prepare content for review.</p><p><strong className="text-[var(--ink)]">Internal autopilot:</strong> propose internal work; review remains required.</p><p><strong className="text-[var(--ink)]">External approved:</strong> only send after a separate explicit approval.</p></div></div>
        </aside>
      </section>

      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {review ? <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-6 shadow-sm"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><p className="text-sm font-medium text-emerald-800">{review.status === "observed" ? "Check complete" : "Ready for review"}</p><h2 className="mt-1 text-xl font-semibold text-[var(--ink)]">{review.title}</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{review.summary}</p><p className="mt-4 text-sm font-medium text-[var(--ink)]">Evidence Hodi would check</p><ul className="mt-2 flex flex-wrap gap-2">{review.evidence.map((item) => <li key={item} className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs text-emerald-800">{item}</li>)}</ul><p className="mt-4 text-sm text-[var(--ink)]"><strong>Next step:</strong> {review.nextStep}</p><p className="mt-3 text-xs text-[var(--muted)]">No external action has been sent. Generated {new Date(review.generatedAt).toLocaleString()}.</p></div></div></section> : null}
    </div>
  );
}
