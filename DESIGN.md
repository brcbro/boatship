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

# Design System: Boatship (Monivo)

## Overview

**Creative North Star: "Monivo"**

Adopted on 2026-10-23, replacing the Regatta palette after the user chose a near-black finance-dashboard reference (the Behance concept of the same name). A near-black canvas with graphite panels separated by hairlines, white for everything interactive, and one warm orange-to-red gradient for the single headline action on a screen, with a soft warm glow from the top-right corner. Titles are set in a display grotesque at bold weight; working text in a plain humanist sans; amounts, IDs and dates in a monospace. The team workspace and the client portal share the same tokens and kit.

Dark is the default. A graphite-on-white light twin keeps the same structure; the choice (dark, light, or follow the device) is made from the toggle in either shell or the account page, stored in the browser (`boatship-theme`) and applied before first paint by an inline script in `app/layout.tsx`. The Regatta layout work (shells, record pages, Inbox, Hodi drawer) is unchanged; only the values and a few component treatments moved.

**Key characteristics**
- Near-black canvas, graphite panels, hairline borders, an inset lift instead of drop shadows.
- No second hue in the chrome: links, primary buttons, selected pills and the rail's active item are white on graphite (black on white in the light twin).
- The gradient appears once per screen: the headline action or card, and the round brand mark.
- Metric markers (blue, purple, orange, red) identify a figure or chart series; they never mean status.
- Icon-only rail by default, pill tabs on record pages, dot-plus-text status badges, dim borderless fields.
- Short fades instead of staggered rises; reduced motion respected everywhere.

## Tokens

All tokens are defined once in `app/globals.css` on `:root`, then redefined for `[data-theme="dark"]` and for `prefers-color-scheme: dark` when no explicit choice is set. Components use tokens only; no page may use a Tailwind palette colour or a hex literal.

| Role | Token | Dark (default) | Light |
| --- | --- | --- | --- |
| Canvas | `--background` | #0B0B0D | #F4F4F5 |
| Panel | `--surface-raised` | #141416 | #FFFFFF |
| Inset / hover / fields | `--surface-2` | #1B1B1F | #EFEFF1 |
| Border | `--border` / `--border-strong` | #232326 / #2E2E33 | #E4E4E7 / #D4D4D8 |
| Text | `--ink` / `--ink-muted` / `--ink-faint` | #F5F5F7 / #9A9AA3 / #5E5E66 | #0B0B0D / #5F5F66 / #9A9AA3 |
| Brand (interactive) | `--brand` / `--brand-strong` / `--brand-soft` / `--on-brand` | #F5F5F7 / #FFF / 8% white / #0B0B0D | #0B0B0D / #000 / 6% black / #FFF |
| Accent | `--accent` / `--accent-strong` / `--accent-soft` / `--on-accent` | #FF6A2B / #E8431F / 14% / #FFF | same |
| Accent gradient | `--accent-gradient` | linear 135°, #FF6A2B to #E8431F | same |
| Glow | `--glow` | radial from the top-right, 22% accent | 12% accent |
| Status | `--danger` `--success` `--warning` `--info` (+ `-soft` at 12 to 14%) | #FF4D4D #34C759 #FFB020 #8A8A94 | #D92D20 #1F9D55 #B7791F #5F5F66 |
| Metric markers | `--chart-1..4` | #3B6CFF #8B5CF6 #FF7A2B #F04438 | same |
| Rail | `--nav-bg` `--nav-fg` `--nav-fg-strong` `--nav-active` `--nav-hover` `--nav-border` | #141416, #8A8A94, white, 10% white, 5% white, #232326 | white, #5F5F66, black, 7% black, 4% black, #E4E4E7 |

Also: `--focus-ring`, `--scrim`, `--shadow-card`, `--shadow-pop`, `--radius-sm|md|lg|xl`, and `--show-light` / `--show-dark` (used by the `.show-light` / `.show-dark` helpers to swap the black and white logo files).

**The One Gradient Rule.** The accent gradient marks the single headline action on a screen (the portal's next-step card, the public hero button, an `accent` Button) plus the round brand mark. Everything else that is interactive is `--brand`, which is white on graphite and black on white. Status colours stay attached to status; the four metric markers are identity only.

**The On-Colour Rule.** Text on a brand surface uses `--on-brand`, text on the gradient uses `--on-accent`. Never `text-white` or a Tailwind palette colour anywhere: in dark mode the brand surface is white, so `text-white` on it vanishes.

## Typography

- **Display: Bricolage Grotesque** (500, 700, 800). Page titles, section titles, big figures, the portal next-step headline, the public hero. Anything set in `--font-display` is bold and tight by default (a base rule in `globals.css`).
- **Body: Figtree** (400 to 700). All working text, controls, navigation, tables.
- **Data: Space Mono** (400, 700). Keyboard hints, IDs, uppercase eyebrows, token-like values. Tables use tabular numerals.

Scale: page title 2rem (2.5rem from `sm`), section 1.125rem, card title 1.0625rem, body 0.95rem, label 0.8125rem, caption 0.75rem. Eyebrows are 0.75rem uppercase with 0.08em tracking.

## Layout

- **Team shell** (`components/admin/AdminShell.tsx`): graphite rail on the left with a hairline edge, icon-only at 4.25rem by default and expandable to 15.5rem (remembered in `boatship-sidebar-collapsed`), a round gradient brand tile at the top when collapsed and the theme-aware wordmark when expanded; a 3.5rem top strip with a dim borderless search field, a Hodi button, theme toggle and notifications; content centred at up to 1320px over the shell's single glow. Below `lg` the rail becomes a drawer opened from the top strip.
- **Hodi drawer** (`components/admin/HodiDrawer.tsx`): the Hodi button opens the chat (`components/hodi/HodiChat.tsx`, `variant="drawer"`) in a right-hand panel, 28rem wide beside the page from `xl` and a scrimmed overlay below it. On a client record, product record or the Inbox it shows a cobalt context chip naming the record; the full workspace at `/agent` is the same component in `variant="page"`.
- **Record pages** (`RecordHeader`): a sticky header with back link, title, status badges, owner and next milestone, actions on the right, and the record's `Tabs` along its bottom edge. The open tab is `?tab=` in the URL. Client records: Overview, Engagements, Tasks, Forms, Documents, Messages, Billing, Vessels. Product records: Overview, Roadmap, Work, Releases, Settings.
- **Inbox** (`/tasks`): one list of everything waiting on a person, newest first, with filter chips by type (Everything, Approvals, Form submissions, Messages) and a highlighted row moved with `j`/`k` or the arrow keys; Enter reviews an approval in place or opens the row, `o` opens it. The highlight is the one orange mark on the screen.
- **Rail content** (`components/admin/navigation.ts`): three groups, Work (Today, Inbox, Messages, Calendar, Clients, Projects), Operate (Products, Team, Workload, Analytics, Accounting) and Hodi (Assistant, Work queue), plus a Settings link at the foot. Inside any settings route the rail swaps to the settings list with a "Back to work" link. The `/settings` hub page lists every settings area as a card.
- **Client shell** (`components/client/ClientShell.tsx`): top bar with the brand mark, four primary links (Home, Tasks, Documents, Messages) and a More menu (Engagements, Forms, Approvals, Account). Below `md` the primary links move to a bottom tab bar with More as the fifth tab.
- **Portal home** opens on a full-width orange "Your next step" card, then progress, engagements, other open tasks and shortcuts.
- **Public home** (`app/page.tsx`, `app/page.module.css`): bone canvas, a hero with a miniature of the real shell, a cobalt bridge band, three numbered steps, two audience panels (cobalt for teams, white for clients), a closing card and a quiet footer. It uses the same tokens, so it follows the theme too.
- **Sign-in** is a split layout: a cobalt panel with the brand statement on large screens, the form on the right.

Side gutters are 1rem on phones and 2.5rem on desktop; form controls keep a 44px target below `sm`.

## Components (`components/shared/ui.tsx`)

- **Button** variants: `primary` (brand: white on graphite, black on white), `accent` (the gradient, one per screen), `secondary` (outline, transparent fill), `ghost`, `danger`. Sizes sm/md/lg. `ButtonLink` renders a link with the same classes; `buttonClasses()` exposes them.
- **Input, Textarea, Select, Dropdown, Label, Hint**: dim well (`--surface-2`) with no border at rest, a hairline on hover, a raised fill and soft accent ring on focus, `aria-invalid` turns the border red.
- **Card**: graphite (white in light), hairline border, 14px radius, inset lift instead of a drop shadow. **StatTile**: label, display figure, optional detail, an optional `marker` (chart 1 to 4) top-right and a `delta` line (green up, red down); tones neutral/brand/accent/status, where `accent` is the gradient.
- **Badge**: pill with a leading dot in the tone colour on a translucent fill; tones neutral/success/warning/danger/info/brand/accent. **ProgressBar** tones brand/accent/success. **Kbd** for shortcuts.
- **PageHeader** (optional eyebrow), **RecordHeader** (sticky record header that hosts Tabs), **SectionHeading**, **Tabs** (`underline` marks the current item with an accent rule; `pills` sets it as a filled brand pill on a `--surface-2` track, used by record pages; links may carry `?tab=` and navigate without scrolling), **EmptyState**, **Modal** (bottom sheet on phones, centred dialog from `sm`).
- **ThemeToggle** / **ThemePicker** (`components/shared/ThemeToggle.tsx`).
- **CommandPalette** opens with ⌘K / Ctrl+K or `openCommandPalette()`; it lists every rail and settings route plus search results.

## Do and don't

- **Do** take every colour from a token; both themes must stay legible.
- **Do** put the one gradient action where the user's eye lands first, and nowhere else on that screen; the round brand mark is the only other warm element.
- **Do** keep the display face for titles and figures; body copy stays in Figtree.
- **Don't** reintroduce cobalt or the bone canvas, Tailwind palette colours, drop shadows on cards, or `text-white` on brand surfaces.
- **Don't** use status colours or metric markers as decoration, or add more than one gradient control per screen.
- **Don't** bury a primary client or team action behind the More menu on phones.
