import { compareValues, valuesEqual } from "./codec";
import {
  assertDocumentId, FirestoreError, notifyCommittedWrites,
  type DocSnapshot, type FirestoreClient, type FirestoreTransaction, type FsData, type QuerySpec, type Where, type Write,
} from "./types";

type Stored = { data: FsData; updateTime: string };

function clone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof Uint8Array) return Uint8Array.from(value) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (item !== undefined) out[key] = clone(item);
  return out as T;
}

function readPath(data: FsData, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current) || current instanceof Date || current instanceof Uint8Array) return undefined;
    current = (current as FsData)[segment];
  }
  return current;
}

function matches(data: FsData, where: Where): boolean {
  const actual = readPath(data, where.field);
  if (where.op === "is-null") return actual === null;
  if (where.op === "is-not-null") return actual !== undefined && actual !== null;
  if (actual === undefined || !("value" in where)) return false;
  const { op, value } = where;
  switch (op) {
    case "==": return valuesEqual(actual, value);
    case "!=": return actual !== null && !valuesEqual(actual, value);
    case "<": case "<=": case ">": case ">=": {
      if (actual === null || value === null) return false;
      const sameType = typeof actual === typeof value && Array.isArray(actual) === Array.isArray(value) && (actual instanceof Date) === (value instanceof Date);
      if (!sameType) return false;
      const result = compareValues(actual, value);
      return op === "<" ? result < 0 : op === "<=" ? result <= 0 : op === ">" ? result > 0 : result >= 0;
    }
    case "in": return (value as unknown[]).some((item) => valuesEqual(actual, item));
    case "not-in": return actual !== null && !(value as unknown[]).some((item) => valuesEqual(actual, item));
    case "array-contains": return Array.isArray(actual) && actual.some((item) => valuesEqual(item, value));
    case "array-contains-any": return Array.isArray(actual) && (value as unknown[]).some((needle) => actual.some((item) => valuesEqual(item, needle)));
    default: return false;
  }
}

export function evaluateQuery<T>(docs: Iterable<[string, Stored]>, spec: QuerySpec): DocSnapshot<T>[] {
  const orderBy = spec.orderBy || [];
  const rows: DocSnapshot<T>[] = [];
  for (const [id, stored] of docs) {
    if ((spec.where || []).every((where) => matches(stored.data, where)) && orderBy.every((order) => readPath(stored.data, order.field) !== undefined)) {
      rows.push({ id, data: clone(stored.data) as T, updateTime: stored.updateTime });
    }
  }
  rows.sort((a, b) => {
    for (const order of orderBy) {
      const result = compareValues(readPath(a.data as FsData, order.field), readPath(b.data as FsData, order.field));
      if (result) return order.direction === "desc" ? -result : result;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return spec.limit !== undefined ? rows.slice(0, spec.limit) : rows;
}

/**
 * In-memory Firestore with the same semantics the application relies on:
 * preconditions, optimistic transactions that abort when a read document
 * changed, query filters that skip documents missing the field, and typed
 * ordering. Tests and the local e2e harness use it; production never does.
 */
export class MemoryFirestore implements FirestoreClient {
  private readonly collections = new Map<string, Map<string, Stored>>();
  private clock = 0;

  private col(name: string) {
    let collection = this.collections.get(name);
    if (!collection) { collection = new Map(); this.collections.set(name, collection); }
    return collection;
  }

  private stamp() {
    this.clock += 1;
    return new Date(Date.now()).toISOString().replace("Z", `${String(this.clock % 1000).padStart(3, "0")}Z`);
  }

  async get<T = FsData>(collection: string, id: string): Promise<DocSnapshot<T> | null> {
    const stored = this.col(collection).get(assertDocumentId(id));
    return stored ? { id, data: clone(stored.data) as T, updateTime: stored.updateTime } : null;
  }

  async getMany<T = FsData>(collection: string, ids: string[]): Promise<Map<string, DocSnapshot<T>>> {
    const result = new Map<string, DocSnapshot<T>>();
    for (const id of ids) { const doc = await this.get<T>(collection, id); if (doc) result.set(id, doc); }
    return result;
  }

  async query<T = FsData>(spec: QuerySpec): Promise<DocSnapshot<T>[]> {
    return evaluateQuery<T>(this.col(spec.collection), spec);
  }

  async count(spec: QuerySpec): Promise<number> {
    return (await this.query(spec)).length;
  }

  private applyWrites(writes: Write[]) {
    // Validate every precondition before mutating so a commit is atomic.
    for (const write of writes) {
      const target = "set" in write ? write.set : "update" in write ? write.update : write.delete;
      assertDocumentId(target.id);
      const existing = this.col(target.collection).get(target.id);
      const precondition = target.precondition;
      if (precondition) {
        if ("exists" in precondition && precondition.exists !== Boolean(existing)) throw new FirestoreError(precondition.exists ? `No document to update: ${target.collection}/${target.id}` : `Document already exists: ${target.collection}/${target.id}`, precondition.exists ? "NOT_FOUND" : "ALREADY_EXISTS", precondition.exists ? 404 : 409);
        if ("updateTime" in precondition && existing?.updateTime !== precondition.updateTime) throw new FirestoreError(`Stale update time for ${target.collection}/${target.id}`, "FAILED_PRECONDITION", 400);
      }
      if ("update" in write && !existing) throw new FirestoreError(`No document to update: ${target.collection}/${target.id}`, "NOT_FOUND", 404);
    }
    for (const write of writes) {
      const time = this.stamp();
      if ("set" in write) this.col(write.set.collection).set(write.set.id, { data: clone(write.set.data), updateTime: time });
      else if ("update" in write) {
        const existing = this.col(write.update.collection).get(write.update.id)!;
        this.col(write.update.collection).set(write.update.id, { data: { ...existing.data, ...clone(write.update.data) }, updateTime: time });
      } else this.col(write.delete.collection).delete(write.delete.id);
    }
  }

  async commit(writes: Write[]): Promise<void> {
    this.applyWrites(writes);
    await notifyCommittedWrites(writes);
  }

  async runTransaction<R>(body: (tx: FirestoreTransaction) => Promise<R>, options: { attempts?: number } = {}): Promise<R> {
    const attempts = Math.max(1, options.attempts ?? 5);
    for (let attempt = 1; ; attempt += 1) {
      const reads = new Map<string, string | null>();
      const queried = new Map<string, string>();
      const writes: Write[] = [];
      const record = (collection: string, id: string, updateTime: string | null) => reads.set(`${collection}/${id}`, updateTime);
      const tx: FirestoreTransaction = {
        get: async <T,>(collection: string, id: string) => { const doc = await this.get<T>(collection, id); record(collection, id, doc?.updateTime ?? null); return doc; },
        getMany: async <T,>(collection: string, ids: string[]) => { const docs = await this.getMany<T>(collection, ids); for (const id of ids) record(collection, id, docs.get(id)?.updateTime ?? null); return docs; },
        query: async <T,>(spec: QuerySpec) => { const docs = await this.query<T>(spec); queried.set(JSON.stringify(spec), JSON.stringify(docs.map((doc) => [doc.id, doc.updateTime]))); return docs; },
        count: (spec) => this.count(spec),
        write: (write) => { writes.push(write); },
      };
      const result = await body(tx);
      let aborted = false;
      for (const [path, updateTime] of reads) {
        const [collection, id] = path.split("/");
        if ((this.col(collection).get(id)?.updateTime ?? null) !== updateTime) aborted = true;
      }
      // Validation and apply run synchronously so no other transaction can
      // commit between the check and the write (the serialization point).
      for (const [spec, before] of queried) {
        const parsed = JSON.parse(spec) as QuerySpec;
        const now = evaluateQuery(this.col(parsed.collection), parsed);
        if (JSON.stringify(now.map((doc) => [doc.id, doc.updateTime])) !== before) aborted = true;
      }
      if (aborted) {
        if (attempt >= attempts) throw new FirestoreError("Transaction contention: too many retries", "ABORTED", 409);
        continue;
      }
      this.applyWrites(writes);
      await notifyCommittedWrites(writes);
      return result;
    }
  }

  /** Test helper: a deep copy of everything stored. */
  dump(): Record<string, Record<string, FsData>> {
    const out: Record<string, Record<string, FsData>> = {};
    for (const [name, collection] of this.collections) {
      out[name] = {};
      for (const [id, stored] of collection) out[name][id] = clone(stored.data);
    }
    return out;
  }
}
