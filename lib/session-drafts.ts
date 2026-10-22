/** Drafts survive refresh in this tab, but never enter persistent localStorage. */
const PREFIX = "boatship_draft_v1:";
export const SESSION_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DRAFT_LENGTH = 500000;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function sessionDraftKey(scope: {
  userId: string;
  area: "form" | "intake";
  resourceId: string;
  context?: string;
}) {
  return `${PREFIX}${[scope.userId, scope.area, scope.resourceId, scope.context || ""].map(encodeURIComponent).join(":")}`;
}

function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readSessionDraft<T>(
  key: string,
  decode: (value: unknown) => T | null,
  storage = browserStorage(),
  now = Date.now()
): { value: T; savedAt: number } | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    if (raw.length > MAX_DRAFT_LENGTH) throw new Error("Oversized draft");
    const record = JSON.parse(raw) as { version?: unknown; savedAt?: unknown; value?: unknown };
    if (!record || record.version !== 1 || typeof record.savedAt !== "number" ||
      !Number.isFinite(record.savedAt) || record.savedAt > now || now - record.savedAt >= SESSION_DRAFT_TTL_MS) {
      throw new Error("Expired draft");
    }
    const value = decode(record.value);
    if (value === null) throw new Error("Invalid draft");
    return { value, savedAt: record.savedAt };
  } catch {
    discardSessionDraft(key, storage);
    return null;
  }
}

export function writeSessionDraft(key: string, value: unknown, storage = browserStorage(), now = Date.now()) {
  if (!storage) return false;
  try {
    const raw = JSON.stringify({ version: 1, savedAt: now, value });
    if (raw.length > MAX_DRAFT_LENGTH) return false;
    storage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function discardSessionDraft(key: string, storage = browserStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Called when browser auth is cleared or changes user. */
export function clearSessionDrafts(storage = browserStorage()) {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Restricted browser storage should not prevent sign-out.
  }
}
