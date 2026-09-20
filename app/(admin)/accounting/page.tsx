"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleDollarSign,
  Equal,
  Plus,
  Pencil,
  ReceiptText,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import type { AccountingCategory, AccountingEntry, AccountingSplitMode } from "@/types";

type Person = { uid: string; name: string; email: string };
type Draft = {
  editingId: string | null;
  title: string;
  category: AccountingCategory;
  amount: string;
  month: string;
  dueDate: string;
  paidById: string;
  splitMode: AccountingSplitMode;
  participantIds: string[];
  specificPersonId: string;
  paidPersonIds: string[];
};

const todayMonth = new Date().toISOString().slice(0, 7);
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function blank(): Draft {
  return {
    editingId: null,
    title: "",
    category: "rent",
    amount: "",
    month: todayMonth,
    dueDate: "",
    paidById: "",
    splitMode: "equal",
    participantIds: [],
    specificPersonId: "",
    paidPersonIds: [],
  };
}

function draftFromEntry(entry: AccountingEntry): Draft {
  const participants = entry.splits.map((split) => split.personId);
  return {
    editingId: entry.id,
    title: entry.title,
    category: entry.category,
    amount: String(entry.amount),
    month: entry.month,
    dueDate: entry.dueDate || "",
    paidById: entry.paidById,
    splitMode: entry.splitMode,
    participantIds: entry.splitMode === "equal" ? participants : [],
    specificPersonId: entry.splitMode === "specific" ? participants[0] || "" : "",
    paidPersonIds: entry.splits.filter((split) => split.personId !== entry.paidById && split.paidAmount >= split.amount).map((split) => split.personId),
  };
}

function categoryLabel(category: AccountingCategory) {
  return category === "emi" ? "EMI" : category === "misc" ? "Miscellaneous" : "Rent";
}

function calculatedAmounts(amount: number, personIds: string[]) {
  if (!personIds.length || amount <= 0) return new Map<string, number>();
  const totalCents = Math.round(amount * 100);
  const baseCents = Math.floor(totalCents / personIds.length);
  let remainder = totalCents - baseCents * personIds.length;
  return new Map(personIds.map((id) => [id, (baseCents + (remainder-- > 0 ? 1 : 0)) / 100]));
}

export default function AccountingPage() {
  const { token, session } = useAuth();
  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [month, setMonth] = useState(todayMonth);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    if (session?.role !== "admin") {
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const [ledger, staff] = await Promise.all([
        apiFetch<{ entries: AccountingEntry[] }>(`/api/accounting?month=${encodeURIComponent(month)}`, { token }),
        apiFetch<{ users: Person[] }>("/api/users", { token }),
      ]);
      setEntries(ledger.entries);
      setPeople(staff.users);
      setLastSyncedAt(new Date());
    } catch (reason) {
      if (!silent) setError(reason instanceof Error ? reason.message : "Could not load the accounting ledger");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [month, session?.role, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 120_000);
    const refresh = () => void load(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  const totals = useMemo(() => entries.reduce((summary, entry) => {
    summary.total += entry.amount;
    summary.outstanding += entry.splits.reduce(
      (sum, allocation) => sum + Math.max(0, allocation.amount - allocation.paidAmount),
      0
    );
    summary[entry.category] += entry.amount;
    return summary;
  }, { total: 0, outstanding: 0, rent: 0, emi: 0, misc: 0 }), [entries]);

  const activePersonIds = draft
    ? draft.splitMode === "specific"
      ? draft.specificPersonId ? [draft.specificPersonId] : []
      : draft.participantIds
    : [];
  const previewAmounts = calculatedAmounts(Number(draft?.amount || 0), activePersonIds);

  function startNew() {
    setError("");
    setNotice("");
    setDraft(blank());
  }

  function startEdit(entry: AccountingEntry) {
    setError("");
    setNotice("");
    setDraft(draftFromEntry(entry));
  }

  function toggleParticipant(personId: string) {
    if (!draft) return;
    const selected = draft.participantIds.includes(personId);
    setDraft({
      ...draft,
      participantIds: selected
        ? draft.participantIds.filter((id) => id !== personId)
        : [...draft.participantIds, personId],
      paidPersonIds: selected
        ? draft.paidPersonIds.filter((id) => id !== personId)
        : draft.paidPersonIds,
    });
  }

  function toggleSettled(personId: string) {
    if (!draft || personId === draft.paidById) return;
    const settled = draft.paidPersonIds.includes(personId);
    setDraft({
      ...draft,
      paidPersonIds: settled
        ? draft.paidPersonIds.filter((id) => id !== personId)
        : [...draft.paidPersonIds, personId],
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payer = people.find((person) => person.uid === draft.paidById);
      const peopleForBill = people
        .filter((person) => activePersonIds.includes(person.uid))
        .map((person) => ({ personId: person.uid, personName: person.name }));
      const payload = {
        ...draft,
        amount: Number(draft.amount),
        paidByName: payer?.name || "",
        participants: peopleForBill,
      };
      await apiFetch(`/api/accounting${draft.editingId ? `?id=${encodeURIComponent(draft.editingId)}` : ""}`, {
        method: draft.editingId ? "PUT" : "POST",
        token,
        body: JSON.stringify(payload),
      });
      setNotice(draft.editingId ? "Ledger entry updated and synced for all admins." : "Expense added and synced for all admins.");
      setDraft(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the expense");
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: AccountingEntry) {
    if (!confirm(`Delete “${entry.title}” from the shared ledger?`)) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/accounting?id=${encodeURIComponent(entry.id)}`, { method: "DELETE", token });
      setNotice("Ledger entry deleted.");
      if (draft?.editingId === entry.id) setDraft(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete the ledger entry");
    } finally {
      setSaving(false);
    }
  }

  if (session?.role !== "admin") {
    return <EmptyState title="Admin access required" description="The shared accounting ledger is available to Boatship administrators only." />;
  }

  return <div className="mx-auto max-w-7xl space-y-6">
    <PageHeader
      title="Accounting"
      description="Record who paid each bill, then divide it equally or assign it to one person. Boatship calculates the amounts automatically."
      actions={<Button onClick={startNew}><Plus className="h-4 w-4" aria-hidden="true" />Add expense</Button>}
    />

    <Card className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Label htmlFor="ledger-month">Ledger month</Label>
        <Input id="ledger-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-44" />
      </div>
      <p className="max-w-lg text-sm text-[var(--ink-muted)]">
        Shared across every admin account. New expenses refresh automatically for everyone.
      </p>
      <span role="status" aria-atomic="true" className="text-xs text-[var(--ink-muted)]">
        {lastSyncedAt ? `Synced ${lastSyncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Syncing…"}
      </span>
    </Card>

    {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
    {notice ? <p aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}

    <section aria-label="Monthly accounting summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: "Monthly total", value: totals.total, icon: CircleDollarSign },
        { label: "Rent", value: totals.rent, icon: ReceiptText },
        { label: "EMIs", value: totals.emi, icon: ReceiptText },
        { label: "Still owed", value: totals.outstanding, icon: UsersRound },
      ].map(({ label, value, icon: Icon }) => <Card key={label} className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-sm text-[var(--ink-muted)]">{label}</p>
          <Icon className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
        </div>
        <p className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums text-[var(--ink)]">{money.format(value)}</p>
      </Card>)}
    </section>

    {draft ? <Card className="border-[var(--accent)]/35 p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--ink)]">{draft.editingId ? "Edit ledger entry" : "New expense"}</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Tell us who paid and who the bill belongs to. Amounts are calculated for you.</p>
        </div>
        <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
      </div>

      <form onSubmit={save} className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div><Label htmlFor="expense-title">Expense name</Label><Input id="expense-title" required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Apartment rent" /></div>
          <div><Label htmlFor="expense-category">Category</Label><Select id="expense-category" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as AccountingCategory })}><option value="rent">Rent</option><option value="emi">EMI</option><option value="misc">Miscellaneous</option></Select></div>
          <div><Label htmlFor="expense-total">Total amount</Label><Input id="expense-total" required min="0.01" step="0.01" inputMode="decimal" type="number" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></div>
          <div><Label htmlFor="expense-due">Due date <span className="font-normal text-[var(--ink-muted)]">(optional)</span></Label><Input id="expense-due" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <Label htmlFor="paid-by">Who paid?</Label>
            <Select id="paid-by" required value={draft.paidById} onChange={(event) => setDraft({ ...draft, paidById: event.target.value })}>
              <option value="">Select payer</option>
              {people.map((person) => <option key={person.uid} value={person.uid}>{person.name}</option>)}
            </Select>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">This person paid the bill upfront.</p>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-[var(--ink)]">How should this bill be divided?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { value: "equal" as const, title: "Split equally", detail: "Divide it evenly between selected people", Icon: Equal },
                { value: "specific" as const, title: "One person", detail: "Assign the full bill to a specific person", Icon: UserRound },
              ].map(({ value, title, detail, Icon }) => <label key={value} className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${draft.splitMode === value ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/50"}`}>
                <input type="radio" name="split-mode" value={value} checked={draft.splitMode === value} onChange={() => setDraft({ ...draft, splitMode: value })} className="mt-1" />
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                <span><span className="block font-medium text-[var(--ink)]">{title}</span><span className="mt-1 block text-xs text-[var(--ink-muted)]">{detail}</span></span>
              </label>)}
            </div>
          </fieldset>
        </div>

        {draft.splitMode === "equal" ? <fieldset>
          <legend className="mb-2 text-sm font-medium text-[var(--ink)]">Who is included?</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((person) => <label key={person.uid} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 transition hover:border-[var(--accent)]/50">
              <input type="checkbox" checked={draft.participantIds.includes(person.uid)} onChange={() => toggleParticipant(person.uid)} />
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-[var(--ink)]">{person.name}</span>{previewAmounts.has(person.uid) ? <span className="block text-xs tabular-nums text-[var(--ink-muted)]">{money.format(previewAmounts.get(person.uid) || 0)} each</span> : null}</span>
            </label>)}
          </div>
        </fieldset> : <div className="max-w-md">
          <Label htmlFor="responsible-person">Who is responsible for this bill?</Label>
          <Select id="responsible-person" required value={draft.specificPersonId} onChange={(event) => setDraft({ ...draft, specificPersonId: event.target.value })}>
            <option value="">Select person</option>
            {people.map((person) => <option key={person.uid} value={person.uid}>{person.name}</option>)}
          </Select>
        </div>}

        {activePersonIds.length > 0 && Number(draft.amount) > 0 ? <fieldset>
          <legend className="mb-2 text-sm font-medium text-[var(--ink)]">Payment status</legend>
          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            {activePersonIds.map((personId) => {
              const person = people.find((item) => item.uid === personId);
              const payer = personId === draft.paidById;
              const settled = payer || draft.paidPersonIds.includes(personId);
              return <label key={personId} className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
                <span><span className="block text-sm font-medium text-[var(--ink)]">{person?.name}</span><span className="block text-xs tabular-nums text-[var(--ink-muted)]">{money.format(previewAmounts.get(personId) || 0)} {payer ? "covered by payer" : "owed"}</span></span>
                <span className="flex items-center gap-2 text-sm text-[var(--ink)]"><input type="checkbox" checked={settled} disabled={payer} onChange={() => toggleSettled(personId)} />{settled ? "Settled" : "Not settled"}</span>
              </label>;
            })}
          </div>
        </fieldset> : null}

        <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? "Saving…" : draft.editingId ? "Save ledger changes" : "Add to shared ledger"}</Button></div>
      </form>
    </Card> : null}

    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--ink)]">{new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })} ledger</h2>
        <Badge tone="info">{entries.length} item{entries.length === 1 ? "" : "s"}</Badge>
      </div>
      {loading ? <Card className="p-8 text-sm text-[var(--ink-muted)]">Loading ledger…</Card> : entries.length === 0 ? <EmptyState title="No expenses for this month" description="Add rent, an EMI, or another bill and record who paid it." action={<Button onClick={startNew}><Plus className="h-4 w-4" aria-hidden="true" />Add first expense</Button>} /> : <div className="space-y-4">
        {entries.map((entry) => <Card key={entry.id} className="overflow-hidden p-0">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-[var(--ink)]">{entry.title}</h3>
                <Badge tone={entry.category === "rent" ? "info" : entry.category === "emi" ? "warning" : "neutral"}>{categoryLabel(entry.category)}</Badge>
                <Badge tone={entry.status === "settled" ? "success" : entry.status === "partially_paid" ? "warning" : "danger"}>{entry.status === "settled" ? "Settled" : entry.status === "partially_paid" ? "Partially settled" : "Not settled"}</Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Paid by <span className="font-medium text-[var(--ink)]">{entry.paidByName}</span> · {entry.splitMode === "equal" ? `split equally between ${entry.splits.length}` : `assigned to ${entry.splits[0]?.personName || "one person"}`}</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">{entry.dueDate ? `Due ${new Date(`${entry.dueDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "No due date"} · Total {money.format(entry.amount)}</p>
            </div>
            <div className="flex items-center gap-2"><Badge tone="info">Shared ledger</Badge><Button type="button" size="sm" variant="secondary" onClick={() => startEdit(entry)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit</Button><Button type="button" size="sm" variant="ghost" className="text-[var(--danger)]" onClick={() => void remove(entry)} disabled={saving}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete</Button></div>
          </div>
          <div className="border-t border-[var(--border)] bg-[var(--surface)]/50 px-5 py-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{entry.splits.map((allocation) => {
              const settled = allocation.paidAmount >= allocation.amount;
              return <div key={allocation.id} className="rounded-lg bg-[var(--surface-raised)] px-3 py-2 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium text-[var(--ink)]">{allocation.personName}</span><Badge tone={settled ? "success" : "warning"}>{settled ? "Settled" : "Owes"}</Badge></div><p className="mt-1 tabular-nums text-[var(--ink-muted)]">{money.format(allocation.amount)}</p></div>;
            })}</div>
          </div>
        </Card>)}
      </div>}
    </section>
  </div>;
}
