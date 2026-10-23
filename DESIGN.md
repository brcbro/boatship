---
name: Boatship
description: Regatta — a bold, legible workspace for client delivery and onboarding.
colors:
  background: "#f7f5ef"
  surface: "#fbfaf6"
  surface-raised: "#ffffff"
  surface-2: "#efece3"
  border: "#dedacd"
  border-strong: "#c9c3b1"
  ink: "#121826"
  ink-muted: "#5c6170"
  ink-faint: "#8a8f9e"
  brand: "#1e3fd6"
  brand-strong: "#1634b8"
  brand-soft: "#dce3ff"
  accent: "#ff5a1f"
  accent-strong: "#e64a12"
  accent-soft: "#ffe4d8"
  on-accent: "#16100c"
  danger: "#c8321e"
  success: "#1f8a5a"
  warning: "#b5730a"
  nav-bg: "#1e3fd6"
  dark-background: "#0f1320"
  dark-surface-raised: "#161b2c"
  dark-brand: "#6f8cff"
  dark-accent: "#ff7a4a"
  dark-nav-bg: "#0a0e1c"
typography:
  display:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "clamp(2.9rem, 6vw, 5.2rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.25
  data:
    fontFamily: "Space Mono, ui-monospace, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "20px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 16px"
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "0 16px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 16px"
  field:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: Boatship (Regatta)

## Overview

**Creative North Star: "Regatta"**

Chosen by the user on 2026-10-23 from four proposed directions and implemented the same day. A bone-white canvas with white panels, a solid cobalt navigation rail, and signal orange reserved for the single most important action on a screen. Titles are set in a wide display grotesque; working text in a plain humanist sans; amounts, IDs and dates in a monospace. The team workspace and the client portal share the same tokens and kit, so the brand reads the same from both sides.

The system has a full dark theme. It follows the device by default and can be pinned to light or dark from the account page; the choice is stored in the browser (`boatship-theme`) and applied before first paint by an inline script in `app/layout.tsx`.

**Key characteristics**
- Cobalt rail, bone canvas, white panels, thin warm-grey borders.
- Orange appears once per screen: the headline action, the active-item marker in the rail, the brand mark.
- Dense navigation, generous page rhythm, visible focus rings in orange.
- Short fades instead of staggered rises; reduced motion respected everywhere.

## Tokens

All tokens are defined once in `app/globals.css` on `:root`, then redefined for `[data-theme="dark"]` and for `prefers-color-scheme: dark` when no explicit choice is set. Components use tokens only; no page may use a Tailwind palette colour or a hex literal.

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Canvas | `--background` | #F7F5EF | #0F1320 |
| Panel | `--surface-raised` | #FFFFFF | #161B2C |
| Inset / hover | `--surface-2` | #EFECE3 | #1D2338 |
| Border | `--border` / `--border-strong` | #DEDACD / #C9C3B1 | #283049 / #38425F |
| Text | `--ink` / `--ink-muted` / `--ink-faint` | #121826 / #5C6170 / #8A8F9E | #EEF0F7 / #98A0B6 / #6B7390 |
| Brand cobalt | `--brand` / `--brand-strong` / `--brand-soft` / `--on-brand` | #1E3FD6 / #1634B8 / #DCE3FF / #FFF | #6F8CFF / #8BA2FF / #1F2B5E / #0A0E1C |
| Signal orange | `--accent` / `--accent-strong` / `--accent-soft` / `--on-accent` | #FF5A1F / #E64A12 / #FFE4D8 / #16100C | #FF7A4A / #FF9068 / #3A2316 / #16100C |
| Status | `--danger` `--success` `--warning` `--info` (+ `-soft`) | #C8321E #1F8A5A #B5730A #1E3FD6 | #FF6B5B #4CC38A #F0B454 #8BA2FF |
| Rail | `--nav-bg` `--nav-fg` `--nav-fg-strong` `--nav-active` `--nav-hover` | cobalt, #DBE2FF, white, 16% white, 9% white | #0A0E1C, #B6C0E6, white, 22% cobalt, 6% white |

Also: `--focus-ring`, `--scrim`, `--shadow-card`, `--shadow-pop`, `--radius-sm|md|lg|xl`, and `--show-light` / `--show-dark` (used by the `.show-light` / `.show-dark` helpers to swap the black and white logo files).

**The One Orange Rule.** Orange marks the single headline action on a screen (the portal's next-step card, the public hero button, the brand mark) and the active indicator in navigation. Everything else that is interactive is cobalt. Status colours stay attached to status.

**The On-Colour Rule.** Text on cobalt uses `--on-brand`, text on orange uses `--on-accent`. Never `text-white` on a brand surface: in dark mode the brand is a light blue.

## Typography

- **Display: Bricolage Grotesque** (500, 700, 800). Page titles, section titles, big figures, the portal next-step headline, the public hero. Anything set in `--font-display` is bold and tight by default (a base rule in `globals.css`).
- **Body: Figtree** (400 to 700). All working text, controls, navigation, tables.
- **Data: Space Mono** (400, 700). Keyboard hints, IDs, uppercase eyebrows, token-like values. Tables use tabular numerals.

Scale: page title 2rem (2.5rem from `sm`), section 1.125rem, card title 1.0625rem, body 0.95rem, label 0.8125rem, caption 0.75rem. Eyebrows are 0.75rem uppercase with 0.08em tracking.

## Layout

- **Team shell** (`components/admin/AdminShell.tsx`): cobalt rail on the left (15.5rem, collapsible to 4.25rem, remembered in `boatship-sidebar-collapsed`), a 3.5rem top strip with the search button, theme toggle and notifications, content centred at up to 1320px. Below `lg` the rail becomes a drawer opened from the top strip.
- **Rail content** (`components/admin/navigation.ts`): three groups, Work (Today, Approvals, Messages, Calendar, Clients, Projects), Operate (Products, Team, Workload, Analytics, Accounting) and Hodi (Assistant, Work queue), plus a Settings link at the foot. Inside any settings route the rail swaps to the settings list with a "Back to work" link. The `/settings` hub page lists every settings area as a card.
- **Client shell** (`components/client/ClientShell.tsx`): top bar with the brand mark, four primary links (Home, Tasks, Documents, Messages) and a More menu (Engagements, Forms, Approvals, Account). Below `md` the primary links move to a bottom tab bar with More as the fifth tab.
- **Portal home** opens on a full-width orange "Your next step" card, then progress, engagements, other open tasks and shortcuts.
- **Public home** (`app/page.tsx`, `app/page.module.css`): bone canvas, a hero with a miniature of the real shell, a cobalt bridge band, three numbered steps, two audience panels (cobalt for teams, white for clients), a closing card and a quiet footer. It uses the same tokens, so it follows the theme too.
- **Sign-in** is a split layout: a cobalt panel with the brand statement on large screens, the form on the right.

Side gutters are 1rem on phones and 2.5rem on desktop; form controls keep a 44px target below `sm`.

## Components (`components/shared/ui.tsx`)

- **Button** variants: `primary` (cobalt), `accent` (orange, one per screen), `secondary` (white with strong border), `ghost`, `danger`. Sizes sm/md/lg. `ButtonLink` renders a link with the same classes; `buttonClasses()` exposes them.
- **Input, Textarea, Select, Dropdown, Label, Hint**: white field, strong border, cobalt focus border with a soft cobalt ring, `aria-invalid` turns the border red.
- **Card**: white, thin border, 14px radius, quiet card shadow. **StatTile**: label, display figure, optional detail; tones neutral/brand/accent/status.
- **Badge**: pill, soft status fills; tones neutral/success/warning/danger/info/brand/accent. **ProgressBar** tones brand/accent/success. **Kbd** for shortcuts.
- **PageHeader** (optional eyebrow), **SectionHeading**, **Tabs** (link tabs with an orange underline on the current item), **EmptyState**, **Modal** (bottom sheet on phones, centred dialog from `sm`).
- **ThemeToggle** / **ThemePicker** (`components/shared/ThemeToggle.tsx`).
- **CommandPalette** opens with ⌘K / Ctrl+K or `openCommandPalette()`; it lists every rail and settings route plus search results.

## Do and don't

- **Do** take every colour from a token; both themes must stay legible.
- **Do** put the one orange action where the user's eye lands first, and nowhere else on that screen.
- **Do** keep the display face for titles and figures; body copy stays in Figtree.
- **Don't** reintroduce the former cream-and-serif look, Tailwind palette colours, or `text-white` on brand surfaces.
- **Don't** use status colours as decoration or add more than one accent-coloured control per screen.
- **Don't** bury a primary client or team action behind the More menu on phones.
