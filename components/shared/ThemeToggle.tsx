"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThemeChoice = "system" | "light" | "dark";
const STORAGE_KEY = "boatship-theme";
const CHANGE_EVENT = "boatship:theme";

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* storage unavailable; the attribute still applies for this page */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribe, readTheme, () => "system");
}

const ORDER: ThemeChoice[] = ["system", "light", "dark"];
const LABEL: Record<ThemeChoice, string> = { system: "Theme: follows your device", light: "Theme: light", dark: "Theme: dark" };

/** Cycles system → light → dark. `tone="nav"` draws it for the cobalt rail. */
export function ThemeToggle({ className, tone = "surface" }: { className?: string; tone?: "surface" | "nav" }) {
  const choice = useTheme();
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : MonitorSmartphone;
  return (
    <button
      type="button"
      aria-label={LABEL[choice]}
      title={LABEL[choice]}
      onClick={() => applyTheme(ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length])}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] transition-colors",
        tone === "nav" ? "text-[var(--nav-fg)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-fg-strong)]" : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
        className
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/** Segmented control for the account settings page. */
export function ThemePicker() {
  const choice = useTheme();
  return (
    <div role="radiogroup" aria-label="Appearance" className="inline-flex rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-1">
      {ORDER.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={choice === option}
          onClick={() => applyTheme(option)}
          className={cn(
            "min-h-9 rounded-[8px] px-3 text-sm font-medium capitalize transition-colors",
            choice === option ? "bg-[var(--surface-raised)] text-[var(--ink)] shadow-[var(--shadow-card)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
