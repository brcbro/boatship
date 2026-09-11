import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

/** Hash password as `saltHex:hashHex` using scrypt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const computed = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    if (expected.length !== computed.length) return false;
    return timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
