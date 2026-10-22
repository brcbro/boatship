/**
 * The subset of Firestore the application uses, as one interface implemented
 * by the REST client (hosted and emulator) and an in-memory store (tests).
 */
export type FsPrimitive = string | number | boolean | null;
export type FsValue = FsPrimitive | Date | Uint8Array | FsValue[] | FsData;
export type FsData = { [key: string]: FsValue | undefined };

export type DocSnapshot<T = FsData> = { id: string; data: T; updateTime: string | null };

/** `exists` guards creation/deletion; `updateTime` is optimistic concurrency. */
export type Precondition = { exists: boolean } | { updateTime: string };

export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains" | "array-contains-any";
export type Where =
  | { field: string; op: WhereOp; value: FsValue }
  | { field: string; op: "is-null" | "is-not-null" };
export type OrderBy = { field: string; direction?: "asc" | "desc" };
export type QuerySpec = { collection: string; where?: Where[]; orderBy?: OrderBy[]; limit?: number };

export type Write =
  | { set: { collection: string; id: string; data: FsData; precondition?: Precondition } }
  /** Replaces only the named top-level fields; other fields are kept. */
  | { update: { collection: string; id: string; data: FsData; precondition?: Precondition } }
  | { delete: { collection: string; id: string; precondition?: Precondition } };

export interface FirestoreReader {
  get<T = FsData>(collection: string, id: string): Promise<DocSnapshot<T> | null>;
  getMany<T = FsData>(collection: string, ids: string[]): Promise<Map<string, DocSnapshot<T>>>;
  query<T = FsData>(spec: QuerySpec): Promise<DocSnapshot<T>[]>;
  count(spec: QuerySpec): Promise<number>;
}

export interface FirestoreTransaction extends FirestoreReader {
  write(write: Write): void;
}

export interface FirestoreClient extends FirestoreReader {
  /** Atomic multi-document write with per-document preconditions. */
  commit(writes: Write[]): Promise<void>;
  /** Serializable read-write transaction; retried on contention. */
  runTransaction<R>(body: (tx: FirestoreTransaction) => Promise<R>, options?: { attempts?: number }): Promise<R>;
}

export class FirestoreError extends Error {
  constructor(message: string, readonly status: string, readonly httpStatus: number) {
    super(message);
    this.name = "FirestoreError";
  }
}

export const isFirestoreStatus = (error: unknown, ...statuses: string[]): boolean =>
  error instanceof FirestoreError && statuses.includes(error.status);

export const DOCUMENT_ID_PATTERN = /^(?!\.\.?$)(?!__.*__$)[^/]{1,1500}$/;
export function assertDocumentId(id: string): string {
  if (typeof id !== "string" || !DOCUMENT_ID_PATTERN.test(id)) throw new FirestoreError(`Invalid document id: ${JSON.stringify(id).slice(0, 80)}`, "INVALID_ARGUMENT", 400);
  return id;
}
