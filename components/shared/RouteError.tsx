"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button, buttonClasses } from "@/components/shared/ui";

/** Fallback for a route segment's error boundary (error.tsx). */
export function RouteError({
  error,
  retry,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref: string;
  homeLabel: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-10">
      <div role="alert" className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-6 text-center shadow-[var(--shadow-card)]">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold tracking-[-0.01em] text-[var(--ink)]">This page did not load</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Something went wrong while showing this page. Try again, or go back and continue elsewhere.</p>
        {error.digest ? <p className="mt-2 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-faint)]">Reference {error.digest}</p> : null}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => retry()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Link href={homeHref} className={buttonClasses({ variant: "secondary" })}>{homeLabel}</Link>
        </div>
      </div>
    </div>
  );
}

/** Spinner for a route segment's loading.tsx. */
export function RouteLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--brand)]" aria-hidden="true" />
        <p className="text-sm text-[var(--ink-muted)]">{label}</p>
      </div>
    </div>
  );
}
