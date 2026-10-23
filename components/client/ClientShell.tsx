"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  CheckSquare,
  ClipboardCheck,
  FileText,
  Home,
  Layers3,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Search,
  ThumbsUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { CommandPalette, openCommandPalette } from "@/components/shared/CommandPalette";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };

/** The four places a client goes most. Everything else sits under More. */
const PRIMARY: readonly Item[] = [
  { href: "/portal", label: "Home", icon: Home, exact: true },
  { href: "/portal/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/portal/documents", label: "Documents", icon: FileText },
  { href: "/portal/messages", label: "Messages", icon: MessageCircle },
];

const MORE: readonly Item[] = [
  { href: "/portal/engagements", label: "Engagements", icon: Layers3 },
  { href: "/portal/forms", label: "Forms", icon: ClipboardCheck },
  { href: "/portal/approvals", label: "Approvals", icon: ThumbsUp },
  { href: "/portal/account", label: "Account", icon: UserRound },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, logout, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreActive = MORE.some((item) => isActive(pathname, item.href));

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>("a[href]")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

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
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 hidden bg-[image:var(--glow)] md:block" />
      <a href="#portal-content" className="sr-only fixed left-4 top-4 z-[100] rounded-[var(--radius-md)] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--on-brand)] focus:not-sr-only">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface-raised)]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/portal" className="flex shrink-0 items-center gap-2.5" aria-label="Boatship home">
              <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--accent)] bg-[image:var(--accent-gradient)] font-[family-name:var(--font-display)] text-[17px] font-bold leading-none text-[var(--on-accent)]">b</span>
              <Image src="/brand/boatship-logo-black.png" alt="Boatship" width={1428} height={366} priority className="show-light hidden h-5 w-auto sm:block" /><Image src="/brand/boatship-logo-white.png" alt="" aria-hidden="true" width={1432} height={370} className="show-dark hidden h-5 w-auto sm:block" />
            </Link>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Client portal">
              {PRIMARY.map((item) => (
                <TopLink key={item.href} item={item} pathname={pathname} />
              ))}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}
                  aria-controls="portal-more-menu"
                  className={cn("inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] px-3 text-sm font-semibold transition-colors", open || moreActive ? "bg-[var(--surface-2)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]")}
                >
                  More
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => openCommandPalette()} aria-label="Search" className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]">
              <Search className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
            <ThemeToggle />
            <NotificationBell tone="light" />
            <Link href="/portal/account" prefetch={false} aria-label="Account" title="Account" className={cn("ml-1 hidden min-h-10 items-center gap-2 rounded-full border border-[var(--border)] py-1 pl-1 pr-3 text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)] md:inline-flex", isActive(pathname, "/portal/account") && "bg-[var(--surface-2)]")}>
              <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-[var(--brand)] text-[12px] font-bold text-[var(--on-brand)]">{(session?.name || "C").trim().charAt(0).toUpperCase()}</span>
              <span className="max-w-[9rem] truncate text-sm font-medium">{loading ? "…" : session?.name || "Client"}</span>
            </Link>
          </div>
        </div>

        {open ? (
          <div id="portal-more-menu" ref={menuRef} className="border-t border-[var(--border)] bg-[var(--surface-raised)]">
            <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 lg:px-8">
              <nav className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4" aria-label="More client sections">
                {MORE.map((item) => (
                  <Link key={item.href} href={item.href} prefetch={false} onClick={() => setOpen(false)} aria-current={isActive(pathname, item.href) ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm font-semibold transition-colors", isActive(pathname, item.href) ? "bg-[var(--surface-2)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]")}>
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--ink)]">{session?.name}</p>
                  <p className="truncate text-xs text-[var(--ink-muted)]">{session?.email}</p>
                </div>
                <button type="button" onClick={() => void onLogout()} disabled={loggingOut} className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] px-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-50">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {loggingOut ? "Signing out…" : "Log out"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <main id="portal-content" tabIndex={-1} className="page-enter mx-auto max-w-6xl px-4 py-6 pb-28 outline-none sm:px-6 sm:py-8 lg:px-8 md:pb-12">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface-raised)]/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 backdrop-blur-xl md:hidden" aria-label="Client portal">
        <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
          {PRIMARY.map((item) => (
            <TabLink key={item.href} item={item} pathname={pathname} />
          ))}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Close more navigation" : "Open more navigation"}
            aria-expanded={open}
            aria-controls="portal-more-menu"
            className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-1 text-[11px] font-semibold transition-colors", open || moreActive ? "text-[var(--brand)]" : "text-[var(--ink-muted)]")}
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

function TopLink({ item, pathname }: { item: Item; pathname: string }) {
  const active = isActive(pathname, item.href, item.exact);
  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={cn("inline-flex min-h-10 items-center rounded-[var(--radius-md)] px-3 text-sm font-semibold transition-colors", active ? "bg-[var(--surface-2)] text-[var(--ink)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]")}
    >
      {item.label}
    </Link>
  );
}

function TabLink({ item, pathname }: { item: Item; pathname: string }) {
  const active = isActive(pathname, item.href, item.exact);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={cn("relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-1 text-[11px] font-semibold transition-colors", active ? "text-[var(--brand)]" : "text-[var(--ink-muted)]")}
    >
      {active ? <span aria-hidden="true" className="absolute top-0 h-[3px] w-6 rounded-b-full bg-[var(--brand)]" /> : null}
      <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={active ? 2.25 : 1.9} />
      <span>{item.label}</span>
    </Link>
  );
}
