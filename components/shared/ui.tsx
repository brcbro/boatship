"use client";

import {
  createContext,
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
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" && "px-3 py-1.5 text-sm",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-5 py-2.5 text-base",
        variant === "primary" &&
          "bg-[var(--brand)] text-[var(--surface-raised)] hover:bg-[var(--brand-strong)]",
        variant === "secondary" &&
          "border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--ink)] hover:bg-[var(--surface-2)]",
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
        "w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-muted)]/70 focus:border-[var(--ink)] focus:ring-1 focus:ring-[var(--ink)]/15",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-muted)]/70 focus:border-[var(--ink)] focus:ring-1 focus:ring-[var(--ink)]/15",
        className
      )}
      {...props}
    />
  );
}

/** Native select styled to theme (kept for simple cases). Prefer Dropdown. */
export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "boatship-select w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--ink)] focus:ring-1 focus:ring-[var(--ink)]/15",
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
          "flex w-full items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-left text-sm outline-none transition",
          "hover:border-[var(--ink)]/40 focus:border-[var(--ink)] focus:ring-1 focus:ring-[var(--ink)]/15",
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
        "rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[0_1px_0_rgba(20,20,20,0.04)]",
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
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium tracking-wide",
        tone === "neutral" && "bg-[var(--surface-2)] text-[var(--ink)]",
        tone === "success" && "bg-[#e4efe6] text-[var(--success)]",
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
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-[var(--ink)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{description}</p>
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

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

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
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
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
