import { after } from "next/server";

/**
 * Runs work after the current response is sent, in every environment. Used
 * where the response must not depend on how much work a request causes (for
 * example password recovery, whose timing would otherwise reveal whether an
 * account exists). Failures are logged without detail; outside a request
 * scope the task runs detached. Returns the task's promise for tests.
 */
export function runAfterResponse(label: string, task: () => Promise<unknown>): Promise<void> {
  const run = () => task().then(() => undefined, (error: unknown) => {
    console.warn(`[after-response] ${label} did not finish`, error instanceof Error ? error.message : "unknown error");
  });
  try {
    after(run);
    return Promise.resolve();
  } catch {
    // Outside a request scope (no response to wait on): run detached.
    return run();
  }
}
