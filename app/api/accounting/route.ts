import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { createAccountingEntry, deleteAccountingEntry, listAccountingEntries, updateAccountingEntry } from "@/lib/accounting";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const month = new URL(req.url).searchParams.get("month") || undefined;
    return { entries: await listAccountingEntries(month) };
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { entry: await createAccountingEntry(body, session.uid) };
  });
}

export async function PUT(req: Request) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin"]);
    const id = new URL(req.url).searchParams.get("id")?.trim();
    if (!id) throw new Error("Ledger entry id is required");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { entry: await updateAccountingEntry(id, body, session.uid) };
  });
}

export async function DELETE(req: Request) {
  return handleApi(async () => {
    await requireRoles(req, ["admin"]);
    const id = new URL(req.url).searchParams.get("id")?.trim();
    if (!id) throw new Error("Ledger entry id is required");
    await deleteAccountingEntry(id);
    return { ok: true };
  });
}
