export function webhookRetry(attempts: number, now = Date.now()) {
  return {
    state: attempts >= 10 ? "failed" as const : "pending" as const,
    nextAttemptAt: new Date(now + Math.min(2 ** attempts * 60_000, 3_600_000)).toISOString(),
  };
}
