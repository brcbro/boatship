# Plan: "Monivo" dark theme for Boatship

Reference: the Behance concept *AI Finance Dashboard — Smarter Money Management Design* (Monivo). This plan takes its **theme only**: colours, gradient, glow, surfaces, type weight and the rail treatment. Layout, data, routes and flows stay as they are. The screen inventory for any later layout work is in [stitch-layout-brief.md](stitch-layout-brief.md).

Status: **plan only, nothing implemented.** Each step says which files change and how to check it.

---

## 1. What the reference looks like (sampled from the images)

- Near-black canvas with graphite cards; cards are separated by a 1px hairline and a faint lift, not by shadow.
- White headings, light-grey body, dim grey labels. One weight step between heading and body, no coloured headings.
- One warm accent, used as an orange-to-red **gradient** on the headline button and the health gauge, with a soft warm **glow** bleeding into the page from the top-right corner.
- No blue anywhere in the chrome. Links, selected states and ordinary primary buttons are white on graphite.
- Figures carry a small colour-coded marker (blue, purple, orange, red) that identifies the metric, not its state.
- Positive deltas green, negative red, with a tiny arrow glyph. Status pills are a dot plus text on a translucent fill.
- Pill-shaped filter tabs with a white active pill; icon-only left rail with a round brand mark; search as a dim field on the right.
- Dark only. Rounded corners around 12 to 16px; dense tables with generous row height.

## 2. Decisions to make before starting

| Decision | Recommendation | Why |
| --- | --- | --- |
| Keep a light theme? | **Keep it, derive a graphite-on-white twin.** Make dark the default. | The toggle, the account picker and the pre-paint script already exist; a dark-only app would need the client portal to be dark too, which clients did not ask for. |
| What happens to cobalt? | **Retire it from chrome.** `--brand` becomes white-on-graphite. Blue survives only as one of the four metric markers. | Monivo's signature is the absence of a second hue. |
| Gradient everywhere? | **No.** Only the `accent` button, the one headline card per screen, the gauge-style figures and the rail's active marker. | The one-orange rule already exists; the gradient is just its new rendering. |
| Glow? | **Yes, once per shell**, behind the content, fixed, non-interactive. Off when `prefers-reduced-transparency` or on phones. | Cheap to do, carries most of the feel. |
| Fonts? | **Keep Bricolage / Figtree / Space Mono**, drop the display face to 700 weight and tighten tracking slightly. | Monivo uses a plain grotesque; changing families touches every page's rhythm for little gain. |

## 3. Token sheet

All values go in `app/globals.css`. Names that exist already keep their names, so no page changes for the swap. New names are marked **new**.

### 3.1 Dark (becomes the default)

| Token | Value | Notes |
| --- | --- | --- |
| `--background` | `#0B0B0D` | canvas |
| `--surface` | `#0F0F12` | shell interior, page behind cards |
| `--surface-raised` | `#141416` | card |
| `--surface-2` | `#1B1B1F` | inset, hover, code blocks |
| `--surface-muted` | `#18181C` | |
| `--border` | `#232326` | hairline |
| `--border-strong` | `#2E2E33` | inputs, selected card |
| `--ink` | `#F5F5F7` | |
| `--ink-muted` | `#9A9AA3` | |
| `--ink-faint` | `#5E5E66` | |
| `--brand` | `#F5F5F7` | links, standard primary buttons, selected tabs |
| `--brand-strong` | `#FFFFFF` | hover |
| `--brand-soft` | `rgba(255,255,255,0.08)` | selected row, chip fill |
| `--on-brand` | `#0B0B0D` | text on a white button |
| `--accent` | `#FF6A2B` | solid fallback |
| `--accent-strong` | `#E8431F` | |
| `--accent-soft` | `rgba(255,106,43,0.14)` | |
| `--on-accent` | `#FFFFFF` | Monivo puts white on the gradient |
| `--accent-gradient` **new** | `linear-gradient(135deg, #FF6A2B 0%, #E8431F 100%)` | |
| `--glow` **new** | `radial-gradient(55% 45% at 100% 0%, rgba(255,106,43,0.22), transparent 70%)` | |
| `--danger` / `--danger-soft` | `#FF4D4D` / `rgba(255,77,77,0.14)` | |
| `--success` / `--success-soft` | `#34C759` / `rgba(52,199,89,0.14)` | |
| `--warning` / `--warning-soft` | `#FFB020` / `rgba(255,176,32,0.14)` | |
| `--info` / `--info-soft` | `#8A8A94` / `rgba(255,255,255,0.08)` | info is neutral now; blue is not a status |
| `--chart-1..4` **new** | `#3B6CFF`, `#8B5CF6`, `#FF7A2B`, `#F04438` | metric markers and chart series |
| `--nav-bg` / `--nav-bg-deep` | `#141416` / `#0F0F12` | rail matches cards |
| `--nav-fg` / `--nav-fg-strong` | `#8A8A94` / `#F5F5F7` | |
| `--nav-active` / `--nav-hover` | `rgba(255,255,255,0.10)` / `rgba(255,255,255,0.05)` | |
| `--nav-border` | `#232326` | |
| `--focus-ring` | `#FF6A2B` | unchanged role |
| `--scrim` | `rgba(0,0,0,0.6)` | |
| `--shadow-card` | `0 0 0 1px rgba(255,255,255,0.03) inset` | lift instead of drop shadow |
| `--shadow-pop` | `0 24px 64px -24px rgba(0,0,0,0.9)` | menus, drawer |
| `--radius-md` / `--radius-lg` / `--radius-xl` | `10px` / `14px` / `18px` | unchanged; Monivo sits here |

### 3.2 Light (graphite-on-white twin)

Same structure, inverted: canvas `#F4F4F5`, surface `#FAFAFB`, card `#FFFFFF`, inset `#EFEFF1`, border `#E4E4E7` / `#D4D4D8`, ink `#0B0B0D` / `#5F5F66` / `#9A9AA3`, brand `#0B0B0D` (black buttons and links), brand-soft `rgba(0,0,0,0.06)`, on-brand `#FFFFFF`, accent and gradient unchanged, glow at `0.12` alpha, nav `#FFFFFF` with `#E4E4E7` border and `#5F5F66` / `#0B0B0D` text, status colours one step darker (`#D92D20`, `#1F9D55`, `#B7791F`).

### 3.3 Removed

`--info` stops being blue. Nothing else is removed; the Tailwind utility classes that reference tokens keep working.

## 4. Steps

Each step is one commit. Run `npm run typecheck && npm run lint && npm test` after every step; the browser check is listed per step.

### Step 1: tokens and default theme (`app/globals.css`, `app/layout.tsx`, `components/shared/ThemeToggle.tsx`)

- Replace the `:root` block with the light sheet (3.2) and the `[data-theme="dark"]` block plus the `prefers-color-scheme: dark` block with the dark sheet (3.1). Add `--accent-gradient`, `--glow`, `--chart-1..4` to both.
- Make dark the default: in `layout.tsx` the pre-paint script sets `data-theme="dark"` when nothing is stored, and `readTheme()` in `ThemeToggle.tsx` returns `"dark"` as the fallback instead of `"system"`. The picker keeps System / Light / Dark.
- Display face: in `globals.css` the base rule for `--font-display` goes from 800 to 700 and tracking from `-0.03em` to `-0.02em`.
- **Check:** open `/dashboard`, `/clients/[id]`, `/portal` in both themes; nothing should be blue except metric markers (none yet).

### Step 2: gradient accent and glow (`components/shared/ui.tsx`, `components/admin/AdminShell.tsx`, `components/client/ClientShell.tsx`)

- `buttonClasses` `accent` variant: `bg-[image:var(--accent-gradient)] text-[var(--on-accent)]` with a `hover:brightness-110`, no shadow.
- `ProgressBar` `accent` tone and `StatTile` `accent` tone use the gradient.
- Both shells: add a `pointer-events-none fixed inset-0 -z-10 bg-[image:var(--glow)]` layer inside the scroll container (staff: on `<main>`; client: on the page wrapper) wrapped in `motion-safe` and hidden below `md`.
- **Check:** portal home next-step card, public hero button, dashboard "New client" are the only gradient items; glow visible top-right, not over the rail.

### Step 3: rail and top strip (`components/admin/AdminShell.tsx`, `components/admin/navigation.ts`)

- Default `collapsed` to `true` when `localStorage` has no value; keep the toggle.
- Brand mark in the collapsed rail: a 36px round tile with the logomark instead of the wordmark; the wordmark stays in the expanded rail and the mobile strip.
- Active item: drop the orange left bar; use `--nav-active` fill with `--nav-fg-strong` text and the icon at stroke 2.25. The orange returns only as a 6px dot on the Inbox item when it has unread rows (count comes from the existing Inbox fetch; wire later, not in this step).
- Top strip: search field becomes a dim `--surface-2` field with no border, right-aligned, placeholder only; Hodi button becomes a small gradient pill (this is the shell's one accent, so the page below must not add a second: the dashboard's "New client" moves to `secondary` on staff pages where the Hodi pill is visible, or the Hodi pill stays neutral and the page keeps its accent. **Pick one: recommend the Hodi pill stays neutral** and pages keep their single accent).
- **Check:** rail at 4.25rem by default, expands and remembers; keyboard focus visible on rail items.

### Step 4: tabs, chips, badges, tables (`components/shared/ui.tsx`, `app/(admin)/tasks/page.tsx`)

- `Tabs` gains `variant="pills"`: a `--surface-2` track with the active item as a `--brand` (white) pill and `--on-brand` text; `RecordHeader` passes `pills`. The underline variant remains for anything else.
- Inbox filter chips: active chip becomes the white pill, counts in `--brand-soft`.
- `Badge`: add a leading dot (`before:` 6px circle in the tone colour) and move fills to the `-soft` tokens at 14% alpha so pills read as translucent on graphite.
- Table headers (`clients`, `vessels`, `accounting`, `team`): `text-[11px] uppercase tracking-[0.08em] text-[var(--ink-faint)]`, row height 52px, hairline dividers, hover `--surface-2`.
- **Check:** Inbox, client record tabs, Clients list, Accounting.

### Step 5: figures and charts (`components/shared/ui.tsx`, dashboard, analytics, product overview)

- `StatTile` gains `marker?: 1 | 2 | 3 | 4` drawing a 10×10 rounded square top-right in `--chart-n`, and `delta?: { value: string; direction: "up" | "down" }` rendering the green or red arrow line under the figure.
- Dashboard: five tiles get markers 1 to 4 (cycle) and deltas where the API already returns a previous value (overdue tasks does; the rest are static counts, so no delta).
- Analytics and `/products/[id]` Overview tiles the same. Chart series colours move from whatever they use now to `--chart-1..4`.
- **Check:** dashboard and analytics in both themes; markers must not be mistaken for status.

### Step 6: cards, inputs, modals, drawer polish (`components/shared/ui.tsx`, `components/admin/HodiDrawer.tsx`, `components/hodi/HodiChat.tsx`)

- `Card`: remove the drop shadow, keep the hairline, add the inset lift from `--shadow-card`.
- Inputs: `--surface-2` fill, no border at rest, `--border-strong` on hover, focus ring in `--accent-soft`.
- Modal and drawer: `--surface-raised` panel, `--shadow-pop`, 18px radius.
- Hodi chat: user bubbles `--surface-2` with white text (not brand blue); assistant text unchanged; the "Approve and create" button on proposals is the chat's single accent.
- **Check:** Hodi drawer on a client record, form review modal, clone/pause modals.

### Step 7: page sweep

Scripted grep for anything that assumed cobalt-on-white, then a browser pass over all 40 staff and portal pages in both themes:

```bash
grep -rn "var(--brand)" app components --include=*.tsx | grep -v "ui.tsx" | wc -l
```

Today that is 137 uses across the pages. Expect links to now render white; where a page used brand as a *background* for a tinted panel (portal next-step card, messages client avatar, Hodi bot mark), switch those to `--accent-gradient` only if it is the page's headline, otherwise `--surface-2`. Record exceptions in `DESIGN.md`.

### Step 8: docs and record

- `DESIGN.md`: replace the token table, the One Orange rule text (now the gradient), the rail description and the component notes.
- `architecture/ui-redesign.md`: add a "Monivo theme" section with what changed and what was kept; `architecture/status.md`: one dated line.

## 5. Verification checklist

- [ ] `npm run typecheck`, `npm run lint`, `npm test` green after every step.
- [ ] No Tailwind palette colours or hex literals outside `globals.css` (`grep -rn "#[0-9a-fA-F]\{6\}" app components --include=*.tsx` returns nothing new).
- [ ] Contrast: `--ink-muted` on `--surface-raised` at least 4.5:1 in both themes (`#9A9AA3` on `#141416` is 6.1:1; `#5F5F66` on `#FFFFFF` is 6.8:1).
- [ ] Exactly one gradient element per screen in both shells.
- [ ] Focus rings visible on graphite and on the gradient button.
- [ ] Reduced motion: no glow animation (there is none), fades only.
- [ ] Local QA fixture pass: dashboard, Inbox, client record (all tabs), product record, Hodi drawer, portal home, tasks, forms, documents, sign-in, public home; light and dark; desktop and phone width.
- [ ] Deploy with `npm run build:cloudflare` then `wrangler deploy --config wrangler.production.toml`; smoke `/api/health`, `/login`, `/tasks`.

## 6. Risks and how to handle them

- **Blue links lose affordance when they become white.** Keep underline-on-hover on all text links and add a 1px `--border-strong` underline offset for links inside paragraphs. Check the client portal in particular, where clients are less familiar with the app.
- **Graphite cards on a near-black canvas can flatten.** The inset lift plus the hairline is the fix; if sections still blur together, raise `--surface-raised` to `#17171A`, not the border.
- **The Hodi pill vs. the page accent** (Step 3): decide before starting Step 3 so the sweep in Step 7 has one rule.
- **The public home page** uses the cobalt band and audience panels heavily. Its stylesheet (`app/page.module.css`) already reads tokens only, so the swap recolours it automatically; the risk is that the cobalt band and the "for teams" panel become white-on-graphite blocks that lose their contrast with the canvas. Budget half a day to re-balance those two sections.
- **Client portal expectations.** Dark by default for clients is a product decision; if unsure, default staff to dark and clients to light (the pre-paint script can read the path prefix).

## 7. Effort

| Step | Size |
| --- | --- |
| 1 Tokens and default | 1 to 2 hours |
| 2 Gradient and glow | 1 hour |
| 3 Rail and strip | 2 hours |
| 4 Tabs, chips, badges, tables | 2 hours |
| 5 Figures and charts | 2 hours |
| 6 Cards, inputs, modals, drawer | 2 hours |
| 7 Page sweep | 3 to 4 hours |
| 8 Docs | 1 hour |

About two working days including the browser passes and a deploy.
