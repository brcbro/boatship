import { handleApi, jsonError } from "@/lib/api";
import { requireRoles } from "@/lib/auth";
import { canAccessClient } from "@/lib/client-access";
import { getPrisma } from "@/lib/prisma";
import { getStore } from "@/lib/store";
import type { ClientContactRole } from "@/types";
import { localClientDemo } from "@/lib/engagements";
import { isCurrentPrimaryContact } from "@/lib/client-contacts-policy";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string; contactId: string }> };
const ROLES: ClientContactRole[] = ["account_admin", "contributor", "viewer"];

export async function PATCH(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id, contactId } = await params;
    if (!await canAccessClient(session, id)) throw jsonError("Forbidden", 403);
    if (localClientDemo()) throw jsonError("Updating contacts requires a configured database", 501);
    const existing = await getPrisma().clientContact.findUnique({ where: { id: contactId } });
    if (!existing || existing.clientId !== id) throw jsonError("Contact not found", 404);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: { name?: string; email?: string; role?: ClientContactRole } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 160) throw jsonError("Invalid name", 400);
      patch.name = body.name.trim();
    }
    if (body.email !== undefined) {
      if (typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || body.email.length > 254) throw jsonError("Invalid email", 400);
      patch.email = body.email.trim().toLowerCase();
      const client = await (await getStore()).getClient(id);
      if (isCurrentPrimaryContact(existing.email, client?.primaryContactEmail) && patch.email !== existing.email) {
        throw jsonError("Update the primary email on the client account", 409);
      }
      const duplicate = await getPrisma().clientContact.findUnique({ where: { clientId_email: { clientId: id, email: patch.email } } });
      if (duplicate && duplicate.id !== contactId) throw jsonError("Contact email already exists", 409);
    }
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role as ClientContactRole)) throw jsonError("Invalid role", 400);
      patch.role = body.role as ClientContactRole;
    }
    if (!Object.keys(patch).length) throw jsonError("No changes provided", 400);
    let contact;
    try {
      contact = await getPrisma().clientContact.update({ where: { id: contactId }, data: patch });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw jsonError("Contact email already exists", 409);
      throw error;
    }
    return { contact };
  });
}

export async function DELETE(req: Request, { params }: Params) {
  return handleApi(async () => {
    const session = await requireRoles(req, ["admin", "team"]);
    const { id, contactId } = await params;
    if (!await canAccessClient(session, id)) throw jsonError("Forbidden", 403);
    if (localClientDemo()) throw jsonError("Removing contacts requires a configured database", 501);
    const existing = await getPrisma().clientContact.findUnique({ where: { id: contactId } });
    if (!existing || existing.clientId !== id) throw jsonError("Contact not found", 404);
    const client = await (await getStore()).getClient(id);
    if (isCurrentPrimaryContact(existing.email, client?.primaryContactEmail)) throw jsonError("Current primary contact cannot be removed", 409);
    await getPrisma().clientContact.delete({ where: { id: contactId } });
    return { deleted: true };
  });
}
