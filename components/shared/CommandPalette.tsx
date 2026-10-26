"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useAuth } from "@/components/shared/AuthProvider";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/shared/ui";
import { NAV_GROUPS, SETTINGS_ITEMS, visibleNavItems } from "@/components/admin/navigation";

type SearchResult = {
  type: "client" | "task" | "document" | "vessel";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

type NavLink = { href: string; label: string };

const CLIENT_LINKS: NavLink[] = [
  { href: "/portal", label: "Home" },
  { href: "/portal/tasks", label: "Tasks" },
  { href: "/portal/documents", label: "Documents" },
  { href: "/portal/messages", label: "Messages" },
  { href: "/portal/engagements", label: "Engagements" },
  { href: "/portal/forms", label: "Forms" },
  { href: "/portal/approvals", label: "Approvals" },
  { href: "/portal/account", label: "Account" },
];

const OPEN_EVENT = "boatship:command-palette";

/** Opens the palette from anywhere (the top-strip search button uses this). */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

function typeLabel(type: SearchResult["type"]) {
  if (type === "client") return "Client";
  if (type === "task") return "Task";
  if (type === "document") return "Document";
  return "Vessel";
}

export function CommandPalette({ variant }: { variant: "admin" | "client" }) {
  const { token, session, loading: authLoading } = useAuth();
  const router = useRouter();
  const listboxId = useId();
  const optionPrefix = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const links = useMemo<NavLink[]>(() => {
    if (variant === "client") return CLIENT_LINKS;
    return [
      ...NAV_GROUPS.flatMap((group) => visibleNavItems(group.items, session).map((item) => ({ href: item.href, label: item.label }))),
      ...visibleNavItems(SETTINGS_ITEMS, session).map((item) => ({ href: item.href, label: item.href === "/settings" ? "Settings" : `Settings · ${item.label}` })),
    ];
  }, [variant, session]);

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

  const activeIndex = items.length ? Math.min(active, items.length - 1) : -1;
  const optionId = (index: number) => `${optionPrefix}-option-${index}`;

  const show = useCallback((toggle: boolean) => {
    setOpen((current) => {
      const next = toggle ? !current : true;
      if (next && !current) {
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      return next;
    });
    setQ("");
    setResults([]);
    setSearchError("");
    setActive(0);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        show(true);
      }
    }
    function onOpen() {
      show(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [show]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      clearTimeout(t);
      // Return focus to whatever opened the palette (the search button or the page).
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target && target.isConnected) window.requestAnimationFrame(() => target.focus());
    };
  }, [open]);

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const runSearch = useCallback(
    async (query: string) => {
      if (authLoading || !query.trim()) {
        setResults([]);
        setSearchError("");
        return;
      }
      setSearching(true);
      try {
        const data = await apiFetch<{ results: SearchResult[] }>(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          { token }
        );
        setResults(data.results || []);
        setSearchError("");
      } catch (error) {
        setResults([]);
        setSearchError(error instanceof Error ? error.message : "Search failed");
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
    setSearchError("");
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
    if (e.key === "Tab" && dialogRef.current) {
      // Trap focus inside the dialog.
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
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
    if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      go(items[activeIndex].href);
    }
  }

  if (!open) return null;

  const firstSearchIndex = items.findIndex((item) => item.kind === "search");

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh] sm:pt-[15vh]">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close command palette"
        className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-pop)]"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Search or jump to…"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
            role="combobox"
            aria-label="Search or jump to a page"
            aria-expanded={items.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          />
          <span className="hidden sm:inline"><Kbd>Esc</Kbd></span>
        </div>

        <div className="max-h-[min(60vh,420px)] overflow-y-auto py-2">
          {searchError ? (
            <p role="alert" className="mx-4 mb-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
              Search failed: {searchError}
            </p>
          ) : null}
          {items.length === 0 && !searchError ? (
            <p role="status" className="px-4 py-6 text-center text-sm text-[var(--ink-muted)]">
              {searching ? "Searching…" : "No matches"}
            </p>
          ) : null}
          <ul id={listboxId} role="listbox" aria-label="Pages and results" className="px-2">
            {items.map((item, idx) => {
              const selected = idx === activeIndex;
              const header = idx === 0 && item.kind === "nav" ? "Navigate" : idx === firstSearchIndex ? "Results" : null;
              return (
                <li key={item.id} role="presentation">
                  {header ? (
                    <div aria-hidden="true" className={cn("px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-faint)]", header === "Navigate" ? "pt-2" : "pt-3")}>
                      {header}
                    </div>
                  ) : null}
                  <div
                    id={optionId(idx)}
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(item.href)}
                    onMouseEnter={() => setActive(idx)}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm transition-colors",
                      selected ? "bg-[var(--brand-soft)] text-[var(--ink)]" : "text-[var(--ink)] hover:bg-[var(--surface-2)]"
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
                  </div>
                </li>
              );
            })}
          </ul>
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
