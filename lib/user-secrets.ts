import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { randomUUID } from "crypto";
import { getPrisma } from "@/lib/prisma";

export const USER_SECRET_PROVIDERS = ["composio", "openrouter"] as const;
export type UserSecretProvider = (typeof USER_SECRET_PROVIDERS)[number];

type SecretMetadata = {
  provider: UserSecretProvider;
  configured: boolean;
  last4: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

function providerOrThrow(provider: string): UserSecretProvider {
  if (!USER_SECRET_PROVIDERS.includes(provider as UserSecretProvider)) {
    throw new Error("Unsupported provider secret");
  }
  return provider as UserSecretProvider;
}

function masterKey(): Buffer {
  const raw = process.env.BOATSHIP_SECRETS_MASTER_KEY?.trim();
  if (!raw) throw new Error("BOATSHIP_SECRETS_MASTER_KEY is required for user secret operations");

  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("BOATSHIP_SECRETS_MASTER_KEY must be a 32-byte hex or base64 key");
}

function last4(value: string) {
  return value.slice(-4);
}

export function userSecretMetadata(record: {
  provider: string;
  last4: string;
  createdAt: Date;
  updatedAt: Date;
}): SecretMetadata {
  return {
    provider: providerOrThrow(record.provider),
    configured: true,
    last4: record.last4,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function listUserSecretMetadata(userId: string): Promise<SecretMetadata[]> {
  const records = await getPrisma().userProviderSecret.findMany({
    where: { userId },
    orderBy: { provider: "asc" },
  });
  const byProvider = new Map(records.map((record) => [record.provider, userSecretMetadata(record)]));
  return USER_SECRET_PROVIDERS.map((provider) => byProvider.get(provider) || {
    provider,
    configured: false,
    last4: null,
    createdAt: null,
    updatedAt: null,
  });
}

export async function getUserSecret(userId: string, providerInput: string): Promise<string | null> {
  const provider = providerOrThrow(providerInput);
  const record = await getPrisma().userProviderSecret.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!record) return null;

  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function upsertUserSecret(userId: string, providerInput: string, valueInput: string) {
  const provider = providerOrThrow(providerInput);
  const value = valueInput.trim();
  if (!value) throw new Error("Secret value is required");
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const record = await getPrisma().userProviderSecret.upsert({
    where: { userId_provider: { userId, provider } },
    create: {
      id: randomUUID(),
      userId,
      provider,
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      last4: last4(value),
    },
    update: {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      last4: last4(value),
      keyVersion: 1,
    },
  });
  return userSecretMetadata(record);
}

export async function deleteUserSecret(userId: string, providerInput: string) {
  const provider = providerOrThrow(providerInput);
  await getPrisma().userProviderSecret.deleteMany({ where: { userId, provider } });
}

export async function resolveUserSecret(userId: string | undefined, provider: UserSecretProvider) {
  if (!userId) return null;
  return getUserSecret(userId, provider);
}
