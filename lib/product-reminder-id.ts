import { createHash } from "crypto";

export function productReminderId(day: string, kind: string, itemId: string, userId: string) {
  return createHash("sha256").update(`${day}:${kind}:${itemId}:${userId}`).digest("hex");
}
