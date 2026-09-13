"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Bot,
  Sparkles,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Gauge,
  LayoutDashboard,
  MessageSquare,
  Menu,
  Plug,
  ShieldCheck,
  Users,
  UsersRound,
  Webhook,
  KeyRound,
  X,
} from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { NotificationBell } from "@/components/shared/NotificationBell";
import { Button } from "@/components/shared/ui";
import { cn, statusLabel } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/team", label: "Team", icon: UsersRound },
  { href: "/workload", label: "Workload", icon: Gauge },
  { href: "/projects", label: "Projects", icon: ClipboardCheck },
  { href: "/workspace", label: "Workspace", icon: UsersRound },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/templates", label: "Templates", icon: ClipboardCheck },
  { href: "/forms", label: "Forms", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/mcp", label: "MCP access", icon: KeyRound },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck },
  { href: "/hodi", label: "Hodi dashboard", icon: Bot },
  { href: "/automations", label: "Automations", icon: Sparkles },
  { href: "/agent", label: "Hodi", icon: Bot },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAgentWorkspace = pathname === "/agent";
  const { session, logout, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
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

  function nav(compact = false) {
    return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        (() => {
          const Icon = item.icon;
          return <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            title={compact ? item.label : undefined}
            className={cn(
              "group flex items-center rounded-lg py-2.5 text-sm font-medium transition-all duration-200",
              compact ? "justify-center px-2" : "gap-3 px-3",
              isActive(pathname, item.href)
                ? "bg-white/[0.14] text-white shadow-[inset_3px_0_0_var(--accent)]"
                : "text-slate-300 hover:translate-x-0.5 hover:bg-white/[0.07] hover:text-white"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {compact ? <span className="sr-only">{item.label}</span> : item.label}
          </Link>;
        })()
      ))}
    </nav>
    );
  }

  function userBlock(compact = false) {
    return (
    <div className="mt-auto border-t border-white/10 pt-4">
      <div className={cn("mb-3 flex items-start gap-2", compact ? "justify-center" : "justify-between")}>
        <div className={cn("min-w-0", compact && "hidden")}>
          <p className="truncate text-sm font-medium text-white">
            {loading ? "…" : session?.name || "Staff"}
          </p>
          <p className="truncate text-xs text-slate-400">
            {session?.role ? statusLabel(session.role) : "—"}
            {session?.email ? ` · ${session.email}` : ""}
          </p>
        </div>
        <NotificationBell tone="dark" className="shrink-0" />
      </div>
      <Button
        variant="secondary"
        size="sm"
        title={compact ? "Logout" : undefined}
        className={cn("border-white/20 bg-white/10 text-white hover:bg-white/15", compact ? "mx-auto flex w-10 px-0" : "w-full")}
        onClick={() => void onLogout()}
        disabled={loggingOut}
      >
        {compact ? <span aria-hidden="true">↪</span> : loggingOut ? "Signing out…" : "Logout"}
      </Button>
    </div>
    );
  }

  return (
    <div className={cn(
      isAgentWorkspace
        ? "flex h-dvh min-h-0 flex-col overflow-hidden lg:flex-row"
        : "min-h-screen lg:flex lg:h-screen lg:overflow-hidden"
    )}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-[var(--brand)]">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className={cn("hidden shrink-0 flex-col bg-[linear-gradient(180deg,var(--brand),#0d222b)] py-6 text-white transition-[width] duration-300 lg:flex lg:overflow-y-auto lg:overscroll-contain", collapsed ? "w-20 px-3" : "w-64 px-4")}>
        <div className={cn("mb-8 flex items-center", collapsed ? "justify-center" : "justify-between px-2")}>
          {collapsed ? null : (
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <img src="/brand/boatship-logo-white.png" alt="Boatship" className="h-8 w-auto max-w-[9.5rem] object-contain" />
            </Link>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="flex h-10 w-10 items-center justify-center rounded-md text-white hover:bg-white/10"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        {nav(collapsed)}
        {userBlock(collapsed)}
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <img src="/brand/boatship-logo-black.png" alt="Boatship" className="h-8 w-auto max-w-[10rem] object-contain" />
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell tone="light" />
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex h-11 w-11 items-center justify-center rounded-md text-[var(--ink)] hover:bg-[var(--surface-2)]"
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
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="absolute inset-y-0 left-0 flex w-[min(18rem,calc(100vw-2rem))] flex-col overflow-y-auto bg-[var(--brand)] px-4 py-6 text-white shadow-xl"
          >
            <div className="mb-8 flex items-center justify-between px-2">
              <img src="/brand/boatship-logo-white.png" alt="Boatship" className="h-7 w-auto max-w-[9rem] object-contain" />
              <button
                type="button"
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav()}
            {userBlock()}
          </aside>
        </div>
      ) : null}

      <main
        id="main-content"
        className={cn(
          "page-enter min-w-0 flex-1",
          isAgentWorkspace
            ? "min-h-0 overflow-hidden"
            : "px-4 py-6 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:px-10 lg:py-9"
        )}
      >
        {children}
      </main>
      <CommandPalette variant="admin" />
    </div>
  );
}
