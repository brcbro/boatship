"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type SearchResult = {
  type: "client" | "task" | "document" | "vessel";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

type NavLink = { href: string; label: string };

const ADMIN_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
  { href: "/calendar", label: "Calendar" },
  { href: "/messages", label: "Messages" },
  { href: "/team", label: "Team" },
  { href: "/forms", label: "Forms" },
  { href: "/integrations", label: "Integrations" },
  { href: "/webhooks", label: "Webhooks" },
  { href: "/workload", label: "Workload" },
  { href: "/agent", label: "Agent" },
];

const CLIENT_LINKS: NavLink[] = [
  { href: "/portal", label: "Dashboard" },
  { href: "/portal/tasks", label: "Tasks" },
  { href: "/portal/documents", label: "Documents" },
  { href: "/portal/forms", label: "Forms" },
  { href: "/portal/messages", label: "Messages" },
];

function typeLabel(type: SearchResult["type"]) {
  if (type === "client") return "Client";
  if (type === "task") return "Task";
  if (type === "document") return "Document";
  return "Vessel";
}

export function CommandPalette({ variant }: { variant: "admin" | "client" }) {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const links = variant === "admin" ? ADMIN_LINKS : CLIENT_LINKS;

  const filteredLinks = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return links;
    return links.filter((l) => l.label.toLowerCase().includes(needle));
  }, [links, q]);

  const items = useMemo(() => {
    const nav = filteredLinks.map((l) => ({
      kind: "nav" as const,
      id: `nav-${l.href}`,
      title: l.label,
      subtitle: "Go to",
      href: l.href,
    }));
    const search = results.map((r) => ({
      kind: "search" as const,
      id: `${r.type}-${r.id}`,
      title: r.title,
      subtitle: [typeLabel(r.type), r.subtitle].filter(Boolean).join(" · "),
      href: r.href,
    }));
    return [...nav, ...search];
  }, [filteredLinks, results]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQ("");
        setResults([]);
        setActive(0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  const runSearch = useCallback(
    async (query: string) => {
      if (authLoading || !query.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const data = await apiFetch<{ results: SearchResult[] }>(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          { token }
        );
        setResults(data.results || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [token, authLoading]
  );

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void runSearch(q), 180);
    return () => clearTimeout(t);
  }, [q, open, runSearch]);

  function close() {
    setOpen(false);
    setQ("");
    setResults([]);
    setActive(0);
  }

  function go(href: string) {
    close();
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && items[Math.min(active, items.length - 1)]) {
      e.preventDefault();
      go(items[Math.min(active, items.length - 1)].href);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh] sm:pt-[15vh]">
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-[rgba(20,20,20,0.45)] backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[0_24px_80px_rgba(20,20,20,0.22)]"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Search or jump to…"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
            aria-label="Search"
          />
          <kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--ink-muted)] sm:inline">
            Esc
          </kbd>
        </div>

        <div className="max-h-[min(60vh,420px)] overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[var(--ink-muted)]">
              {searching ? "Searching…" : "No matches"}
            </p>
          ) : (
            <ul className="px-2">
              {filteredLinks.length > 0 ? (
                <li className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  Navigate
                </li>
              ) : null}
              {items.map((item, idx) => {
                const isNav = item.kind === "nav";
                const showSearchHeader =
                  !isNav && items[idx - 1]?.kind === "nav";
                return (
                  <li key={item.id}>
                    {showSearchHeader ? (
                      <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                        Results
                      </div>
                    ) : null}
                    <Link
                      href={item.href}
                      onClick={(e) => {
                        e.preventDefault();
                        go(item.href);
                      }}
                      onMouseEnter={() => setActive(idx)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition",
                        idx === Math.min(active, items.length - 1)
                          ? "bg-[var(--surface-2)] text-[var(--ink)]"
                          : "text-[var(--ink)] hover:bg-[var(--surface-2)]/70"
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{item.title}</span>
                        {item.subtitle ? (
                          <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--ink-muted)]">
          <span className="mr-3">↑↓ Navigate</span>
          <span className="mr-3">↵ Open</span>
          <span>⌘K / Ctrl+K Toggle</span>
        </div>
      </div>
    </div>
  );
}
