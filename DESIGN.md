---
version: alpha
name: Spontané
description: Design system of Spontané, the spontaneous-application assistant for French students looking for an alternance or an internship.
colors:
  background: "#F5F6FA"
  foreground: "#171B34"
  card: "#FFFFFF"
  primary: "#2B3FD6"
  primary-foreground: "#FFFFFF"
  secondary: "#E9ECFB"
  secondary-foreground: "#1D2A8F"
  muted: "#ECEEF4"
  muted-foreground: "#565B78"
  accent: "#E9ECFB"
  destructive: "#C3302A"
  destructive-foreground: "#FFFFFF"
  success: "#147346"
  success-soft: "#E3F4EA"
  warning: "#8E6400"
  warning-soft: "#FFF3C4"
  highlight: "#FFE347"
  band: "#2B3FD6"
  band-foreground: "#FFFFFF"
  band-muted: "#DDE1FF"
  border: "#DCDFEA"
  input: "#8A8FA8"
  ring: "#2B3FD6"
  margin-rule: "#C3302A"
typography:
  sans:
    fontFamily: Archivo
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  display:
    fontFamily: Archivo
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: -0.03em
    fontVariation: "'wdth' 118"
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  2xl: 16px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: 40px
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: 40px
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.md}"
    height: 40px
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: 40px
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
  badge-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.sm}"
  badge-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.sm}"
  rules-band:
    backgroundColor: "{colors.band}"
    textColor: "{colors.band-foreground}"
omitted:
  - section: spacing
    reason: "Spacing uses the Tailwind default 4px scale; no project spacing tokens are defined."
---

# Spontané

## Overview

Spontané helps students aged 19 to 25 send 20 targeted spontaneous applications in under 15 minutes, then tracks the replies in Gmail. The voice is a capable coach: tutoiement, encouraging, honest, efficient. It is neither a corporate HR tool nor a toy.

The visual world is the student's four-colour ballpoint pen: ink blue for actions, correction green for what is good or verified, margin red for errors, pencil-lead navy for text, plus a highlighter yellow reserved for text selection. Two modes share these tokens. The landing page persuades: widened display type, one committed ink-blue band, and an annotated example mail as proof. The app (profile, coach métiers, Chasseur, Suivi) operates: normal-width type, flat surfaces, colour only for action, selection and status.

## Colors

- **Encre (`primary`):** primary buttons, links, focus outline, current navigation item. Never decoration.
- **Mine (`foreground`) on Papier (`background`):** all body text. Cards sit on `card` white above the paper ground.
- **Vert correction (`success`, `success-soft`):** strong scores, verified sources, positive statuses such as "Entretien".
- **Surligneur amber (`warning`, `warning-soft`):** medium scores and "to review" states.
- **Rouge marge (`destructive`, `margin-rule`):** errors and destructive actions; `margin-rule` is the 1px margin line on the example mail only.
- **Surligneur (`highlight`):** `::selection` background. Not used as a text colour.
- **`band`:** the single full-bleed colour region of the landing page (the rules section).
- **`input` vs `border`:** `input` bounds form controls and outline buttons (3:1 against white); `border` is for dividers and card edges.

Use the semantic utilities (`bg-success-soft text-success`, `bg-warning-soft text-warning`, `bg-secondary text-secondary-foreground`) for score bands and statuses instead of raw Tailwind palette colours such as `emerald-*`, `sky-*` or `amber-*`, so dark mode follows automatically.

## Themes

Dark mode follows the operating system (`prefers-color-scheme`); the `dark:` variant uses the same media query. Values are remapped per token, not inverted:

| Token                  | Light   | Dark    |
| ---------------------- | ------- | ------- |
| background             | #F5F6FA | #0F1226 |
| foreground             | #171B34 | #E9EBF7 |
| card                   | #FFFFFF | #171B36 |
| primary                | #2B3FD6 | #9AA6FF |
| primary-foreground     | #FFFFFF | #0F1226 |
| secondary              | #E9ECFB | #232A5C |
| secondary-foreground   | #1D2A8F | #C9CFFF |
| muted                  | #ECEEF4 | #1C2142 |
| muted-foreground       | #565B78 | #A3A8C6 |
| destructive            | #C3302A | #FF8A80 |
| destructive-foreground | #FFFFFF | #0F1226 |
| success                | #147346 | #5FD394 |
| success-soft           | #E3F4EA | #12301F |
| warning                | #8E6400 | #FFD447 |
| warning-soft           | #FFF3C4 | #3A2F0A |
| band                   | #2B3FD6 | #1A2170 |
| band-muted             | #DDE1FF | #C9CFFF |
| border                 | #DCDFEA | #2A3058 |
| input                  | #8A8FA8 | #6A7099 |
| ring                   | #2B3FD6 | #9AA6FF |

## Typography

Archivo is the only family, loaded through `next/font/google` with its width axis. The `font-display` utility (widened, weight 800, tight tracking) is reserved for landing headlines and the "Spontané" wordmark; app screens use Archivo at normal width with a fixed rem scale (`text-sm` to `text-3xl`) and bold weight for page titles. Landing headlines may scale fluidly with `clamp()`; app headings may not. Keep prose under 75 characters per line, use `tabular-nums` for scores and counts, and use sentence case everywhere.

## Layout

Design mobile first and verify at 390×844 and 1440×900. The app content column is `max-w-5xl`, the landing `max-w-6xl`, with 16px side gutters on phones and 24px from `sm`. On phones the app navigation is a five-column grid under the header (icon above label, 56px tall); from `md` it becomes an inline row in a 64px header. The header is not sticky, so screen-level sticky bars (profile save bar, Chasseur selection bar) keep the top and bottom edges to themselves.

## Elevation & Depth

Surfaces are flat: hierarchy comes from the paper/card contrast and 1px borders, not shadows. Cards carry no shadow. A soft, offset, ink-tinted shadow is allowed only on one showcase object per page (the example mail on the landing) and on true overlays such as dialogs.

## Shapes

Radius follows hierarchy: `sm` for badges and status chips, `md` for buttons, inputs and selects, `xl` for cards and panels, `2xl` for showcase sheets and the login panel. Pill shapes are not used for buttons.

## Components

Buttons, inputs and selects are 40px tall; the `sm` button is 36px with a fine pointer and 40px on touch screens (`pointer-coarse`). Every interactive element shows the same focus: a 2px solid `ring` outline with a 2px offset (0 offset on text fields). Primary buttons are ink blue with semibold labels; outline buttons turn ink on hover. Use `Badge` variants `success` and `warning` for score bands. Motion uses `--ease-out` with `--duration-fast` (120ms) for state changes, `--duration-base` (200ms) for reveals and `--duration-slow` (480ms) for the landing's single orchestrated moment (source underlines drawing in); reduced motion disables all of it.

## Do's and Don'ts

- Do keep tap targets at 40px or more and never cause horizontal scrolling at 390px.
- Don't let a fixed or sticky bar cover content.
- Don't place an all-caps eyebrow label above headings, join metadata with middle dots, or append "→" to buttons and links.
- Don't build pages from rows of identical shadowed cards or decorative gradients.
- Don't show fake testimonials, stock photos or invented figures; any example content is labelled "Exemple fictif".
- Don't highlight a single word of a headline with another colour or style.
