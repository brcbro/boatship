import { after } from "next/server";

/**
 * Runs a queue drain after the current response is sent so hosted delivery
 * starts within seconds of enqueue instead of waiting for the safety cron.
 * Production only: local tests and `next dev` drain explicitly, and the
 * Worker cron remains the retry path when a background run is interrupted.
 */
export function drainAfterResponse(label: string, task: () => Promise<unknown>) {
  if (process.env.NODE_ENV !== "production") return;
  const run = () => task().then(() => undefined, (error: unknown) => {
    console.warn(`[queue] background ${label} drain did not finish; the hourly cron will retry`, error instanceof Error ? error.message : "unknown error");
  });
  try {
    after(run);
  } catch {
    // Outside a request scope (no response to wait on): run detached.
    void run();
  }
}
