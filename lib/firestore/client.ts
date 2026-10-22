import { compareValues, decodeFields, encodeFields, fieldPath, type RestValue } from "./codec";
import { encodeValue } from "./codec";
import {
  assertDocumentId, FirestoreError,
  type DocSnapshot, type FirestoreClient, type FirestoreTransaction, type FsData, type Precondition, type QuerySpec, type Where, type Write,
} from "./types";
import type { TokenProvider } from "@/lib/google-auth";

export const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const IN_CHUNK = 30;

export type RestClientOptions = {
  projectId: string;
  database?: string;
  /** Emulator origin such as http://127.0.0.1:8080; production when omitted. */
  host?: string;
  tokens?: TokenProvider;
  fetch?: typeof fetch;
};

type RestDocument = { name: string; fields?: Record<string, RestValue>; updateTime?: string };
type RestWrite = {
  update?: { name: string; fields: Record<string, RestValue> };
  updateMask?: { fieldPaths: string[] };
  delete?: string;
  currentDocument?: { exists?: boolean; updateTime?: string };
};

const OP: Record<Exclude<Where["op"], "is-null" | "is-not-null">, string> = {
  "==": "EQUAL", "!=": "NOT_EQUAL", "<": "LESS_THAN", "<=": "LESS_THAN_OR_EQUAL", ">": "GREATER_THAN", ">=": "GREATER_THAN_OR_EQUAL",
  in: "IN", "not-in": "NOT_IN", "array-contains": "ARRAY_CONTAINS", "array-contains-any": "ARRAY_CONTAINS_ANY",
};

function readPath(data: FsData, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current) || current instanceof Date || current instanceof Uint8Array) return undefined;
    current = (current as FsData)[segment];
  }
  return current;
}

/**
 * Firestore over its REST API. Every call is one HTTPS request with a bearer
 * token, which keeps the Worker free of SDK/gRPC requirements.
 */
export class RestFirestore implements FirestoreClient {
  private readonly root: string;
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: RestClientOptions) {
    const database = options.database || "(default)";
    this.root = `projects/${options.projectId}/databases/${database}/documents`;
    this.base = `${(options.host || "https://firestore.googleapis.com").replace(/\/$/, "")}/v1/${this.root}`;
    this.doFetch = options.fetch || fetch;
    if (!options.host && !options.tokens) throw new Error("A token provider is required outside the emulator.");
  }

  private name(collection: string, id: string) {
    return `${this.root}/${collection}/${assertDocumentId(id)}`;
  }

  private async headers(): Promise<Record<string, string>> {
    const token = this.options.host && !this.options.tokens ? "owner" : await this.options.tokens!([FIRESTORE_SCOPE]);
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    const response = await this.doFetch(url.toString(), { method, headers: await this.headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) {
      let status = "UNKNOWN", message = text.slice(0, 300);
      try { const parsed = JSON.parse(text) as { error?: { status?: string; message?: string } }; status = parsed.error?.status || status; message = parsed.error?.message || message; } catch { /* keep raw text */ }
      throw new FirestoreError(`Firestore ${method} ${path} failed: ${status}: ${message}`, status, response.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private snapshot<T>(document: RestDocument): DocSnapshot<T> {
    return { id: document.name.slice(document.name.lastIndexOf("/") + 1), data: decodeFields(document.fields || {}) as T, updateTime: document.updateTime || null };
  }

  async get<T = FsData>(collection: string, id: string, transaction?: string): Promise<DocSnapshot<T> | null> {
    const docs = await this.getMany<T>(collection, [id], transaction);
    return docs.get(id) || null;
  }

  async getMany<T = FsData>(collection: string, ids: string[], transaction?: string): Promise<Map<string, DocSnapshot<T>>> {
    const result = new Map<string, DocSnapshot<T>>();
    for (let index = 0; index < ids.length; index += 100) {
      const chunk = ids.slice(index, index + 100).map((id) => this.name(collection, id));
      const rows = await this.request<Array<{ found?: RestDocument; missing?: string }>>("POST", ":batchGet", { documents: chunk, ...(transaction ? { transaction } : {}) });
      for (const row of rows) if (row.found) { const doc = this.snapshot<T>(row.found); result.set(doc.id, doc); }
    }
    return result;
  }

  private structuredQuery(spec: QuerySpec, where: Where[]) {
    const filters = where.map((item) => !("value" in item)
      ? { unaryFilter: { op: item.op === "is-null" ? "IS_NULL" : "IS_NOT_NULL", field: { fieldPath: fieldPath(item.field) } } }
      : { fieldFilter: { field: { fieldPath: fieldPath(item.field) }, op: OP[item.op], value: encodeValue(item.value) } });
    return {
      from: [{ collectionId: spec.collection }],
      ...(filters.length === 1 ? { where: filters[0] } : filters.length > 1 ? { where: { compositeFilter: { op: "AND", filters } } } : {}),
      ...(spec.orderBy?.length ? { orderBy: spec.orderBy.map((order) => ({ field: { fieldPath: fieldPath(order.field) }, direction: order.direction === "desc" ? "DESCENDING" : "ASCENDING" })) } : {}),
      ...(spec.limit !== undefined ? { limit: spec.limit } : {}),
    };
  }

  async query<T = FsData>(spec: QuerySpec, transaction?: string): Promise<DocSnapshot<T>[]> {
    const where = spec.where || [];
    const wide = where.findIndex((item) => "value" in item && (item.op === "in" || item.op === "array-contains-any") && Array.isArray(item.value) && item.value.length > IN_CHUNK);
    if (wide >= 0) {
      // Firestore caps IN lists; run chunks and merge with the same ordering.
      const target = where[wide] as { field: string; op: "in" | "array-contains-any"; value: unknown[] };
      const seen = new Map<string, DocSnapshot<T>>();
      for (let index = 0; index < target.value.length; index += IN_CHUNK) {
        const chunk = { ...spec, where: where.map((item, position) => (position === wide ? { ...target, value: target.value.slice(index, index + IN_CHUNK) } : item)) };
        for (const doc of await this.query<T>(chunk, transaction)) seen.set(doc.id, doc);
      }
      const rows = [...seen.values()].sort((a, b) => {
        for (const order of spec.orderBy || []) {
          const result = compareValues(readPath(a.data as FsData, order.field), readPath(b.data as FsData, order.field));
          if (result) return order.direction === "desc" ? -result : result;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      return spec.limit !== undefined ? rows.slice(0, spec.limit) : rows;
    }
    const rows = await this.request<Array<{ document?: RestDocument }>>("POST", ":runQuery", { structuredQuery: this.structuredQuery(spec, where), ...(transaction ? { transaction } : {}) });
    return rows.filter((row) => row.document).map((row) => this.snapshot<T>(row.document!));
  }

  async count(spec: QuerySpec): Promise<number> {
    const where = spec.where || [];
    if (where.some((item) => "value" in item && (item.op === "in" || item.op === "array-contains-any") && Array.isArray(item.value) && item.value.length > IN_CHUNK)) return (await this.query(spec)).length;
    const rows = await this.request<Array<{ result?: { aggregateFields?: { total?: RestValue } } }>>("POST", ":runAggregationQuery", {
      structuredAggregationQuery: { structuredQuery: this.structuredQuery({ ...spec, limit: undefined, orderBy: undefined }, where), aggregations: [{ alias: "total", count: {} }] },
    });
    const value = rows[0]?.result?.aggregateFields?.total;
    return value && "integerValue" in value ? Number(value.integerValue) : 0;
  }

  private restWrite(write: Write): RestWrite {
    const precondition = (value?: Precondition) => (value ? { currentDocument: "exists" in value ? { exists: value.exists } : { updateTime: value.updateTime } } : {});
    if ("set" in write) return { update: { name: this.name(write.set.collection, write.set.id), fields: encodeFields(write.set.data) }, ...precondition(write.set.precondition) };
    if ("update" in write) {
      const fields = encodeFields(write.update.data);
      // An update must target an existing document; Firestore would otherwise create it.
      const guard = write.update.precondition ?? { exists: true };
      return { update: { name: this.name(write.update.collection, write.update.id), fields }, updateMask: { fieldPaths: Object.keys(write.update.data).map(fieldPath) }, ...precondition(guard) };
    }
    return { delete: this.name(write.delete.collection, write.delete.id), ...precondition(write.delete.precondition) };
  }

  async commit(writes: Write[], transaction?: string): Promise<void> {
    if (!writes.length && !transaction) return;
    await this.request("POST", ":commit", { writes: writes.map((write) => this.restWrite(write)), ...(transaction ? { transaction } : {}) });
  }

  async runTransaction<R>(body: (tx: FirestoreTransaction) => Promise<R>, options: { attempts?: number } = {}): Promise<R> {
    const attempts = Math.max(1, options.attempts ?? 5);
    let previous: string | undefined;
    for (let attempt = 1; ; attempt += 1) {
      const begun = await this.request<{ transaction: string }>("POST", ":beginTransaction", { options: { readWrite: previous ? { retryTransaction: previous } : {} } });
      const id = begun.transaction;
      const writes: Write[] = [];
      const tx: FirestoreTransaction = {
        get: (collection, docId) => this.get(collection, docId, id),
        getMany: (collection, ids) => this.getMany(collection, ids, id),
        query: (spec) => this.query(spec, id),
        count: (spec) => this.count(spec),
        write: (write) => { writes.push(write); },
      };
      let result: R;
      try {
        result = await body(tx);
      } catch (error) {
        await this.request("POST", ":rollback", { transaction: id }).catch(() => undefined);
        throw error;
      }
      try {
        await this.commit(writes, id);
        return result;
      } catch (error) {
        const retryable = error instanceof FirestoreError && (error.status === "ABORTED" || (error.status === "FAILED_PRECONDITION" && /transaction|contention|modified/i.test(error.message)));
        if (!retryable || attempt >= attempts) throw error;
        previous = id;
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 50 * 2 ** attempt) + Math.random() * 50));
      }
    }
  }
}
