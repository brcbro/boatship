import { randomUUID } from "crypto";
import { handleApi, jsonError } from "@/lib/api";
import { requireRoles, requireSession } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { ensurePrimaryContact } from "@/lib/client-contacts";
import { localClientDemo } from "@/lib/engagements";
import { CLIENT_CONTACTS, findClientContactByEmail, type ClientContactDoc } from "@/lib/client-contacts";
import { nowIso } from "@/lib/firestore";
import { getStore } from "@/lib/store";
import type { ClientContactRole } from "@/types";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };
const ROLES: ClientContactRole[] = ["account_admin", "contributor", "viewer"];

export async function GET(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    if (!await canAccessClient(session, id)) throw jsonError("Forbidden", 403);
    const client = await (await getStore()).getClient(id);
    if (!client) throw jsonError("Client not found", 404);
    await ensurePrimaryContact(client);
    if (localClientDemo()) return { contacts: client.primaryContactEmail ? [{
      id: `primary_${id}`, clientId: id, name: client.name, email: client.primaryContactEmail,
      role: "account_admin", createdAt: client.createdAt, updatedAt: client.updatedAt,
    }] : [] };
    const contacts = (await CLIENT_CONTACTS.find([{ field: "clientId", op: "==", value: id }])).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { contacts };
  });
}

export async function POST(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id } = await params;
    if (!await canAccessClient(session, id)) throw jsonError("Forbidden", 403);
    const client = await (await getStore()).getClient(id);
    if (!client) throw jsonError("Client not found", 404);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (localClientDemo()) throw jsonError("Creating contacts requires a configured database", 501);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!name || name.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw jsonError("Invalid contact", 400);
    if (!ROLES.includes(body.role as ClientContactRole)) throw jsonError("Invalid role", 400);
    await ensurePrimaryContact(client);
    const existing = await findClientContactByEmail(id, email);
    if (existing) throw jsonError("Contact email already exists", 409);
    const stamp = nowIso();
    const contact: ClientContactDoc = { id: randomUUID(), clientId: id, name, email, role: body.role as ClientContactRole, createdAt: stamp, updatedAt: stamp };
    await CLIENT_CONTACTS.create(contact.id, contact);
    return { contact };
  });
}
