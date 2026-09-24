---
name: Boatship
description: A warm, legible workspace for client delivery and onboarding.
colors:
  primary: "#141414"
  primary-strong: "#000000"
  background: "#f3ebe0"
  surface: "#faf6f0"
  surface-raised: "#fffdf9"
  surface-muted: "#ebe2d6"
  ink-muted: "#6b635a"
  border: "#d9cfc3"
  editorial-accent: "#9b5b35"
  danger: "#8b1e1e"
  success: "#1f4d2e"
  warning: "#7a5a12"
typography:
  display:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "clamp(4rem, 6.4vw, 6rem)"
    fontWeight: 500
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "2.65rem"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  body:
    fontFamily: "DM Sans, Arial, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.25
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  card: "16px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface-raised}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  field:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.primary}"
    rounded: "{rounded.card}"
    padding: "20px"
---

# Design System: Boatship

## Overview

**Creative North Star: "The Shared Work Ledger"**

This is a description of the design now implemented, not a user-approved brand direction. Warm paper surfaces and dark, precise controls make client work feel calm and accountable. Editorial serif headings give the public site character; compact sans serif text keeps working screens quick to scan. Staff and client interfaces deserve equal care and equally clear routes to the next action.

**Key Characteristics:**
- Warm cream canvas with quiet raised surfaces.
- Ink-first hierarchy with a restrained brown accent on the public site.
- Dense work navigation, generous content rhythm, and visible keyboard focus.

## Colors

The primary accent is ink; the editorial brown is used sparingly on the public site. Semantic colors are reserved for status and feedback.

### Primary
- **Work Ink** (`colors.primary`): primary buttons, key text, progress, and dark navigation.
- **Deep Ink** (`colors.primary-strong`): stronger hover state for primary actions.

### Secondary
- **Editorial Brown** (`colors.editorial-accent`): public-page emphasis and focused links, not routine dashboard actions.

### Neutral
- **Warm Paper** (`colors.background`): page canvas.
- **Quiet Paper** (`colors.surface`): inset and empty-state areas.
- **Raised Paper** (`colors.surface-raised`): cards, inputs, and portal navigation.
- **Muted Paper** (`colors.surface-muted`): secondary controls and selected navigation.
- **Muted Ink** (`colors.ink-muted`): supporting text.
- **Soft Rule** (`colors.border`): field and card outlines.

**The One Accent Rule.** Keep status colors attached to actual status; use ink for ordinary actions.

## Typography

**Display Font:** Source Serif 4 (Georgia fallback). **Body Font:** DM Sans (Arial fallback).

Serif type signals hierarchy and editorial character. Sans serif type carries instructions, controls, tables, and dense navigation. The public hero uses `typography.display`; app page titles use `typography.headline`. Working copy and control labels use `typography.body` and `typography.label`.

**The Readable Work Rule.** Keep labels and supporting text legible at the working size; reserve very large serif type for major headings.

## Layout

The public page uses a centered wide container (up to 1400px), a two-column hero, and paired audience panels that stack on narrow screens. The portal content uses a centered container (up to 1280px). Team navigation sits in a dark sidebar on large screens and becomes a drawer on small screens; client navigation uses a top bar and a bottom bar below the desktop breakpoint. Shared form controls provide at least a 44px target on small screens. The reusable spacing rhythm is recorded in frontmatter; use larger section gaps on the public page than in working screens.

**The Equal Route Rule.** Give team and client users equally visible access to their next useful action, even though their navigation structures differ.

## Elevation & Depth

Most depth comes from warm surface contrast and borders. Cards use a quiet ambient shadow; primary buttons gain a slightly stronger shadow and small lift on hover. The public hero illustration uses a larger shadow as a single focal object. Keep shadows subordinate to information hierarchy.

**The Quiet Surface Rule.** Default working surfaces should read clearly through tone and border before shadow.

## Shapes

Inputs, controls, and navigation use gently rounded corners (`rounded.md`). Cards have more generous corners (`rounded.card`). Badges use compact corners (`rounded.sm`). Thin borders separate content without a heavy boxed appearance.

## Components

### Buttons

The primary button is ink on light text, medium rounded, and used for the main action. Secondary buttons are raised paper with a soft border. Ghost buttons sit directly on the current surface. Hover provides a slight lift or tonal change; keyboard focus uses a clearly visible outline.

### Cards and badges

Cards use raised paper, a soft border, ambient depth, and about 20px of internal padding. Badges use a compact colored fill with matching semantic text for success, warning, and danger.

### Inputs and fields

Inputs, textareas, and native selects use raised paper, a soft border, and ink text. Focus strengthens the border and adds a subtle ring. Mobile form text stays at least 16px to avoid browser zoom.

### Navigation

The team sidebar groups routes by job and uses clear selected states. The client portal exposes essential actions in both desktop and mobile navigation. Active links carry `aria-current`; menus and drawers retain keyboard access.

### Empty states

Empty states use a softly tinted area and dashed border, with a direct explanation and action when one is available.

## Do's and Don'ts

### Do:
- **Do** keep the warm paper and ink foundation across public, team, and client surfaces.
- **Do** show task state and progress only when backed by real data.
- **Do** preserve readable focus, hover, disabled, loading, and empty states.

### Don't:
- **Don't** use semantic red, green, or amber as decoration.
- **Don't** let promotional typography or imagery reduce the scanability of work screens.
- **Don't** bury a primary client or team action behind an overflow menu on mobile.
