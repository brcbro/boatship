import { handleApi } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { createAccountingEntry, listAccountingEntries } from "@/lib/accounting";

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
