"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Button, Card } from "@/components/shared/ui";
import { apiFetch } from "@/lib/api-client";
import type { AccountPreferences } from "@/lib/account-preferences";
import { cn } from "@/lib/utils";

/*
 * Building blocks shared by the account sections. Each section loads and
 * saves on its own (plan 12): a failure in one never blocks another, so there
 * is no shared Promise.all and no shared loading state here.
 */

export function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export type Resource<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  setData: (next: T | null | ((current: T | null) => T | null)) => void;
};

/** Loads one endpoint for the signed-in person once the session is known; `enabled: false` skips it (a client has no digest, for example). */
export function useAccountResource<T>(path: string, options: { enabled?: boolean } = {}): Resource<T> {
  const { session, loading: authLoading } = useAuth();
  const enabled = options.enabled ?? true;
  const uid = session?.uid;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await apiFetch<T>(path));
    } catch (loadError) {
      setError(messageFor(loadError));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!enabled || authLoading || !uid) return;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, uid, enabled, reload]);

  // Loading until the first answer arrives, so a section never flashes its
  // empty or error state between the session resolving and the fetch starting.
  return { data, loading: enabled && (authLoading || loading || (data === null && !error)), error, reload, setData };
}

type DisplayPreferencesValue = { preferences: AccountPreferences | null; setPreferences: (next: AccountPreferences) => void };
const DisplayPreferencesContext = createContext<DisplayPreferencesValue>({ preferences: null, setPreferences: () => undefined });

/** Loads the saved display preferences once per account page and shares them with every card. */
export function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const resource = useAccountResource<{ preferences: AccountPreferences }>("/api/account/preferences");
  const setData = resource.setData;
  const value = useMemo<DisplayPreferencesValue>(() => ({
    preferences: resource.data?.preferences ?? null,
    setPreferences: (next) => setData({ preferences: next }),
  }), [resource.data, setData]);
  return <DisplayPreferencesContext.Provider value={value}>{children}</DisplayPreferencesContext.Provider>;
}

/** The person's saved display preferences, for dates on account pages. Null (device defaults) while loading or on failure. */
export function useDisplayPreferences(): AccountPreferences | null {
  return useContext(DisplayPreferencesContext).preferences;
}

export function useSetDisplayPreferences() {
  return useContext(DisplayPreferencesContext).setPreferences;
}

/** Warns before the tab is closed or reloaded with unsaved, non-secret edits. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

export function SectionCard({ title, description, children, className, id }: { title: string; description?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <Card id={id} className={cn("p-5 sm:p-6", className)}>
      <div className="mb-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.01em] text-[var(--ink)]">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}

export function SectionSkeleton({ title, lines = 2 }: { title: string; lines?: number }) {
  return (
    <Card className="animate-pulse p-5 sm:p-6" aria-busy="true" aria-label={`Loading ${title}`}>
      <div className="h-5 w-40 rounded bg-[var(--surface-2)]" />
      {Array.from({ length: lines }, (_, index) => <div key={index} className="mt-4 h-11 rounded bg-[var(--surface-2)]" />)}
    </Card>
  );
}

export function SectionError({ title, error, onRetry }: { title: string; error: string; onRetry: () => void }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.01em] text-[var(--ink)]">{title}</h2>
      <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p>
      <Button type="button" variant="secondary" className="mt-4" onClick={onRetry}>Try again</Button>
    </Card>
  );
}

export function ErrorText({ children, id }: { children: ReactNode; id?: string }) {
  return children ? <p id={id} role="alert" className="text-sm text-[var(--danger)]">{children}</p> : null;
}

export function StatusText({ children }: { children: ReactNode }) {
  return children ? (
    <p role="status" className="flex items-center gap-2 text-sm text-[var(--success)]">
      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  ) : null;
}

/** Definition-style read-only facts. */
export function Facts({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
          <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">{item.label}</dt>
          <dd className="mt-1 break-words text-sm font-medium text-[var(--ink)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
