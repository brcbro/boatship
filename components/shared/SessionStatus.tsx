"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Button } from "@/components/shared/ui";

/** Full-screen spinner while the first session check runs. */
export function SessionLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--brand)]" role="status" aria-label="Loading" />
        <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
      </div>
    </div>
  );
}

/**
 * Shown when the first session check failed with a network or server error.
 * The session is unknown, so the workspace is not rendered without one.
 */
export function SessionRetry() {
  const { sessionError, refresh } = useAuth();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <div role="alert" className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-6 text-center shadow-[var(--shadow-card)]">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold tracking-[-0.01em] text-[var(--ink)]">Could not check your session</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Boatship did not respond. Check your connection and try again.</p>
        {sessionError ? <p className="mt-2 text-xs text-[var(--ink-faint)]">{sessionError}</p> : null}
        <Button className="mt-5" onClick={() => void retry()} disabled={retrying}>
          <RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      </div>
    </div>
  );
}
