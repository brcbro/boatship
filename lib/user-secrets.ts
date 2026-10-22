import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { randomUUID } from "crypto";
import { Collection, nowIso } from "@/lib/firestore";

export const USER_SECRET_PROVIDERS = ["composio", "openrouter"] as const;
export type UserSecretProvider = (typeof USER_SECRET_PROVIDERS)[number];

// Provider credentials are workspace configuration. Keep them in the same
// encrypted table, but use a stable scope so logging out, changing browsers,
// or signing in as another team member cannot make the workspace look empty.
export const WORKSPACE_SECRET_USER_ID = "__boatship_workspace__";

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
  createdAt: Date | string;
  updatedAt: Date | string;
}): SecretMetadata {
  return {
    provider: providerOrThrow(record.provider),
    configured: true,
    last4: record.last4,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export type UserProviderSecretDoc = { id: string; userId: string; provider: string; ciphertext: string; iv: string; authTag: string; keyVersion: number; last4: string; createdAt: string; updatedAt: string };
export const USER_PROVIDER_SECRETS = new Collection<UserProviderSecretDoc>("UserProviderSecret");
const secretId = (userId: string, provider: string) => `${userId}__${provider}`;

export async function listUserSecretMetadata(userId: string): Promise<SecretMetadata[]> {
  const records = (await USER_PROVIDER_SECRETS.find([{ field: "userId", op: "in", value: [WORKSPACE_SECRET_USER_ID, userId] }]))
    .sort((a, b) => a.provider.localeCompare(b.provider));
  const byProvider = new Map<string, (typeof records)[number]>();
  // Workspace values win, while legacy per-user values remain readable until
  // the workspace credential is saved once.
  for (const record of records) {
    if (!byProvider.has(record.provider) || record.userId === WORKSPACE_SECRET_USER_ID) {
      byProvider.set(record.provider, record);
    }
  }
  return USER_SECRET_PROVIDERS.map((provider) => {
    const record = byProvider.get(provider);
    return record
      ? userSecretMetadata(record)
      : {
          provider,
          configured: false,
          last4: null,
          createdAt: null,
          updatedAt: null,
        };
  });
}

export async function getUserSecret(userId: string, providerInput: string): Promise<string | null> {
  const provider = providerOrThrow(providerInput);
  const workspaceRecord = await USER_PROVIDER_SECRETS.get(secretId(WORKSPACE_SECRET_USER_ID, provider));
  const record = workspaceRecord || await USER_PROVIDER_SECRETS.get(secretId(userId, provider));
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
  const docId = secretId(userId, provider);
  const existing = await USER_PROVIDER_SECRETS.get(docId);
  const stamp = nowIso();
  const record: UserProviderSecretDoc = {
    id: existing?.id || randomUUID(),
    userId,
    provider,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: 1,
    last4: last4(value),
    createdAt: existing?.createdAt || stamp,
    updatedAt: stamp,
  };
  await USER_PROVIDER_SECRETS.set(docId, record);
  return userSecretMetadata(record);
}

export async function deleteUserSecret(userId: string, providerInput: string) {
  const provider = providerOrThrow(providerInput);
  await USER_PROVIDER_SECRETS.delete(secretId(userId, provider));
}

export async function resolveUserSecret(userId: string | undefined, provider: UserSecretProvider) {
  if (!userId) return null;
  return getUserSecret(userId, provider);
}
