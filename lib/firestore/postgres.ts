import { Buffer } from "node:buffer";
import postgres, { type JSONValue, type Sql, type TransactionSql } from "postgres";
import {
  assertDocumentId, FirestoreError, notifyCommittedWrites,
  type DocSnapshot, type FirestoreClient, type FirestoreTransaction, type FsData, type OrderBy, type Precondition, type QuerySpec, type Where, type Write,
} from "./types";
import { ownedBytes } from "./bytes";

export type PostgresStoreOptions = {
  /**
   * postgresql:// connection string. A direct connection always uses TLS
   * (see `postgresTls`); a Cloudflare Hyperdrive connection string (host
   * *.hyperdrive.local) is plain because Hyperdrive terminates TLS to the
   * origin itself, and a loopback test server may set `sslmode=disable`.
   */
  url: string;
  /** Table holding every collection; defaults to `documents`. */
  table?: string;
  /** Pool size; the Worker keeps this small because each isolate has its own pool. */
  max?: number;
  /**
   * PEM certificate(s) of the CA that signs the server certificate
   * (`DATABASE_CA_CERT`). When set, a direct connection verifies the chain and
   * hostname; without it the connection is encrypted but unverified.
   */
  ca?: string;
};

type Row = { id: string; doc: unknown; update_time: string };
type BlobRow = { bytes: Buffer };
type BlobRangeRow = { size: number; head: Buffer; part: Buffer };
type Db = Sql | TransactionSql;
type Fragment = ReturnType<Sql["unsafe"]>;

const TABLE_PATTERN = /^[a-z_][a-z0-9_]{0,56}$/;
const BLOB_KEY_PATTERN = /^[A-Za-z0-9._:/-]{1,512}$/;
const RETRYABLE = new Set(["40001", "40P01"]);
/** Microsecond ISO-8601 so every write gets a distinct, comparable update time. */
const STAMP = `to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Top-level fields with a `(collection, (doc ->> field) COLLATE "C")` btree
 * index. Their string equality, IN and range predicates are written against
 * that exact expression (with the field name inlined) so the planner can use
 * the index; every other field keeps the generic `doc #> path` form.
 */
export const INDEXED_FIELDS: Readonly<Record<string, string>> = { createdAt: "ix_ca", status: "ix_st", expiresAt: "ix_ex" };

/** The exact indexed expression; identical text in the DDL and the predicates is what lets the planner match them. */
export function indexedExpression(field: string): string {
  if (!(field in INDEXED_FIELDS) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw new Error(`Field ${field} has no expression index`);
  return `((doc ->> '${field}') COLLATE "C")`;
}

/** Two instances creating the same index at once: the loser sees a duplicate and can carry on. */
function ignoreConcurrentCreate(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code !== "23505" && code !== "42P07") throw error;
}

export function isHyperdriveUrl(url: string): boolean {
  try { return /\.hyperdrive\.local$/i.test(new URL(url).hostname); } catch { return false; }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export function isLoopbackDatabaseUrl(url: string): boolean {
  try { return LOOPBACK_HOSTS.has(new URL(url).hostname.toLowerCase()); } catch { return false; }
}

/**
 * TLS for the driver. Hyperdrive is plain inside Cloudflare's network (it
 * terminates TLS to the origin itself, so its behaviour is unchanged). A
 * loopback server may opt out with `sslmode=disable` (CI's service container
 * and local test servers have no certificate). A direct remote connection is
 * always encrypted; with a pinned CA it is also verified.
 */
export function postgresTls(url: string, ca?: string): false | "require" | { ca: string; rejectUnauthorized: true } {
  if (isHyperdriveUrl(url)) return false;
  if (isLoopbackDatabaseUrl(url)) {
    try { if (new URL(url).searchParams.get("sslmode") === "disable") return false; } catch { /* fall through to TLS */ }
  }
  // Secret stores often flatten newlines; accept `\n` escapes in the PEM.
  const pem = ca?.trim().replace(/\\n/g, "\n");
  if (pem) return { ca: pem, rejectUnauthorized: true };
  return "require";
}

// Buffer views avoid the per-character string building of btoa/atob on large values.
const bytesToBase64 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
const base64ToBytes = (text: string) => ownedBytes(Buffer.from(text, "base64"));

/**
 * JSON shape stored in the `doc` column. Dates and bytes, which JSON lacks,
 * become single-key tagged objects; `undefined` fields are dropped.
 */
export function toJson(value: unknown): JSONValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FirestoreError("Non-finite numbers cannot be stored.", "INVALID_ARGUMENT", 400);
    return value;
  }
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof Uint8Array) return { $bytes: bytesToBase64(value) };
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    const out: Record<string, JSONValue> = {};
    for (const [key, item] of Object.entries(value as FsData)) if (item !== undefined) out[key] = toJson(item);
    return out;
  }
  throw new FirestoreError(`Unsupported value type: ${typeof value}`, "INVALID_ARGUMENT", 400);
}

export function fromJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(fromJson);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 1 && entries[0][0] === "$date" && typeof entries[0][1] === "string") return new Date(entries[0][1]);
  if (entries.length === 1 && entries[0][0] === "$bytes" && typeof entries[0][1] === "string") return base64ToBytes(entries[0][1]);
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) out[key] = fromJson(item);
  return out;
}


function translate(error: unknown): never {
  if (error instanceof FirestoreError) throw error;
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  // Application errors thrown inside a transaction body are not database failures.
  if (!code) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (RETRYABLE.has(code)) throw new FirestoreError(`Transaction contention: ${message}`, "ABORTED", 409);
  if (code === "23505") throw new FirestoreError(`Document already exists: ${message}`, "ALREADY_EXISTS", 409);
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "CONNECT_TIMEOUT" || code === "57P01") throw new FirestoreError(`Database unavailable: ${message}`, "UNAVAILABLE", 503);
  throw new FirestoreError(`Database error${code ? ` ${code}` : ""}: ${message}`, "INTERNAL", 500);
}

/**
 * The storage interface on PostgreSQL. Every collection lives in one table as
 * `(collection, id, doc jsonb, update_time)`, so the application's document
 * model, preconditions, and query operators keep the semantics the Firestore
 * client and the in-memory store share (`tests/firestore.test.mjs`).
 */
export class PostgresFirestore implements FirestoreClient {
  readonly sql: Sql;
  private readonly table: string;
  private ready: Promise<void> | null = null;

  constructor(options: PostgresStoreOptions) {
    this.table = options.table || "documents";
    if (!TABLE_PATTERN.test(this.table)) throw new Error(`Invalid table name: ${this.table}`);
    this.sql = postgres(options.url, {
      // The service's certificate is signed by a private CA: a direct connection verifies it only when that CA is pinned.
      ssl: postgresTls(options.url, options.ca),
      max: options.max ?? 4, connect_timeout: 15, idle_timeout: 60, max_lifetime: 60 * 30, onnotice: () => undefined,
    });
  }

  private get blobTable() {
    return `${this.table}_blobs`;
  }

  /** Creates the tables on first use; idempotent and safe to run concurrently. */
  private ensure(): Promise<void> {
    if (!this.ready) {
      const table = this.sql(this.table);
      this.ready = (async () => {
        await this.sql`CREATE TABLE IF NOT EXISTS ${table} (collection text NOT NULL, id text NOT NULL, doc jsonb NOT NULL, update_time text NOT NULL, PRIMARY KEY (collection, id))`;
        await this.sql`CREATE INDEX IF NOT EXISTS ${this.sql(`${this.table}_doc_idx`)} ON ${table} USING gin (doc jsonb_path_ops)`;
        // Expression indexes for the hot top-level fields; see INDEXED_FIELDS and predicate().
        // Plain (not CONCURRENTLY) so a failed build never leaves an invalid index that IF NOT EXISTS would then skip.
        for (const [field, suffix] of Object.entries(INDEXED_FIELDS)) {
          await this.sql`CREATE INDEX IF NOT EXISTS ${this.sql(`${this.table}_${suffix}`)} ON ${table} (collection, ${this.sql.unsafe(indexedExpression(field))})`.catch(ignoreConcurrentCreate);
        }
        // File bytes live beside the documents in a bytea table so a document read never parses a blob.
        await this.sql`CREATE TABLE IF NOT EXISTS ${this.sql(this.blobTable)} (key text PRIMARY KEY, bytes bytea NOT NULL, content_type text NOT NULL, size integer NOT NULL, created_at text NOT NULL)`;
      })().catch((error) => { this.ready = null; translate(error); });
    }
    return this.ready;
  }

  /** Drops the tables; used by tests that run against a scratch table. */
  async drop(): Promise<void> {
    await this.sql`DROP TABLE IF EXISTS ${this.sql(this.table)}`;
    await this.sql`DROP TABLE IF EXISTS ${this.sql(this.blobTable)}`;
    this.ready = null;
  }

  /** Stores file bytes under a key; a repeated key replaces the bytes. */
  async putBlob(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (!BLOB_KEY_PATTERN.test(key)) throw new FirestoreError("Invalid blob key.", "INVALID_ARGUMENT", 400);
    await this.ensure();
    try {
      await this.sql`INSERT INTO ${this.sql(this.blobTable)} (key, bytes, content_type, size, created_at) VALUES (${key}, ${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)}, ${contentType}, ${bytes.byteLength}, ${new Date().toISOString()}) ON CONFLICT (key) DO UPDATE SET bytes = EXCLUDED.bytes, content_type = EXCLUDED.content_type, size = EXCLUDED.size, created_at = EXCLUDED.created_at`;
    } catch (error) { translate(error); }
  }

  async getBlob(key: string): Promise<Uint8Array | null> {
    if (!BLOB_KEY_PATTERN.test(key)) return null;
    await this.ensure();
    try {
      const rows = await this.sql<BlobRow[]>`SELECT bytes FROM ${this.sql(this.blobTable)} WHERE key = ${key}`;
      // The driver decodes bytea into a fresh Buffer; hand out a view of it instead of a second copy.
      return rows.length ? ownedBytes(rows[0].bytes) : null;
    } catch (error) { translate(error); }
  }

  /**
   * Bytes `start..end` (inclusive) of a blob plus its total size and first
   * 16 bytes (for type sniffing), without sending the whole blob to the
   * client. The range is clamped to the blob; null when the key is unknown.
   */
  async getBlobRange(key: string, start: number, end: number): Promise<{ bytes: Uint8Array; size: number; head: Uint8Array } | null> {
    if (!BLOB_KEY_PATTERN.test(key)) return null;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) throw new FirestoreError("Invalid blob range.", "INVALID_ARGUMENT", 400);
    await this.ensure();
    try {
      const rows = await this.sql<BlobRangeRow[]>`SELECT octet_length(bytes) AS size, substring(bytes FROM 1 FOR 16) AS head, substring(bytes FROM ${start + 1}::integer FOR ${end - start + 1}::integer) AS part FROM ${this.sql(this.blobTable)} WHERE key = ${key}`;
      if (!rows.length) return null;
      return { bytes: ownedBytes(rows[0].part), size: Number(rows[0].size), head: ownedBytes(rows[0].head) };
    } catch (error) { translate(error); }
  }

  async deleteBlobs(keys: string[]): Promise<void> {
    const valid = keys.filter((key) => BLOB_KEY_PATTERN.test(key));
    if (!valid.length) return;
    await this.ensure();
    try { await this.sql`DELETE FROM ${this.sql(this.blobTable)} WHERE key = ANY(${valid}::text[])`; } catch (error) { translate(error); }
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  private snapshot<T>(row: Row): DocSnapshot<T> {
    return { id: row.id, data: fromJson(row.doc) as T, updateTime: row.update_time };
  }

  private async read<T>(db: Db, collection: string, ids: string[]): Promise<Map<string, DocSnapshot<T>>> {
    const result = new Map<string, DocSnapshot<T>>();
    if (!ids.length) return result;
    for (const id of ids) assertDocumentId(id);
    const rows = await db<Row[]>`SELECT id, doc, update_time FROM ${db(this.table)} WHERE collection = ${collection} AND id = ANY(${ids}::text[])`;
    for (const row of rows) result.set(row.id, this.snapshot<T>(row));
    return result;
  }

  async get<T = FsData>(collection: string, id: string): Promise<DocSnapshot<T> | null> {
    await this.ensure();
    try { return (await this.read<T>(this.sql, collection, [id])).get(id) || null; } catch (error) { translate(error); }
  }

  async getMany<T = FsData>(collection: string, ids: string[]): Promise<Map<string, DocSnapshot<T>>> {
    await this.ensure();
    try { return await this.read<T>(this.sql, collection, ids); } catch (error) { translate(error); }
  }

  /** `doc #> '{a,b}'`: SQL NULL when the path is missing, jsonb null when stored as null. */
  private path(db: Db, field: string): Fragment {
    return db`(doc #> ${field.split(".")}::text[])`;
  }

  private predicate(db: Db, where: Where): Fragment {
    const x = this.path(db, where.field);
    if (where.op === "is-null") return db`${x} = 'null'::jsonb`;
    if (where.op === "is-not-null") return db`${x} IS NOT NULL AND ${x} <> 'null'::jsonb`;
    if (!("value" in where)) throw new FirestoreError(`Unsupported operator: ${String(where.op)}`, "INVALID_ARGUMENT", 400);
    const { op, value } = where;
    // `(doc ->> 'field') COLLATE "C"` for an indexed top-level field. Text
    // alone cannot tell the string "5" from the number 5, so it is always
    // combined with the type-exact predicate; it only narrows via the index.
    const indexed = where.field in INDEXED_FIELDS ? db.unsafe(indexedExpression(where.field)) : null;
    switch (op) {
      case "==": {
        if (indexed && typeof value === "string") return db`${indexed} = ${value} AND doc @> ${db.json({ [where.field]: value })}`;
        // Top-level scalar equality goes through containment so the GIN index applies.
        if (!where.field.includes(".") && value !== null && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) return db`doc @> ${db.json({ [where.field]: value })}`;
        return db`${x} = ${db.json(toJson(value))}`;
      }
      case "!=": return db`${x} IS NOT NULL AND ${x} <> 'null'::jsonb AND ${x} <> ${db.json(toJson(value))}`;
      case "<": case "<=": case ">": case ">=": {
        // Firestore only matches values of the same type; strings compare by code point.
        const compare = (left: Fragment, right: Fragment) => (op === "<" ? db`${left} < ${right}` : op === "<=" ? db`${left} <= ${right}` : op === ">" ? db`${left} > ${right}` : db`${left} >= ${right}`);
        if (typeof value === "string") return db`jsonb_typeof(${x}) = 'string' AND ${compare(indexed || db`(${x} #>> '{}') COLLATE "C"`, db`${value}`)}`;
        if (typeof value === "number") return db`jsonb_typeof(${x}) = 'number' AND ${compare(db`(${x} #>> '{}')::numeric`, db`${value}::numeric`)}`;
        if (value instanceof Date) return db`${x} ? '$date' AND ${compare(db`(${x} ->> '$date') COLLATE "C"`, db`${value.toISOString()}`)}`;
        if (value === null || value === undefined) return db`FALSE`;
        return db`jsonb_typeof(${x}) = ${Array.isArray(value) ? "array" : typeof value === "boolean" ? "boolean" : "object"} AND ${compare(x, db`${db.json(toJson(value))}`)}`;
      }
      case "in": {
        const exact = db`${x} IN (SELECT jsonb_array_elements(${db.json(toJson(value))}))`;
        if (indexed && Array.isArray(value) && value.length && value.every((item) => typeof item === "string")) return db`${indexed} = ANY(${value as string[]}::text[]) AND ${exact}`;
        return exact;
      }
      case "not-in": return db`${x} IS NOT NULL AND ${x} <> 'null'::jsonb AND NOT (${x} IN (SELECT jsonb_array_elements(${db.json(toJson(value))})))`;
      case "array-contains": return db`jsonb_typeof(${x}) = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(${x}) AS element WHERE element = ${db.json(toJson(value))})`;
      case "array-contains-any": return db`jsonb_typeof(${x}) = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(${x}) AS element WHERE element IN (SELECT jsonb_array_elements(${db.json(toJson(value))})))`;
      default: throw new FirestoreError(`Unsupported operator: ${String(op)}`, "INVALID_ARGUMENT", 400);
    }
  }

  private filters(db: Db, spec: QuerySpec): Fragment {
    const parts = [db`collection = ${spec.collection}`, ...(spec.where || []).map((where) => this.predicate(db, where))];
    // Like Firestore, ordering on a field excludes documents that lack it.
    for (const order of spec.orderBy || []) parts.push(db`${this.path(db, order.field)} IS NOT NULL`);
    return parts.reduce((all, part) => db`${all} AND ${part}`);
  }

  /**
   * Firestore's cross-type order: null < booleans < numbers < dates < strings
   * < bytes < arrays < maps, then natural order within the type, then id.
   */
  private ordering(db: Db, orderBy: OrderBy[]): Fragment {
    const keys = orderBy.flatMap((order) => {
      const x = this.path(db, order.field);
      const dir = (fragment: Fragment) => (order.direction === "desc" ? db`${fragment} DESC` : db`${fragment} ASC`);
      return [
        dir(db`CASE jsonb_typeof(${x}) WHEN 'null' THEN 0 WHEN 'boolean' THEN 1 WHEN 'number' THEN 2 WHEN 'string' THEN 4 WHEN 'array' THEN 6 ELSE CASE WHEN ${x} ? '$date' THEN 3 WHEN ${x} ? '$bytes' THEN 5 ELSE 7 END END`),
        dir(db`CASE WHEN jsonb_typeof(${x}) = 'number' THEN (${x} #>> '{}')::numeric END`),
        dir(db`CASE WHEN jsonb_typeof(${x}) = 'string' THEN (${x} #>> '{}') WHEN jsonb_typeof(${x}) = 'object' THEN COALESCE(${x} ->> '$date', ${x} ->> '$bytes') END COLLATE "C"`),
        dir(x),
      ];
    });
    return [...keys, db`id ASC`].reduce((all, part) => db`${all}, ${part}`);
  }

  private async select<T>(db: Db, spec: QuerySpec): Promise<DocSnapshot<T>[]> {
    const rows = await db<Row[]>`SELECT id, doc, update_time FROM ${db(this.table)} WHERE ${this.filters(db, spec)} ORDER BY ${this.ordering(db, spec.orderBy || [])} ${spec.limit !== undefined ? db`LIMIT ${spec.limit}` : db``}`;
    return rows.map((row) => this.snapshot<T>(row));
  }

  private async tally(db: Db, spec: QuerySpec): Promise<number> {
    const rows = await db<Array<{ total: string }>>`SELECT count(*)::text AS total FROM ${db(this.table)} WHERE ${this.filters(db, { ...spec, orderBy: undefined })}`;
    return Number(rows[0]?.total || 0);
  }

  async query<T = FsData>(spec: QuerySpec): Promise<DocSnapshot<T>[]> {
    await this.ensure();
    try { return await this.select<T>(this.sql, spec); } catch (error) { translate(error); }
  }

  async count(spec: QuerySpec): Promise<number> {
    await this.ensure();
    try { return await this.tally(this.sql, spec); } catch (error) { translate(error); }
  }

  /** Locks every target row, checks all preconditions, then applies the writes. */
  private async apply(db: TransactionSql, writes: Write[]): Promise<void> {
    const table = db(this.table);
    const targets = writes.map((write) => ("set" in write ? write.set : "update" in write ? write.update : write.delete));
    const current = new Map<string, string>();
    for (const target of targets) {
      assertDocumentId(target.id);
      const rows = await db<Array<{ update_time: string }>>`SELECT update_time FROM ${table} WHERE collection = ${target.collection} AND id = ${target.id} FOR UPDATE`;
      if (rows.length) current.set(`${target.collection}/${target.id}`, rows[0].update_time);
    }
    writes.forEach((write, index) => {
      const target = targets[index];
      const existing = current.get(`${target.collection}/${target.id}`);
      const precondition: Precondition | undefined = target.precondition ?? ("update" in write ? { exists: true } : undefined);
      if (!precondition) return;
      if ("exists" in precondition && precondition.exists !== (existing !== undefined)) {
        throw new FirestoreError(precondition.exists ? `No document to update: ${target.collection}/${target.id}` : `Document already exists: ${target.collection}/${target.id}`, precondition.exists ? "NOT_FOUND" : "ALREADY_EXISTS", precondition.exists ? 404 : 409);
      }
      if ("updateTime" in precondition && existing !== precondition.updateTime) throw new FirestoreError(`Stale update time for ${target.collection}/${target.id}`, "FAILED_PRECONDITION", 400);
    });
    for (const write of writes) {
      if ("set" in write) {
        await db`INSERT INTO ${table} (collection, id, doc, update_time) VALUES (${write.set.collection}, ${write.set.id}, ${db.json(toJson(write.set.data))}, ${db.unsafe(STAMP)}) ON CONFLICT (collection, id) DO UPDATE SET doc = EXCLUDED.doc, update_time = EXCLUDED.update_time`;
      } else if ("update" in write) {
        await db`UPDATE ${table} SET doc = doc || ${db.json(toJson(write.update.data))}, update_time = ${db.unsafe(STAMP)} WHERE collection = ${write.update.collection} AND id = ${write.update.id}`;
      } else {
        await db`DELETE FROM ${table} WHERE collection = ${write.delete.collection} AND id = ${write.delete.id}`;
      }
    }
  }

  async commit(writes: Write[]): Promise<void> {
    if (!writes.length) return;
    await this.ensure();
    try { await this.sql.begin((tx) => this.apply(tx, writes)); } catch (error) { translate(error); }
    await notifyCommittedWrites(writes);
  }

  async runTransaction<R>(body: (tx: FirestoreTransaction) => Promise<R>, options: { attempts?: number } = {}): Promise<R> {
    const attempts = Math.max(1, options.attempts ?? 5);
    await this.ensure();
    for (let attempt = 1; ; attempt += 1) {
      let writes: Write[] = [];
      try {
        const result = await this.sql.begin("ISOLATION LEVEL SERIALIZABLE", async (db): Promise<R> => {
          writes = [];
          const tx: FirestoreTransaction = {
            get: async <T,>(collection: string, id: string) => (await this.read<T>(db, collection, [id])).get(id) || null,
            getMany: <T,>(collection: string, ids: string[]) => this.read<T>(db, collection, ids),
            query: <T,>(spec: QuerySpec) => this.select<T>(db, spec),
            count: (spec) => this.tally(db, spec),
            write: (write) => { writes.push(write); },
          };
          const result = await body(tx);
          await this.apply(db, writes);
          return result;
        }) as R;
        await notifyCommittedWrites(writes);
        return result;
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
        const retryable = RETRYABLE.has(code) || (error instanceof FirestoreError && error.status === "ABORTED");
        if (!retryable || attempt >= attempts) translate(error);
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 25 * 2 ** attempt) + Math.random() * 50));
      }
    }
  }
}
