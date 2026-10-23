"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronsLeft, ChevronsRight, LogOut, Menu, Search, Settings2, X } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { CommandPalette, openCommandPalette } from "@/components/shared/CommandPalette";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Kbd } from "@/components/shared/ui";
import { cn, statusLabel } from "@/lib/utils";
import { hasPermission } from "@/lib/rbac";
import { NAV_GROUPS, SETTINGS_ITEMS, isActivePath, isSettingsPath, type NavItem } from "./navigation";
import { HodiDrawer, HodiDrawerButton } from "./HodiDrawer";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAgentWorkspace = pathname === "/agent";
  const inSettings = isSettingsPath(pathname);
  const { session, logout, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [hodiOpen, setHodiOpen] = useState(false);
  const hodiButtonRef = useRef<HTMLButtonElement>(null);
  const closeHodi = useCallback(() => setHodiOpen(false), []);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      (menuButton ?? previousFocus)?.focus();
    };
  }, [open]);

  useEffect(() => {
    setCollapsed(localStorage.getItem("boatship-sidebar-collapsed") === "true");
  }, []);

  function toggleSidebar() {
    setCollapsed((value) => {
      const next = !value;
      localStorage.setItem("boatship-sidebar-collapsed", String(next));
      return next;
    });
  }

  async function onLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  function visible(items: readonly NavItem[]) {
    return items.filter((item) => (!item.adminOnly || session?.role === "admin") && (!item.permission || (!!session && hasPermission(session, item.permission))));
  }

  function navLink(item: NavItem, compact: boolean) {
    const Icon = item.icon;
    const active = isActivePath(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={false}
        onClick={() => setOpen(false)}
        title={compact ? item.label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex min-h-10 items-center rounded-[var(--radius-md)] text-[13.5px] font-medium transition-colors duration-150",
          compact ? "justify-center px-0" : "gap-3 px-3",
          active ? "bg-[var(--nav-active)] text-[var(--nav-fg-strong)]" : "text-[var(--nav-fg)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-fg-strong)]"
        )}
      >
        {active ? <span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]" /> : null}
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={active ? 2.25 : 1.9} />
        {compact ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      </Link>
    );
  }

  function nav(compact = false) {
    if (inSettings) {
      return (
        <nav aria-label="Settings navigation" className="flex flex-col gap-1">
          <Link href="/dashboard" prefetch={false} onClick={() => setOpen(false)} title={compact ? "Back to work" : undefined} className={cn("mb-3 flex min-h-10 items-center rounded-[var(--radius-md)] text-[13px] font-semibold text-[var(--nav-fg)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-fg-strong)]", compact ? "justify-center" : "gap-2 px-3")}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {compact ? <span className="sr-only">Back to work</span> : "Back to work"}
          </Link>
          {!compact ? <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--nav-fg)]/60">Settings</p> : null}
          {visible(SETTINGS_ITEMS).map((item) => navLink(item, compact))}
        </nav>
      );
    }
    return (
      <nav aria-label="Admin navigation" className="flex flex-col gap-6">
        {NAV_GROUPS.map((group) => {
          const items = visible(group.items);
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="flex flex-col gap-0.5">
              {compact ? <span className="sr-only">{group.label}</span> : <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--nav-fg)]/60">{group.label}</p>}
              {items.map((item) => navLink(item, compact))}
            </div>
          );
        })}
      </nav>
    );
  }

  function footer(compact = false) {
    const settingsActive = inSettings;
    return (
      <div className="mt-auto flex flex-col gap-1 border-t border-[var(--nav-border)] pt-4">
        <Link
          href="/settings"
          prefetch={false}
          onClick={() => setOpen(false)}
          title={compact ? "Settings" : undefined}
          aria-current={settingsActive ? "page" : undefined}
          className={cn("flex min-h-10 items-center rounded-[var(--radius-md)] text-[13.5px] font-medium transition-colors", compact ? "justify-center" : "gap-3 px-3", settingsActive ? "bg-[var(--nav-active)] text-[var(--nav-fg-strong)]" : "text-[var(--nav-fg)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-fg-strong)]")}
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          {compact ? <span className="sr-only">Settings</span> : "Settings"}
        </Link>
        <div className={cn("mt-2 flex items-center gap-2 rounded-[var(--radius-md)] px-1 py-1", compact && "justify-center")}>
          <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--accent)] font-[family-name:var(--font-display)] text-[13px] font-bold text-[var(--on-accent)]">
            {(session?.name || "S").trim().charAt(0).toUpperCase()}
          </span>
          {compact ? null : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-[var(--nav-fg-strong)]">{loading ? "…" : session?.name || "Staff"}</span>
              <span className="block truncate text-[11px] text-[var(--nav-fg)]/70">{session?.role ? statusLabel(session.role) : ""}</span>
            </span>
          )}
          {compact ? null : (
            <button type="button" onClick={() => void onLogout()} disabled={loggingOut} aria-label="Log out" title="Log out" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--nav-fg)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-fg-strong)] disabled:opacity-50">
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(isAgentWorkspace ? "flex h-dvh min-h-0 flex-col overflow-hidden lg:flex-row" : "min-h-screen lg:flex lg:h-screen lg:overflow-hidden")}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[var(--radius-md)] focus:bg-[var(--surface-raised)] focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-[var(--brand)]">
        Skip to content
      </a>

      {/* Desktop rail */}
      <aside className={cn("hidden shrink-0 flex-col bg-[var(--nav-bg)] py-4 text-[var(--nav-fg)] transition-[width] duration-200 lg:flex lg:overflow-y-auto lg:overscroll-contain", collapsed ? "w-[4.25rem] px-2.5" : "w-[15.5rem] px-3")}>
        <div className={cn("mb-6 flex items-center", collapsed ? "justify-center" : "justify-between pl-2")}>
          {collapsed ? null : (
            <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="Boatship home">
              <Image src="/brand/boatship-logo-white.png" width={1432} height={370} alt="Boatship" className="h-6 w-auto max-w-[8.5rem] object-contain" />
            </Link>
          )}
          <button type="button" onClick={toggleSidebar} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand navigation" : "Collapse navigation"} className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-[var(--nav-fg)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-fg-strong)]">
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>
        {nav(collapsed)}
        {footer(collapsed)}
      </aside>

      <div className={cn("flex min-w-0 flex-1 flex-col", isAgentWorkspace ? "min-h-0" : "lg:min-h-0")}>
        {/* Top strip */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-raised)]/92 px-3 backdrop-blur-xl sm:px-5 lg:static">
          <button
            ref={menuButtonRef}
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="admin-mobile-menu"
            className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] text-[var(--ink)] hover:bg-[var(--surface-2)] lg:hidden"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Link href="/dashboard" className="flex items-center lg:hidden" aria-label="Boatship home">
            <Image src="/brand/boatship-logo-black.png" width={1428} height={366} alt="Boatship" className="show-light h-6 w-auto max-w-[7.5rem] object-contain" /><Image src="/brand/boatship-logo-white.png" width={1432} height={370} alt="" aria-hidden="true" className="show-dark h-6 w-auto max-w-[7.5rem] object-contain" />
          </Link>
          <button
            type="button"
            onClick={() => openCommandPalette()}
            className="ml-auto flex h-10 w-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--ink-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--ink)] sm:ml-0 sm:w-auto sm:min-w-[18rem] sm:justify-start sm:px-3 lg:max-w-[26rem] lg:flex-1"
            aria-label="Search or jump to a page"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden flex-1 text-left sm:inline">Search clients, tasks, documents…</span>
            <span className="hidden items-center gap-1 sm:inline-flex"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          </button>
          <div className="ml-auto flex items-center gap-1">
            {isAgentWorkspace ? null : <HodiDrawerButton open={hodiOpen} onClick={() => setHodiOpen((value) => !value)} buttonRef={hodiButtonRef} />}
            <ThemeToggle />
            <NotificationBell tone="light" />
          </div>
        </header>

        {/* Mobile drawer */}
        {open ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button type="button" aria-label="Close menu overlay" className="absolute inset-0 bg-[var(--scrim)]" onClick={() => setOpen(false)} />
            <aside id="admin-mobile-menu" ref={drawerRef} role="dialog" aria-modal="true" aria-label="Navigation menu" className="absolute inset-y-0 left-0 flex w-[min(18rem,calc(100vw-3rem))] flex-col overflow-y-auto bg-[var(--nav-bg)] px-3 py-4 text-[var(--nav-fg)] shadow-[var(--shadow-pop)]">
              <div className="mb-6 flex items-center justify-between pl-2">
                <Image src="/brand/boatship-logo-white.png" width={1432} height={370} alt="Boatship" className="h-6 w-auto max-w-[8rem] object-contain" />
                <button ref={closeButtonRef} type="button" aria-label="Close" className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] hover:bg-[var(--nav-hover)]" onClick={() => setOpen(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              {nav(false)}
              {footer()}
            </aside>
          </div>
        ) : null}

        <main
          id="main-content"
          className={cn("page-enter min-w-0 flex-1", isAgentWorkspace ? "min-h-0 overflow-hidden" : "px-4 py-6 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:px-10 lg:py-8")}
        >
          {isAgentWorkspace ? children : <div className="mx-auto w-full max-w-[1320px]">{children}</div>}
        </main>
      </div>
      {isAgentWorkspace ? null : <HodiDrawer open={hodiOpen} onClose={closeHodi} triggerRef={hodiButtonRef} />}
      <CommandPalette variant="admin" />
    </div>
  );
}
