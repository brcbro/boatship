"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CheckSquare,
  FileText,
  LayoutDashboard,
  Menu,
  MessageCircle,
  MoreHorizontal,
  ClipboardCheck,
  X,
} from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { Button } from "@/components/shared/ui";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/portal/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/portal/documents", label: "Documents", icon: FileText },
  { href: "/portal/forms", label: "Forms", icon: ClipboardCheck },
  { href: "/portal/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/portal/messages", label: "Messages", icon: MessageCircle },
] as const;

const MOBILE_NAV = NAV.slice(0, 4);

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
    <div className="min-h-dvh bg-[var(--background)]">
      <a
        href="#portal-content"
        className="sr-only fixed left-4 top-4 z-[100] rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white focus:not-sr-only"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface-raised)]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 xl:gap-7">
            <Link href="/portal" className="flex shrink-0 items-center rounded-lg bg-[var(--brand)] px-2.5 py-2 transition hover:bg-[var(--brand-strong)]">
              <Image src="/brand/boatship-logo-white.png" alt="Boatship Workspace" width={154} height={30} priority className="h-5 w-auto sm:h-6" />
            </Link>

            <nav className="hidden items-center gap-1 xl:flex" aria-label="Client portal">
              {NAV.map((item) => (
                <PortalNavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <NotificationBell tone="light" />
            <div className="hidden max-w-72 text-right 2xl:block">
              <p className="truncate text-sm font-medium text-[var(--ink)]">
                {loading ? "…" : session?.name || "Client"}
              </p>
              <p className="truncate text-xs text-[var(--ink-muted)]">{session?.email}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onLogout()}
              disabled={loggingOut}
              className="hidden xl:inline-flex"
            >
              {loggingOut ? "Signing out…" : "Logout"}
            </Button>
            <button
              type="button"
              className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--ink)] transition hover:bg-[var(--surface-2)] xl:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {open ? (
          <div className="border-t border-[var(--border)] bg-[var(--surface-raised)] px-4 py-4 xl:hidden">
            <nav className="flex flex-col gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition",
                    isActive(pathname, item.href, "exact" in item && item.exact)
                      ? "bg-[var(--surface-2)] text-[var(--ink)]"
                      : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
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

      <main id="portal-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-7 pb-28 outline-none sm:px-6 sm:py-10 lg:px-8 xl:pb-10">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface-raised)]/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur-xl xl:hidden" aria-label="Client portal">
        <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
          {MOBILE_NAV.map((item) => <PortalNavLink key={item.href} item={item} pathname={pathname} compact />)}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Close more navigation" : "Open more navigation"}
            aria-expanded={open}
            className={cn(
              "flex min-h-12 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition",
              open ? "bg-[var(--surface-2)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)]"
            )}
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            More
          </button>
        </div>
      </nav>
      <CommandPalette variant="client" />
    </div>
  );
}

function PortalNavLink({
  item,
  pathname,
  compact = false,
}: {
  item: (typeof NAV)[number];
  pathname: string;
  compact?: boolean;
}) {
  const active = isActive(pathname, item.href, "exact" in item && item.exact);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        compact
          ? "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-semibold transition"
          : "inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition",
        active
          ? "bg-[var(--surface-2)] text-[var(--ink)]"
          : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
      )}
    >
      <Icon className={compact ? "h-5 w-5" : "h-4 w-4"} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}
