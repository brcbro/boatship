import { FirestoreError, type FsData, type FsValue } from "./types";

/** Firestore REST typed-value encoding. */
export type RestValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { bytesValue: string }
  | { arrayValue: { values?: RestValue[] } }
  | { mapValue: { fields?: Record<string, RestValue> } };

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};
const base64ToBytes = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

export function encodeValue(value: unknown, inArray = false): RestValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FirestoreError("Non-finite numbers cannot be stored.", "INVALID_ARGUMENT", 400);
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value instanceof Uint8Array) return { bytesValue: bytesToBase64(value) };
  if (Array.isArray(value)) {
    if (inArray) throw new FirestoreError("Firestore does not allow arrays directly inside arrays.", "INVALID_ARGUMENT", 400);
    return { arrayValue: { values: (value as unknown[]).map((item) => encodeValue(item === undefined ? null : item, true)!) } };
  }
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value as FsData) } };
  throw new FirestoreError(`Unsupported value type: ${typeof value}`, "INVALID_ARGUMENT", 400);
}

export function encodeFields(data: FsData): Record<string, RestValue> {
  const fields: Record<string, RestValue> = {};
  for (const [key, value] of Object.entries(data)) {
    const encoded = encodeValue(value);
    if (encoded !== undefined) fields[key] = encoded;
  }
  return fields;
}

export function decodeValue(value: RestValue): FsValue {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return typeof value.doubleValue === "number" ? value.doubleValue : Number(value.doubleValue);
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("bytesValue" in value) return base64ToBytes(value.bytesValue);
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  // referenceValue and geoPointValue are never written by this application.
  return null;
}

export function decodeFields(fields: Record<string, RestValue>): FsData {
  const data: FsData = {};
  for (const [key, value] of Object.entries(fields)) data[key] = decodeValue(value);
  return data;
}

/** Field paths quote any segment that is not a simple identifier. */
export function fieldPath(path: string): string {
  return path.split(".").map((segment) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(segment) ? segment : `\`${segment.replace(/[`\\]/g, "\\$&")}\``)).join(".");
}

/**
 * Firestore's cross-type ordering: null < booleans < numbers < dates <
 * strings < bytes < arrays < maps. Used by the in-memory store and for
 * client-side merges of chunked queries.
 */
export function compareValues(a: unknown, b: unknown): number {
  const rank = (value: unknown) => {
    if (value === undefined) return -1;
    if (value === null) return 0;
    if (typeof value === "boolean") return 1;
    if (typeof value === "number") return 2;
    if (value instanceof Date) return 3;
    if (typeof value === "string") return 4;
    if (value instanceof Uint8Array) return 5;
    if (Array.isArray(value)) return 6;
    return 7;
  };
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  switch (ra) {
    case 1: return Number(a) - Number(b);
    case 2: return (a as number) - (b as number);
    case 3: return (a as Date).getTime() - (b as Date).getTime();
    case 4: return compareUtf8(a as string, b as string);
    case 5: return compareBytes(a as Uint8Array, b as Uint8Array);
    case 6: {
      const left = a as unknown[], right = b as unknown[];
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        const result = compareValues(left[index], right[index]);
        if (result) return result;
      }
      return left.length - right.length;
    }
    case 7: {
      const left = Object.entries(a as FsData).sort(([x], [y]) => compareUtf8(x, y));
      const right = Object.entries(b as FsData).sort(([x], [y]) => compareUtf8(x, y));
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        const keys = compareUtf8(left[index][0], right[index][0]);
        if (keys) return keys;
        const values = compareValues(left[index][1], right[index][1]);
        if (values) return values;
      }
      return left.length - right.length;
    }
    default: return 0;
  }
}

const encoder = new TextEncoder();
function compareUtf8(a: string, b: string): number {
  if (a === b) return 0;
  return compareBytes(encoder.encode(a), encoder.encode(b));
}
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  return compareValues(a, b) === 0;
}
