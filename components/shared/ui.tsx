"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 active:translate-y-px active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "min-h-8 px-3 py-1.5 text-sm max-sm:min-h-11",
        size === "md" && "min-h-10 px-4 py-2 text-sm max-sm:min-h-11",
        size === "lg" && "min-h-11 px-5 py-2.5 text-base",
        variant === "primary" &&
          "bg-[var(--brand)] text-white shadow-[0_8px_18px_rgba(20,43,53,0.14)] hover:-translate-y-0.5 hover:bg-[var(--brand-strong)] hover:shadow-[0_12px_24px_rgba(20,43,53,0.18)]",
        variant === "secondary" &&
          "border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--ink)] hover:-translate-y-0.5 hover:border-[var(--accent)]/45 hover:bg-[var(--accent-soft)]",
        variant === "ghost" &&
          "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
        variant === "danger" && "bg-[var(--danger)] text-white hover:bg-[#6f1515]",
        className
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-all duration-200 placeholder:text-[var(--ink-muted)]/70 focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/10 max-sm:min-h-11",
        className
      )}
      {...props}
    />
  );
}

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-all duration-200 placeholder:text-[var(--ink-muted)]/70 focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/10",
        className
      )}
      {...props}
    />
  );
});

/** Native select styled to theme (kept for simple cases). Prefer Dropdown. */
export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "boatship-select min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition-all duration-200 focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/10 max-sm:min-h-11",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export type DropdownOption = { value: string; label: string; disabled?: boolean };

export function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-left text-sm outline-none transition-all duration-200 max-sm:min-h-11",
          "hover:border-[var(--accent)]/60 focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/10",
          disabled && "opacity-50",
          open && "border-[var(--ink)] ring-1 ring-[var(--ink)]/15"
        )}
      >
        <span className={cn(!selected && "text-[var(--ink-muted)]")}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-[var(--ink-muted)] transition", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="absolute z-40 mt-1 max-h-60 w-full overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-raised)] py-1 shadow-[0_12px_40px_rgba(20,20,20,0.12)]">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.disabled}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition",
                opt.value === value
                  ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]"
                  : "text-[var(--ink)] hover:bg-[var(--surface-2)]",
                opt.disabled && "opacity-40"
              )}
            >
              {opt.label}
              {opt.value === value ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-medium text-[var(--ink)]", className)}
      {...props}
    />
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--border)]/80 bg-[color-mix(in_srgb,var(--surface-raised)_90%,white)] p-5 shadow-[0_12px_36px_rgba(20,43,53,0.045)] transition-shadow duration-300 hover:shadow-[0_16px_42px_rgba(20,43,53,0.075)]",
        className
      )}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide",
        tone === "neutral" && "bg-[var(--surface-2)] text-[var(--ink)]",
        tone === "success" && "bg-[#dcefe7] text-[var(--success)]",
        tone === "warning" && "bg-[#f3ead2] text-[var(--warning)]",
        tone === "danger" && "bg-[#f3e0e0] text-[var(--danger)]",
        tone === "info" && "bg-[var(--surface-2)] text-[var(--ink-muted)]"
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div
        className="h-full rounded-full bg-[var(--brand)] transition-all duration-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)]/70 px-6 py-12 text-center">
      <h3 className="font-[family-name:var(--font-display)] text-lg text-[var(--ink)]">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-[var(--ink-muted)]">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-9 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="max-w-3xl font-[family-name:var(--font-display)] text-4xl leading-[1.05] tracking-[-0.035em] text-[var(--ink)] sm:text-[2.65rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-[0.95rem] leading-6 text-[var(--ink-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

type ModalCtx = { close: () => void };
const ModalContext = createContext<ModalCtx | null>(null);

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const titleId = useId();
  const ctx = useMemo(() => ({ close: onClose }), [onClose]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = "hidden";

    const getFocusableElements = () => {
      const dialog = dialogRef.current;
      if (!dialog) return [];

      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0);
    };

    const focusInitialElement = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      (getFocusableElements()[0] ?? dialog).focus();
    };

    const focusFrame = window.requestAnimationFrame(focusInitialElement);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key !== "Tab") return;

      const dialog = dialogRef.current;
      const focusableElements = getFocusableElements();
      if (!dialog || focusableElements.length === 0) {
        e.preventDefault();
        dialog?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (e.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <ModalContext.Provider value={ctx}>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6">
        <button
          type="button"
          aria-label="Close dialog"
          className="absolute inset-0 bg-[rgba(20,20,20,0.45)] backdrop-blur-[2px]"
          onClick={onClose}
        />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
          className={cn(
            "relative z-10 flex max-h-[min(90vh,880px)] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[0_24px_80px_rgba(20,20,20,0.22)]",
            size === "sm" && "max-w-md",
            size === "md" && "max-w-xl",
            size === "lg" && "max-w-2xl",
            size === "xl" && "max-w-4xl"
          )}
        >
          {(title || description) && (
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                {title ? (
                  <h2
                    id={titleId}
                    className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]"
                  >
                    {title}
                  </h2>
                ) : null}
                {description ? (
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{description}</p>
                ) : null}
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </ModalContext.Provider>
  );
}

export function useModal() {
  return useContext(ModalContext);
}
