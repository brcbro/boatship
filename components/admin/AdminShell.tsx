"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { Button } from "@/components/shared/ui";
import { cn, statusLabel } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
  { href: "/team", label: "Team" },
  { href: "/workload", label: "Workload" },
  { href: "/calendar", label: "Calendar" },
  { href: "/messages", label: "Messages" },
  { href: "/templates", label: "Templates" },
  { href: "/forms", label: "Forms" },
  { href: "/analytics", label: "Analytics" },
  { href: "/integrations", label: "Integrations" },
  { href: "/webhooks", label: "Webhooks" },
  { href: "/compliance", label: "Compliance" },
  { href: "/agent", label: "Drive Agent" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({ children }: { children: React.ReactNode }) {
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

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setOpen(false)}
          className={cn(
            "rounded-md px-3 py-2 text-sm font-medium transition",
            isActive(pathname, item.href)
              ? "bg-white/10 text-white"
              : "text-slate-300 hover:bg-white/5 hover:text-white"
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );

  const userBlock = (
    <div className="mt-auto border-t border-white/10 pt-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">
            {loading ? "…" : session?.name || "Staff"}
          </p>
          <p className="truncate text-xs text-slate-400">
            {session?.role ? statusLabel(session.role) : "—"}
            {session?.email ? ` · ${session.email}` : ""}
          </p>
        </div>
        <NotificationBell tone="dark" className="hidden shrink-0 lg:block" />
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="w-full border-white/20 bg-white/10 text-white hover:bg-white/15"
        onClick={() => void onLogout()}
        disabled={loggingOut}
      >
        {loggingOut ? "Signing out…" : "Logout"}
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-[var(--brand)] px-4 py-6 text-white lg:flex">
        <Link href="/dashboard" className="mb-8 flex items-center gap-2.5 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-sm font-semibold">
            B
          </span>
          <span className="font-[family-name:var(--font-display)] text-xl tracking-tight">
            Boatship
          </span>
        </Link>
        {nav}
        {userBlock}
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] text-sm font-semibold text-white">
            B
          </span>
          <span className="font-[family-name:var(--font-display)] text-lg text-[var(--brand)]">
            Boatship
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell tone="light" />
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            className="rounded-md p-2 text-[var(--ink)] hover:bg-[var(--surface-2)]"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu overlay"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-[var(--brand)] px-4 py-6 text-white shadow-xl">
            <div className="mb-8 flex items-center justify-between px-2">
              <span className="font-[family-name:var(--font-display)] text-xl">Boatship</span>
              <button
                type="button"
                aria-label="Close"
                className="rounded-md p-1.5 hover:bg-white/10"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {userBlock}
          </aside>
        </div>
      ) : null}

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      <CommandPalette variant="admin" />
    </div>
  );
}
