import type { Client } from "@/types";
import { getPrisma } from "@/lib/prisma";
import { localClientDemo } from "@/lib/engagements";

export async function ensurePrimaryContact(client: Client) {
  if (localClientDemo()) return;
  if (!client.primaryContactEmail) return;
  const prisma = getPrisma();
  await prisma.$executeRaw`
    INSERT INTO "ClientContact" ("id", "clientId", "name", "email", "role", "createdAt", "updatedAt")
    VALUES (${'primary_' + client.id}, ${client.id}, ${client.name || 'Primary contact'}, ${client.primaryContactEmail.toLowerCase()}, 'account_admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT DO NOTHING
  `;
}
