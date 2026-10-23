"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { PageHeader } from "@/components/shared/ui";
import { SETTINGS_ITEMS } from "@/components/admin/navigation";

export default function SettingsHubPage() {
  const { session } = useAuth();
  const items = SETTINGS_ITEMS.filter((item) => item.href !== "/settings" && (!item.adminOnly || session?.role === "admin"));
  return (
    <div>
      <PageHeader eyebrow="Settings" title="Everything you configure" description="Rules, templates, connections and access live here so the daily navigation stays short. Each item opens its own page." />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={false}
                className="group flex h-full min-h-[7.5rem] flex-col justify-between rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--brand)]"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-soft)] text-[var(--brand)]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-[var(--ink-faint)] transition-colors group-hover:text-[var(--brand)]" aria-hidden="true" />
                </span>
                <span className="mt-4 block">
                  <span className="block font-[family-name:var(--font-display)] text-[17px] font-bold tracking-[-0.01em] text-[var(--ink)]">{item.label}</span>
                  {item.description ? <span className="mt-1 block text-sm leading-5 text-[var(--ink-muted)]">{item.description}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
