"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import { useAuth } from "@/components/shared/AuthProvider";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--brand)]"
            role="status"
            aria-label="Loading"
          />
          <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
        </div>
      </div>
    );
  }

  return <AdminShell>{children}</AdminShell>;
}
