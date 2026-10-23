"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClasses({ variant = "primary", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
    size === "sm" && "min-h-8 px-3 text-[13px] max-sm:min-h-11",
    size === "md" && "min-h-10 px-4 text-sm max-sm:min-h-11",
    size === "lg" && "min-h-12 px-5 text-[15px]",
    variant === "primary" && "bg-[var(--brand)] text-[var(--on-brand)] hover:bg-[var(--brand-strong)]",
    variant === "accent" && "bg-[var(--accent)] bg-[image:var(--accent-gradient)] text-[var(--on-accent)] hover:brightness-110",
    variant === "secondary" && "border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--ink)] hover:border-[var(--ink-faint)] hover:bg-[var(--surface-2)]",
    variant === "ghost" && "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
    variant === "danger" && "bg-[var(--danger)] text-white hover:brightness-95",
    className
  );
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClasses({ variant, size, className })} {...props} />;
}

/** A link that looks like a button. */
export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  href,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link href={href} className={buttonClasses({ variant, size, className })} {...props} />;
}

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

const fieldBase =
  "w-full rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--ink)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--ink-faint)] focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-soft)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--ink-muted)] aria-[invalid=true]:border-[var(--danger)]";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "min-h-10 py-2 max-sm:min-h-11", className)} {...props} />;
}

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "py-2 leading-6", className)} {...props} />;
});

/** Native select styled to theme (kept for simple cases). Prefer Dropdown. */
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("boatship-select", fieldBase, "min-h-10 py-2 max-sm:min-h-11", className)} {...props}>
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
  ariaLabel,
  label,
  id,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  label?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "className" | "disabled">) {
  const generatedId = useId();
  const controlId = id || (label ? generatedId : undefined);
  const hasEmptyOption = options.some((option) => option.value === "");
  return (
    <>
      {label ? <Label htmlFor={controlId}>{label}</Label> : null}
      <Select
        {...props}
        id={controlId}
        aria-label={props["aria-label"] || ariaLabel || (!controlId && !props["aria-labelledby"] ? placeholder : undefined)}
        className={className}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {!hasEmptyOption && value === "" ? <option value="" disabled>{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </Select>
    </>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-[13px] font-semibold text-[var(--ink)]", className)} {...props} />;
}

export function Hint({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1.5 text-xs leading-5 text-[var(--ink-muted)]", className)} {...props} />;
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-[var(--shadow-card)]", className)} {...props} />;
}

/**
 * A compact figure with a label. Use only when the figures are the point of the screen.
 * `marker` is a small colour block that identifies the metric (chart series 1 to 4), never its state;
 * `delta` is the change line under the figure, green up or red down.
 */
export function StatTile({
  label,
  value,
  detail,
  tone = "neutral",
  marker,
  delta,
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "brand" | "accent" | "danger" | "success" | "warning";
  marker?: 1 | 2 | 3 | 4;
  delta?: { value: ReactNode; direction: "up" | "down" | "flat" };
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">{label}</p>
        {marker ? <span aria-hidden="true" className={cn("mt-0.5 h-2.5 w-2.5 shrink-0 rounded-[3px]", marker === 1 && "bg-[var(--chart-1)]", marker === 2 && "bg-[var(--chart-2)]", marker === 3 && "bg-[var(--chart-3)]", marker === 4 && "bg-[var(--chart-4)]")} /> : null}
      </div>
      <p className="mt-2 font-[family-name:var(--font-display)] text-[2rem] font-bold leading-none tracking-[-0.02em] tabular-nums text-[var(--ink)]">{value}</p>
      {delta ? (
        <p className={cn("mt-2 inline-flex items-center gap-1 text-xs font-semibold tabular-nums", delta.direction === "up" && "text-[var(--success)]", delta.direction === "down" && "text-[var(--danger)]", delta.direction === "flat" && "text-[var(--ink-muted)]")}>
          <span aria-hidden="true">{delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "→"}</span>
          {delta.value}
        </p>
      ) : null}
      {detail ? <p className="mt-2 text-xs text-[var(--ink-muted)]">{detail}</p> : null}
    </>
  );
  const classes = cn(
    "block rounded-[var(--radius-lg)] border p-4 transition-colors",
    tone === "neutral" && "border-[var(--border)] bg-[var(--surface-raised)]",
    tone === "brand" && "border-transparent bg-[var(--brand-soft)]",
    tone === "accent" && "border-transparent bg-[var(--accent)] bg-[image:var(--accent-gradient)] text-[var(--on-accent)] [&_p]:text-[var(--on-accent)] [&_p:first-child]:text-[var(--on-accent)]/80 [&_p:last-child]:text-[var(--on-accent)]/80",
    tone === "danger" && "border-transparent bg-[var(--danger-soft)]",
    tone === "success" && "border-transparent bg-[var(--success-soft)]",
    tone === "warning" && "border-transparent bg-[var(--warning-soft)]",
    href && "hover:border-[var(--border-strong)]",
    className
  );
  return href ? <Link href={href} className={classes}>{body}</Link> : <div className={classes}>{body}</div>;
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "brand" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5 tracking-[0.01em] before:h-1.5 before:w-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']",
        tone === "neutral" && "bg-[var(--surface-2)] text-[var(--ink-muted)]",
        tone === "success" && "bg-[var(--success-soft)] text-[var(--success)]",
        tone === "warning" && "bg-[var(--warning-soft)] text-[var(--warning)]",
        tone === "danger" && "bg-[var(--danger-soft)] text-[var(--danger)]",
        tone === "info" && "bg-[var(--info-soft)] text-[var(--info)]",
        tone === "brand" && "bg-[var(--brand-soft)] text-[var(--brand)]",
        tone === "accent" && "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
        className
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, label = "Progress", tone = "brand" }: { value: number; label?: string; tone?: "brand" | "accent" | "success" }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped} className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", tone === "brand" && "bg-[var(--brand)]", tone === "accent" && "bg-[var(--accent)] bg-[image:var(--accent-gradient)]", tone === "success" && "bg-[var(--success)]")}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-2)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--ink-muted)]">{children}</kbd>;
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-12 text-center">
      <h3 className="font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.01em] text-[var(--ink)]">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--ink-muted)]">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">{eyebrow}</div> : null}
        <h1 className="max-w-3xl font-[family-name:var(--font-display)] text-[2rem] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--ink)] sm:text-[2.25rem]">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[0.95rem] leading-6 text-[var(--ink-muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionHeading({ title, action, id, className }: { title: ReactNode; action?: ReactNode; id?: string; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-3", className)}>
      <h2 id={id} className="font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.01em] text-[var(--ink)]">{title}</h2>
      {action}
    </div>
  );
}

export type TabItem = { href: string; label: string; count?: number; exact?: boolean };

/** Horizontal link tabs. `underline` marks the current one with a rule; `pills` sets it as a filled pill on a track (record pages). */
export function Tabs({ items, pathname, ariaLabel, variant = "underline" }: { items: TabItem[]; pathname: string; ariaLabel: string; variant?: "underline" | "pills" }) {
  const pills = variant === "pills";
  return (
    <nav aria-label={ariaLabel} className={cn("overflow-x-auto", pills ? "pb-3" : "-mx-1")}>
      <ul className={cn("flex min-w-max", pills ? "gap-1 rounded-full bg-[var(--surface-2)] p-1" : "gap-1 border-b border-[var(--border)] px-1")}>
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={false}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 text-sm font-semibold transition-colors",
                  pills
                    ? cn("min-h-9 rounded-full px-3.5", active ? "bg-[var(--brand)] text-[var(--on-brand)]" : "text-[var(--ink-muted)] hover:bg-[var(--brand-soft)] hover:text-[var(--ink)]")
                    : cn("-mb-px min-h-11 border-b-2 px-3", active ? "border-[var(--accent)] text-[var(--ink)]" : "border-transparent text-[var(--ink-muted)] hover:border-[var(--border-strong)] hover:text-[var(--ink)]")
                )}
              >
                {item.label}
                {typeof item.count === "number" ? <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", pills && active ? "bg-[var(--on-brand)]/15 text-[var(--on-brand)]" : "bg-[var(--surface-raised)] text-[var(--ink-muted)]")}>{item.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Sticky header for a record page (client, product). Stays visible while the
 * tabs below scroll. `meta` are short label/value pairs: owner, next milestone.
 */
export function RecordHeader({
  back,
  eyebrow,
  title,
  subtitle,
  badges,
  meta,
  actions,
  children,
}: {
  back?: { href: string; label: string };
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  meta?: Array<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
  /** Usually the Tabs for the record. */
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        // Sticky inside the page's padded wrapper: the ::before strip covers the
        // wrapper's top padding once the header is stuck, so nothing scrolls past above it.
        "sticky top-14 z-30 -mx-4 mb-6 bg-[var(--surface)]/92 px-4 backdrop-blur-xl before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-[var(--surface)] before:content-[''] sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-10 lg:px-10 lg:before:-top-8 lg:before:h-8",
        !children && "border-b border-[var(--border)]"
      )}
    >
      {back ? (
        <Link href={back.href} prefetch={false} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--brand)] hover:underline">
          ← {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-3 pb-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">{eyebrow}</div> : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 truncate font-[family-name:var(--font-display)] text-[1.5rem] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--ink)] sm:text-[1.9rem]">{title}</h1>
            {badges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}
          </div>
          {subtitle ? <p className="mt-1 truncate text-sm text-[var(--ink-muted)]">{subtitle}</p> : null}
          {meta?.length ? (
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
              {meta.map((item) => (
                <div key={item.label} className="flex min-w-0 items-baseline gap-1.5">
                  <dt className="shrink-0 text-[var(--ink-muted)]">{item.label}</dt>
                  <dd className="min-w-0 truncate font-semibold text-[var(--ink)]">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2 lg:shrink-0">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

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
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";

    const getFocusableElements = () => {
      const dialog = dialogRef.current;
      if (!dialog) return [];
      return Array.from(
        dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ).filter((element) => element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0);
    };

    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      (getFocusableElements()[0] ?? dialog).focus();
    });

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
      <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
        <button type="button" aria-label="Close dialog" className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px]" onClick={onClose} />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
          className={cn(
            "relative z-10 flex max-h-[min(92dvh,880px)] w-full flex-col overflow-hidden rounded-t-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-pop)] sm:rounded-[var(--radius-xl)]",
            size === "sm" && "sm:max-w-md",
            size === "md" && "sm:max-w-xl",
            size === "lg" && "sm:max-w-2xl",
            size === "xl" && "sm:max-w-4xl"
          )}
        >
          {(title || description) && (
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                {title ? <h2 id={titleId} className="font-[family-name:var(--font-display)] text-xl font-bold tracking-[-0.01em] text-[var(--ink)]">{title}</h2> : null}
                {description ? <p className="mt-1 text-sm text-[var(--ink-muted)]">{description}</p> : null}
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3">{footer}</div> : null}
        </div>
      </div>
    </ModalContext.Provider>
  );
}

export function useModal() {
  return useContext(ModalContext);
}
