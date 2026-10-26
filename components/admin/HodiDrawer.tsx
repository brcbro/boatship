"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Bot, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/shared/AuthProvider";
import { HodiChat, type HodiContext } from "@/components/hodi/HodiChat";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Reads the record the current route is about so the drawer can hand it to
 * Hodi. Only client records, product records and the Inbox carry a context;
 * every other route opens a plain chat.
 */
function routeContext(pathname: string): HodiContext | null {
  const client = pathname.match(/^\/clients\/([^/]+)/);
  const product = pathname.match(/^\/products\/([^/]+)/);
  if (pathname === "/tasks") return { kind: "inbox", label: "Inbox", href: "/tasks" };
  if (client && client[1] !== "new") return { kind: "client", id: client[1], label: "this client", href: `/clients/${client[1]}` };
  if (product && product[1] !== "new") return { kind: "product", id: product[1], label: "this product", href: `/products/${product[1]}` };
  return null;
}

function useRouteContext(pathname: string, token: string | null): HodiContext | null {
  const base = useMemo(() => routeContext(pathname), [pathname]);
  // The record's name arrives from the API; until then the chip says "this client".
  const [resolved, setResolved] = useState<{ href: string; label: string } | null>(null);

  useEffect(() => {
    if (!base?.id) return;
    let cancelled = false;
    const request = base.kind === "client"
      ? apiFetch<{ client: { name: string; companyName: string } }>(`/api/clients/${base.id}`, { token }).then((data) => data.client.companyName || data.client.name)
      : apiFetch<{ product: { name: string } }>(`/api/products/${base.id}`, { token }).then((data) => data.product.name);
    void request.then((label) => { if (!cancelled) setResolved({ href: base.href, label }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [base, token]);

  return useMemo(() => {
    if (!base) return null;
    return resolved?.href === base.href ? { ...base, label: resolved.label } : base;
  }, [base, resolved]);
}

const XL_QUERY = "(min-width: 1280px)";

/** True below Tailwind's xl breakpoint, where the drawer overlays the page. */
function useIsNarrow() {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(XL_QUERY);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => !window.matchMedia(XL_QUERY).matches,
    () => false
  );
}

/** Button for the top strip. Hidden on the full `/agent` workspace, where the chat already fills the page. */
export function HodiDrawerButton({ open, onClick, buttonRef }: { open: boolean; onClick: () => void; buttonRef: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls="hodi-drawer"
      aria-label={open ? "Close Hodi" : "Open Hodi"}
      title={open ? "Close Hodi" : "Ask Hodi"}
      className={cn(
        "flex h-10 items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-sm font-semibold transition-colors",
        open ? "bg-[var(--brand)] text-[var(--on-brand)]" : "text-[var(--ink)] hover:bg-[var(--surface-2)]"
      )}
    >
      <Bot className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="hidden md:inline">Hodi</span>
    </button>
  );
}

/**
 * Right-hand panel hosting the Hodi chat beside any staff page. It stays
 * mounted after its first open so a conversation survives closing the panel;
 * the chat history itself is server-side, as on `/agent`.
 */
export function HodiDrawer({ open, onClose, triggerRef }: { open: boolean; onClose: () => void; triggerRef: React.RefObject<HTMLButtonElement | null> }) {
  const pathname = usePathname();
  const { token } = useAuth();
  const context = useRouteContext(pathname, token);
  const [everOpened, setEverOpened] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const narrow = useIsNarrow();
  // Below xl the drawer overlays the page behind a scrim, so it is a modal dialog.
  const modal = open && narrow;
  // Once opened the panel stays mounted (hidden) so the conversation survives closing it.
  if (open && !everOpened) setEverOpened(true);
  const wasOpen = useRef(false);
  useEffect(() => {
    // Return focus to the top-strip button when the drawer closes.
    if (wasOpen.current && !open) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const composer = panelRef.current?.querySelector<HTMLTextAreaElement>("textarea:not([disabled])");
    const frame = window.requestAnimationFrame(() => (composer ?? panelRef.current)?.focus());
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab" && modal && panelRef.current) {
        // Keep focus inside the overlay while it covers the page.
        const panel = panelRef.current;
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) { event.preventDefault(); panel.focus(); return; }
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !panel.contains(active))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (active === last || !panel.contains(active))) { event.preventDefault(); first.focus(); }
        return;
      }
      if (event.key !== "Escape") return;
      // Menus inside the chat (chat list, connected apps) close themselves on
      // their own; only close the drawer when focus is in the drawer itself.
      if (!panelRef.current?.contains(document.activeElement)) return;
      const openMenu = panelRef.current.querySelector("details[open]");
      if (openMenu) { openMenu.removeAttribute("open"); return; }
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, modal, onClose]);

  if (!everOpened) return null;

  return (
    <>
      {open ? <button type="button" aria-label="Close Hodi" className="fixed inset-0 z-[55] bg-[var(--scrim)] xl:hidden" onClick={onClose} /> : null}
      <aside
        id="hodi-drawer"
        ref={panelRef}
        role={modal ? "dialog" : "complementary"}
        aria-modal={modal ? true : undefined}
        aria-label="Hodi"
        // Closed but still mounted: keep it out of the tab order and the accessibility tree.
        inert={!open}
        tabIndex={-1}
        className={cn(
          "fixed inset-y-0 right-0 z-[60] flex w-[min(28rem,100vw)] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-pop)] transition-transform duration-200 xl:static xl:z-auto xl:h-auto xl:min-h-0 xl:shrink-0 xl:shadow-none",
          open ? "translate-x-0" : "translate-x-full xl:hidden"
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-raised)] px-3">
          <span className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[15px] font-bold text-[var(--ink)]">
            <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] bg-[var(--brand)] text-[var(--on-brand)]" aria-hidden="true"><Bot className="h-4 w-4" /></span>
            Hodi
          </span>
          <div className="flex items-center gap-1">
            <Link href="/agent" prefetch={false} onClick={onClose} className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]" title="Open the full workspace" aria-label="Open the full Hodi workspace">
              <ExternalLink className="h-4 w-4" />
            </Link>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]" aria-label="Close Hodi">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <HodiChat variant="drawer" context={context} />
        </div>
      </aside>
    </>
  );
}
