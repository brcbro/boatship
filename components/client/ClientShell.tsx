"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { Button } from "@/components/shared/ui";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/portal", label: "Dashboard", exact: true },
  { href: "/portal/tasks", label: "Tasks" },
  { href: "/portal/documents", label: "Documents" },
  { href: "/portal/forms", label: "Forms" },
  { href: "/portal/approvals", label: "Approvals" },
  { href: "/portal/messages", label: "Messages" },
] as const;

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, logout, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function onLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface-raised)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/portal" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] text-sm font-semibold text-white">
                B
              </span>
              <span className="font-[family-name:var(--font-display)] text-lg tracking-tight text-[var(--brand)]">
                Boatship Workspace
              </span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition",
                    isActive(pathname, item.href, "exact" in item && item.exact)
                      ? "bg-[var(--surface-2)] text-[var(--ink)]"
                      : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell tone="light" />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-[var(--ink)]">
                {loading ? "…" : session?.name || "Client"}
              </p>
              <p className="text-xs text-[var(--ink-muted)]">{session?.email}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onLogout()}
              disabled={loggingOut}
              className="hidden sm:inline-flex"
            >
              {loggingOut ? "Signing out…" : "Logout"}
            </Button>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--ink)] md:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {open ? (
          <div className="border-t border-[var(--border)] bg-white px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium",
                    isActive(pathname, item.href, "exact" in item && item.exact)
                      ? "bg-[var(--surface-2)] text-[var(--ink)]"
                      : "text-[var(--ink-muted)]"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
              <div>
                <p className="text-sm font-medium text-[var(--ink)]">{session?.name}</p>
                <p className="text-xs text-[var(--ink-muted)]">{session?.email}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onLogout()}
                disabled={loggingOut}
              >
                Logout
              </Button>
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      <CommandPalette variant="client" />
    </div>
  );
}
