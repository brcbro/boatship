import type { Client } from "@/types";
import { Collection, isFirestoreStatus, nowIso } from "@/lib/firestore";
import { localClientDemo } from "@/lib/engagements";

/** One contact per client; the [clientId, email] pair is unique by convention. */
export type ClientContactDoc = {
  id: string; clientId: string; name: string; email: string; role: string; phone?: string | null; title?: string | null; createdAt: string; updatedAt: string;
};
export const CLIENT_CONTACTS = new Collection<ClientContactDoc>("ClientContact");

export async function findClientContactByEmail(clientId: string, email: string) {
  return CLIENT_CONTACTS.findFirst([{ field: "clientId", op: "==", value: clientId }, { field: "email", op: "==", value: email.toLowerCase() }]);
}

export async function ensurePrimaryContact(client: Client) {
  if (localClientDemo()) return;
  if (!client.primaryContactEmail) return;
  const email = client.primaryContactEmail.toLowerCase();
  if (await findClientContactByEmail(client.id, email)) return;
  const stamp = nowIso();
  try {
    await CLIENT_CONTACTS.create(`primary_${client.id}`, { id: `primary_${client.id}`, clientId: client.id, name: client.name || "Primary contact", email, role: "account_admin", createdAt: stamp, updatedAt: stamp });
  } catch (error) {
    if (!isFirestoreStatus(error, "ALREADY_EXISTS")) throw error;
  }
}
