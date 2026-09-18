import { randomUUID } from "crypto";
import type {
  AccountingCategory,
  AccountingEntry,
  AccountingSplit,
  AccountingSplitMode,
  AccountingStatus,
} from "@/types";
import { getStore } from "@/lib/store";

type AccountingData = { accounting?: { entries?: AccountingEntry[] } };
type PersonRef = { personId: string; personName: string };

const categories: AccountingCategory[] = ["rent", "emi", "misc"];
const splitModes: AccountingSplitMode[] = ["equal", "specific"];

function number(value: unknown, label: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} cannot be negative`);
  return Math.round(parsed * 100) / 100;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function statusFor(splits: AccountingSplit[]): AccountingStatus {
  const total = splits.reduce((sum, split) => sum + split.amount, 0);
  const paid = splits.reduce((sum, split) => sum + Math.min(split.amount, split.paidAmount), 0);
  if (total > 0 && paid >= total) return "settled";
  if (paid > 0) return "partially_paid";
  return "pending";
}

function parsePeople(value: unknown): PersonRef[] {
  if (!Array.isArray(value)) return [];
  const people: PersonRef[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = (raw || {}) as Record<string, unknown>;
    const personId = text(item.personId);
    const personName = text(item.personName);
    if (!personId || !personName || seen.has(personId)) continue;
    seen.add(personId);
    people.push({ personId, personName });
  }
  return people;
}

function equalAllocations(amount: number, people: PersonRef[], paidIds: Set<string>) {
  const totalCents = Math.round(amount * 100);
  const baseCents = Math.floor(totalCents / people.length);
  let remainder = totalCents - baseCents * people.length;
  return people.map((person): AccountingSplit => {
    const cents = baseCents + (remainder-- > 0 ? 1 : 0);
    const allocated = cents / 100;
    return {
      id: randomUUID(),
      ...person,
      amount: allocated,
      paidAmount: paidIds.has(person.personId) ? allocated : 0,
    };
  });
}

function normalizeStoredEntry(entry: AccountingEntry): AccountingEntry {
  const inferredMode: AccountingSplitMode = entry.splits.length === 1 ? "specific" : "equal";
  return {
    ...entry,
    paidById: entry.paidById || "",
    paidByName: entry.paidByName || "Not recorded",
    splitMode: entry.splitMode || inferredMode,
  };
}

export function validateAccountingInput(
  value: Record<string, unknown>,
  createdBy: string,
  existing?: AccountingEntry
): AccountingEntry {
  const title = text(value.title);
  const category = text(value.category) as AccountingCategory;
  const month = text(value.month);
  const paidById = text(value.paidById);
  const paidByName = text(value.paidByName);
  const splitMode = text(value.splitMode) as AccountingSplitMode;
  if (!title) throw new Error("Expense name is required");
  if (!categories.includes(category)) throw new Error("Choose rent, EMI, or miscellaneous");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must use YYYY-MM");
  if (!paidById || !paidByName) throw new Error("Choose who paid the bill");
  if (!splitModes.includes(splitMode)) throw new Error("Choose how the bill should be divided");

  const amount = number(value.amount, "Total amount");
  if (amount <= 0) throw new Error("Total amount must be greater than zero");
  const selectedPeople = parsePeople(value.participants);
  const paidIds = new Set(
    Array.isArray(value.paidPersonIds) ? value.paidPersonIds.map(text).filter(Boolean) : []
  );
  paidIds.add(paidById);

  let splits: AccountingSplit[];
  if (splitMode === "specific") {
    const specificPersonId = text(value.specificPersonId);
    const person = selectedPeople.find((item) => item.personId === specificPersonId);
    if (!person) throw new Error("Choose the person responsible for this bill");
    splits = [{
      id: randomUUID(),
      ...person,
      amount,
      paidAmount: paidIds.has(person.personId) ? amount : 0,
    }];
  } else {
    if (selectedPeople.length === 0) throw new Error("Choose at least one person for the equal split");
    splits = equalAllocations(amount, selectedPeople, paidIds);
  }

  const dueDate = text(value.dueDate) || null;
  if (dueDate && Number.isNaN(Date.parse(dueDate))) throw new Error("Due date must be valid");
  const timestamp = new Date().toISOString();
  return {
    id: existing?.id || randomUUID(),
    title,
    category,
    amount,
    month,
    dueDate,
    status: statusFor(splits),
    paidById,
    paidByName,
    splitMode,
    splits,
    createdBy: existing?.createdBy || createdBy,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

export async function listAccountingEntries(month?: string) {
  const store = await getStore();
  const data = await store.readProjectOps<AccountingData>();
  return [...(Array.isArray(data.accounting?.entries) ? data.accounting.entries : [])]
    .map(normalizeStoredEntry)
    .filter((entry) => !month || entry.month === month)
    .sort((a, b) => b.month.localeCompare(a.month) || b.updatedAt.localeCompare(a.updatedAt));
}

export async function createAccountingEntry(input: Record<string, unknown>, createdBy: string) {
  const entry = validateAccountingInput(input, createdBy);
  const store = await getStore();
  await store.mutateProjectOps<AccountingData>((data) => {
    const accounting = data.accounting || { entries: [] };
    accounting.entries = [...(accounting.entries || []), entry];
    data.accounting = accounting;
  });
  return entry;
}

export async function updateAccountingEntry(id: string, input: Record<string, unknown>, updatedBy: string) {
  const store = await getStore();
  let updated: AccountingEntry | null = null;
  await store.mutateProjectOps<AccountingData>((data) => {
    const accounting = data.accounting || { entries: [] };
    const index = (accounting.entries || []).findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error("Accounting entry not found");
    updated = validateAccountingInput(input, updatedBy, normalizeStoredEntry(accounting.entries![index]));
    accounting.entries![index] = updated;
    data.accounting = accounting;
  });
  return updated!;
}

export async function deleteAccountingEntry(id: string) {
  const store = await getStore();
  let deleted = false;
  await store.mutateProjectOps<AccountingData>((data) => {
    const accounting = data.accounting || { entries: [] };
    const before = accounting.entries?.length || 0;
    accounting.entries = (accounting.entries || []).filter((entry) => entry.id !== id);
    deleted = accounting.entries.length !== before;
    data.accounting = accounting;
  });
  if (!deleted) throw new Error("Accounting entry not found");
}
