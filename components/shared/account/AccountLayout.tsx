"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Bell, KeyRound, Lock, ShieldCheck, SlidersHorizontal, UserRound, type LucideIcon } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { Badge, PageHeader, Tabs } from "@/components/shared/ui";
import { cn, statusLabel } from "@/lib/utils";
import { DisplayPreferencesProvider } from "./shared";

/*
 * The six personal account sections (plan 3), shared by the staff shell at
 * /account and the client shell at /portal/account. The layout only needs
 * the verified session for the identity summary; every section loads its own
 * data so one failure never hides the others.
 */

export type AccountSectionKey = "profile" | "security" | "notifications" | "preferences" | "access" | "privacy";

export const ACCOUNT_SECTIONS: ReadonlyArray<{ key: AccountSectionKey; path: string; label: string; icon: LucideIcon; description: string }> = [
  { key: "profile", path: "", label: "Profile", icon: UserRound, description: "Your name, login email and account state." },
  { key: "security", path: "/security", label: "Security and sessions", icon: ShieldCheck, description: "Password, signed-in devices and recent security activity." },
  { key: "notifications", path: "/notifications", label: "Notifications", icon: Bell, description: "What Boatship sends you by email." },
  { key: "preferences", path: "/preferences", label: "Preferences", icon: SlidersHorizontal, description: "Appearance, timezone and time format." },
  { key: "access", path: "/access", label: "My access", icon: KeyRound, description: "What your role and assignments let you do." },
  { key: "privacy", path: "/privacy", label: "Privacy and requests", icon: Lock, description: "Request your data, more access, or deactivation." },
];

export function accountSectionHref(basePath: string, key: AccountSectionKey) {
  return `${basePath}${ACCOUNT_SECTIONS.find((section) => section.key === key)?.path ?? ""}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
}

export function AccountLayout({ basePath, children }: { basePath: "/account" | "/portal/account"; children: ReactNode }) {
  const pathname = usePathname();
  const { session, loading } = useAuth();
  const items = ACCOUNT_SECTIONS.map((section) => ({ href: `${basePath}${section.path}`, label: section.label, exact: section.path === "" }));
  const current = ACCOUNT_SECTIONS.find((section) => (section.path === "" ? pathname === basePath : pathname === `${basePath}${section.path}` || pathname.startsWith(`${basePath}${section.path}/`))) ?? ACCOUNT_SECTIONS[0];

  return (
    <div className="mx-auto max-w-5xl pb-6">
      <PageHeader
        eyebrow="My account"
        title={current.label}
        description={current.description}
      />

      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--accent)] font-[family-name:var(--font-display)] text-[15px] font-extrabold text-[var(--on-accent)]">
              {loading ? "…" : initials(session?.name || "")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--ink)]">{loading ? "Loading…" : session?.name || "Your account"}</p>
              <p className="truncate text-xs text-[var(--ink-muted)]">{session?.email}</p>
              {session?.role ? <Badge tone={session.role === "admin" ? "brand" : session.role === "client" ? "accent" : "neutral"} className="mt-1">{session.role === "admin" ? "Administrator" : session.role === "team" ? "Team member" : statusLabel(session.role)}</Badge> : null}
            </div>
          </div>

          {/* Below lg the sections are horizontal scrolling tabs; from lg a vertical list. */}
          <div className="lg:hidden">
            <Tabs items={items} pathname={pathname} ariaLabel="Account sections" />
          </div>
          <nav aria-label="Account sections" className="hidden lg:block">
            <ul className="flex flex-col gap-0.5">
              {ACCOUNT_SECTIONS.map((section) => {
                const active = section.key === current.key;
                const Icon = section.icon;
                return (
                  <li key={section.key}>
                    <Link
                      href={`${basePath}${section.path}`}
                      prefetch={false}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm font-semibold transition-colors",
                        active ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={active ? 2.25 : 1.9} />
                      <span className="truncate">{section.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0 space-y-5"><DisplayPreferencesProvider>{children}</DisplayPreferencesProvider></div>
      </div>
    </div>
  );
}
