import type { AuthSession } from "@/types";
import { getStore } from "@/lib/store";
import { getPrisma } from "@/lib/prisma";
import { hasClientAssignment } from "@/lib/client-access-policy";

type ClientAssignment = { id: string; assignedTeamMemberId?: string | null };

async function currentAssignments(): Promise<ClientAssignment[]> {
  if (process.env.DATABASE_URL?.trim()) {
    // The process-local DataStore cache can outlive an assignment change in
    // another Worker. Authorization reads the current committed snapshot.
    const snapshot = await getPrisma().storeSnapshot.findUnique({ where: { id: "main" }, select: { data: true } });
    const data = snapshot?.data as { clients?: ClientAssignment[] } | null;
    return data?.clients || [];
  }
  return (await (await getStore()).listClients()).map(({ id, assignedTeamMemberId }) => ({ id, assignedTeamMemberId }));
}

export async function canAccessClient(session: AuthSession, clientId: string): Promise<boolean> {
  if (session.role === "admin" || session.role === "client") {
    return hasClientAssignment(session.role, session.uid, session.clientId, clientId, null);
  }
  if (session.role !== "team") return false;
  const assignedTo = (await currentAssignments()).find((client) => client.id === clientId)?.assignedTeamMemberId;
  return hasClientAssignment(session.role, session.uid, session.clientId, clientId, assignedTo);
}

export async function requireClientAccess(session: AuthSession, clientId: string): Promise<void> {
  if (await canAccessClient(session, clientId)) return;
  throw new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export async function filterAssignedClients<T extends { id: string; assignedTeamMemberId: string | null }>(
  session: AuthSession,
  clients: T[],
): Promise<T[]> {
  if (session.role !== "team") return clients;
  const allowedIds = new Set((await currentAssignments()).filter((client) => client.assignedTeamMemberId === session.uid).map((client) => client.id));
  return clients.filter((client) => allowedIds.has(client.id));
}
