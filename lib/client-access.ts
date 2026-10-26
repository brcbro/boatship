import type { AuthSession } from "@/types";
import { getStore, readSnapshotSlice } from "@/lib/store";
import { isHostedStore } from "@/lib/firestore";
import { hasClientAssignment } from "@/lib/client-access-policy";

type ClientAssignment = { id: string; assignedTeamMemberId?: string | null };

async function currentAssignments(): Promise<ClientAssignment[]> {
  if (isHostedStore()) {
    // The request-scoped DataStore cache can outlive an assignment change in
    // another Worker. Authorization reads the current committed clients slice.
    return (await readSnapshotSlice("clients")).map(({ id, assignedTeamMemberId }) => ({ id, assignedTeamMemberId }));
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

/**
 * The clients a session may see: every client for an admin, the assigned
 * clients for a team member, only its own client for a client session, and
 * none for any other role.
 */
export async function filterAssignedClients<T extends { id: string; assignedTeamMemberId: string | null }>(
  session: AuthSession,
  clients: T[],
): Promise<T[]> {
  if (session.role === "admin") return clients;
  if (session.role === "client") return session.clientId ? clients.filter((client) => client.id === session.clientId) : [];
  if (session.role !== "team") return [];
  const allowedIds = new Set((await currentAssignments()).filter((client) => client.assignedTeamMemberId === session.uid).map((client) => client.id));
  return clients.filter((client) => allowedIds.has(client.id));
}
