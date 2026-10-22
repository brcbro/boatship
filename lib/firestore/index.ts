import { serviceAccountFromEnv, sharedTokenProvider } from "@/lib/google-auth";
import { RestFirestore } from "./client";
import type { FirestoreClient, FsData, Precondition, QuerySpec, Where, OrderBy, DocSnapshot } from "./types";

export * from "./types";
export { MemoryFirestore } from "./memory";
export { RestFirestore } from "./client";

let override: FirestoreClient | null = null;
let shared: { key: string; client: FirestoreClient } | null = null;

/**
 * Hosted persistence is Firestore whenever Firebase credentials (or the
 * emulator) are configured. ALLOW_LOCAL_STORE keeps the file-based demo.
 */
export function isHostedStore(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(override) || Boolean(env.FIRESTORE_EMULATOR_HOST?.trim()) || Boolean(env.FIREBASE_SERVICE_ACCOUNT?.trim());
}

export function isLocalDemoStore(env: Record<string, string | undefined> = process.env): boolean {
  return !isHostedStore(env) && env.ALLOW_LOCAL_STORE === "1";
}

export function getFirestore(env: Record<string, string | undefined> = process.env): FirestoreClient {
  if (override) return override;
  const emulator = env.FIRESTORE_EMULATOR_HOST?.trim();
  const database = env.FIRESTORE_DATABASE?.trim() || "(default)";
  if (emulator) {
    const projectId = env.FIREBASE_PROJECT_ID?.trim() || "demo-boatship";
    const key = `emulator:${emulator}:${projectId}:${database}`;
    if (shared?.key !== key) shared = { key, client: new RestFirestore({ projectId, database, host: emulator.startsWith("http") ? emulator : `http://${emulator}` }) };
    return shared.client;
  }
  const account = serviceAccountFromEnv(env);
  if (!account) throw new Error("Firestore is not configured. Set FIREBASE_SERVICE_ACCOUNT (and FIREBASE_CLIENT_EMAIL for a bare key), or ALLOW_LOCAL_STORE=1 for the local demo.");
  const key = `hosted:${account.projectId}:${account.clientEmail}:${database}`;
  if (shared?.key !== key) shared = { key, client: new RestFirestore({ projectId: account.projectId, database, tokens: sharedTokenProvider(account) }) };
  return shared.client;
}

/** Tests inject an in-memory client; null restores environment selection. */
export function setFirestoreForTests(client: FirestoreClient | null) {
  override = client;
}

export const nowIso = () => new Date().toISOString();

/**
 * Typed collection helper. Documents keep ISO-8601 strings for timestamps so
 * range filters and ordering behave like the former SQL columns.
 */
export class Collection<T extends object> {
  constructor(readonly name: string, private readonly client: () => FirestoreClient = getFirestore) {}

  async get(id: string): Promise<(T & { id: string }) | null> {
    const doc = await this.client().get<T>(this.name, id);
    return doc ? { ...doc.data, id: doc.id } : null;
  }

  async getMany(ids: string[]): Promise<Array<T & { id: string }>> {
    if (!ids.length) return [];
    const docs = await this.client().getMany<T>(this.name, [...new Set(ids)]);
    return ids.flatMap((id) => { const doc = docs.get(id); return doc ? [{ ...doc.data, id: doc.id }] : []; });
  }

  async find(where: Where[], options: { orderBy?: OrderBy[]; limit?: number } = {}): Promise<Array<T & { id: string }>> {
    const docs = await this.client().query<T>({ collection: this.name, where, ...options });
    return docs.map((doc) => ({ ...doc.data, id: doc.id }));
  }

  async findFirst(where: Where[], orderBy?: OrderBy[]): Promise<(T & { id: string }) | null> {
    return (await this.find(where, { orderBy, limit: 1 }))[0] || null;
  }

  async count(where: Where[] = []): Promise<number> {
    return this.client().count({ collection: this.name, where });
  }

  async set(id: string, data: T, precondition?: Precondition): Promise<void> {
    await this.client().commit([{ set: { collection: this.name, id, data: stripId(data) as unknown as FsData, precondition } }]);
  }

  async create(id: string, data: T): Promise<void> {
    await this.set(id, data, { exists: false });
  }

  async update(id: string, data: Partial<T>, precondition?: Precondition): Promise<void> {
    await this.client().commit([{ update: { collection: this.name, id, data: stripId(data as FsData), precondition } }]);
  }

  async delete(id: string, precondition?: Precondition): Promise<void> {
    await this.client().commit([{ delete: { collection: this.name, id, precondition } }]);
  }

  /** Snapshot form, for callers that need updateTime preconditions. */
  async snapshot(id: string): Promise<DocSnapshot<T> | null> {
    return this.client().get<T>(this.name, id);
  }

  spec(where: Where[] = [], options: { orderBy?: OrderBy[]; limit?: number } = {}): QuerySpec {
    return { collection: this.name, where, ...options };
  }
}

function stripId<T extends object>(data: T): T {
  if (!("id" in data)) return data;
  const copy = { ...data } as FsData;
  // The document id is the key; keeping a duplicate field is harmless but we
  // keep it so queries can filter on `id` like the old SQL columns did.
  return copy as T;
}
