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

Spontané has two identities (owner decision, 2026-10-26):

- **The app** (profile, coach métiers, Chasseur, Suivi, settings, login) operates. Its visual world is the student's four-colour ballpoint pen: ink blue for actions, correction green for what is good or verified, margin red for errors, pencil-lead navy for text, plus a highlighter yellow reserved for text selection. Normal-width Archivo, flat surfaces, colour only for action, selection and status. Everything from "Colors" to "Do's and Don'ts" below describes the app.
- **The landing** (`app/(marketing)`, the 404 and future marketing pages) persuades. It follows the vendored `landing-page-design` skill (`.claude/skills/landing-page-design`) entirely: monochrome with one signal green, Geist, floating navigation, scroll reveals. See "Landing" at the end of this file; when it disagrees with an app rule, the landing section wins on marketing pages only.

## Colors

- **Encre (`primary`):** primary buttons, links, focus outline, current navigation item. Never decoration.
- **Mine (`foreground`) on Papier (`background`):** all body text. Cards sit on `card` white above the paper ground.
- **Vert correction (`success`, `success-soft`):** strong scores, verified sources, positive statuses such as "Entretien".
- **Surligneur amber (`warning`, `warning-soft`):** medium scores and "to review" states.
- **Rouge marge (`destructive`, `margin-rule`):** errors and destructive actions; `margin-rule` is the 1px margin line on the example mail only.
- **Surligneur (`highlight`):** `::selection` background. Not used as a text colour.
- **`band`:** kept for compatibility; no longer used since the landing redesign.
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

Archivo is the only family of the app, loaded through `next/font/google` with its width axis. The `font-display` utility (widened, weight 800, tight tracking) is reserved for the "Spontané" wordmark of the app header and the login page; app screens use Archivo at normal width with a fixed rem scale (`text-sm` to `text-3xl`) and bold weight for page titles. Keep prose under 75 characters per line, use `tabular-nums` for scores and counts, and use sentence case everywhere.

## Layout

Design mobile first and verify at 390×844 and 1440×900. The app content column is `max-w-5xl`, with 16px side gutters on phones and 24px from `sm`. On phones the app navigation is a five-column grid under the header (icon above label, 56px tall); from `md` it becomes an inline row in a 64px header. The header is not sticky, so screen-level sticky bars (profile save bar, Chasseur selection bar) keep the top and bottom edges to themselves.

## Elevation & Depth

Surfaces are flat: hierarchy comes from the paper/card contrast and 1px borders, not shadows. Cards carry no shadow. A soft shadow is allowed only on true overlays such as dialogs.

## Shapes

Radius follows hierarchy: `sm` for badges and status chips, `md` for buttons, inputs and selects, `xl` for cards and panels, `2xl` for showcase sheets and the login panel. Pill shapes are not used for app buttons.

## Components

Buttons, inputs and selects are 40px tall; the `sm` button is 36px with a fine pointer and 40px on touch screens (`pointer-coarse`). Every interactive element shows the same focus: a 2px solid `ring` outline with a 2px offset (0 offset on text fields). Primary buttons are ink blue with semibold labels; outline buttons turn ink on hover. Use `Badge` variants `success` and `warning` for score bands. Motion uses `--ease-out` with `--duration-fast` (120ms) for state changes, `--duration-base` (200ms) for reveals; reduced motion disables all of it.

## Do's and Don'ts

- Do keep tap targets at 40px or more and never cause horizontal scrolling at 390px.
- Don't let a fixed or sticky bar cover content.
- Don't place an all-caps eyebrow label above headings, join metadata with middle dots, or append "→" to buttons and links.
- Don't build pages from rows of identical shadowed cards or decorative gradients.
- Don't show fake testimonials, stock photos or invented figures; any example content is labelled "Exemple fictif".
- Don't highlight a single word of a headline with another colour or style.

## Landing

Source of truth: `.claude/skills/landing-page-design/SKILL.md` (and `design-to-motion` for the animated visuals), followed without local exceptions. Code: `app/(marketing)/layout.tsx` (skip link, floating navigation, footer, reveal observer), `app/(marketing)/page.tsx` (sections), `components/marketing/*` (copy in `content.ts`, `site-nav.tsx`, `example-mail.tsx`, `tagline-reveal.tsx`, `reveal-observer.tsx`), `app/not-found.tsx`, `app/icon.svg`, `app/(marketing)/opengraph-image.tsx`.

**Structure (layout A, classic hero plus sections).** Floating nav, hero (headline, subheadline, one CTA "Commencer avec Google", proof line, annotated example mail), problem to solution, four benefits (bento cards with small visuals), tagline reveal, how it works (3 steps), guarantees (risk reversal), FAQ (9 questions, FAQPage JSON-LD), final CTA identical to the hero, footer. There is no testimonial or logo strip until real ones exist: proof is the example mail with its sources, labelled "Exemple fictif".

**Colours.** Scoped to `.landing` in `app/globals.css`; the shadcn variables are re-mapped inside it so shared utilities keep working, plus `surface`, `raised`, `primary-hover`, `signal`, `signal-soft`. Backgrounds are flat (no gradient), dark backgrounds only from #000000, #181818, #1F1F1F, #272727, #313131. Green (`signal`) is the only accent: verified sources, good scores, the "Entretien" status, guarantee icons.

| Token            | Light   | Dark    |
| ---------------- | ------- | ------- |
| background       | #FFFFFF | #000000 |
| foreground       | #000000 | #FFFFFF |
| surface          | #F6F6F6 | #181818 |
| raised           | #ECECEC | #272727 |
| border           | #E3E3E3 | #313131 |
| muted-foreground | #666666 | #9B9B9B |
| primary          | #000000 | #FFFFFF |
| primary-hover    | #313131 | #E3E3E3 |
| signal           | #0B7A46 | #5BE49B |
| signal-soft      | #E3F4EA | #1F1F1F |

**Hero heading.** The only gradient, on text (`text-heading-gradient`): left to right #000000 → #666666 in light, #FFFFFF → #9B9B9B in dark. Heading and subheading capped at 680px, line breaks placed where the thought breaks (explicit `<br>` from `sm`).

**Typography.** Geist only (`components/marketing/geist.ts`), weights 400 to 600, never italic, never 900. Sizes only from the Tailwind scale, no `clamp()` and no arbitrary sizes; line heights are the ones of each step. Main buttons `text-base` semibold, header buttons `text-sm` semibold. Headings `text-wrap: balance`, body `pretty`. Copy: sentence case, no hyphen inside sentences (French words that need one, like "peut-être" or "Saint-Nazaire", are rewritten), none of the banned filler words.

**Spacing and radius.** Spacing only 0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96px. Main buttons: 8px × 12px padding, `rounded-xl`. Cards `rounded-3xl`; nested shapes follow inner radius = outer radius − gap when the gap is under 32px (the nav pill with 8px padding holds pill buttons; the example mail frame `rounded-3xl` with 8px padding holds a `rounded-2xl` sheet). Only `rounded-xl`, `2xl`, `3xl` and `full` are used on the landing (the app redefines `sm`, `md` and `lg`). Borders go all the way around or not at all.

**Icons.** Phosphor (`@phosphor-icons/react/ssr` in server components), regular weight, `duotone` for the guarantees, `fill` for the proof shield. lucide stays in the app.

**Motion.** Curve `--ease-landing` = cubic-bezier(0.22, 1, 0.36, 1); 500ms for movement, 300ms for colour on hover; only transform and opacity (plus a 4 to 6px blur in the hero intro). Hero: CSS load intro (rise and resolve from blur, staggered, example mail card then its rows then the source numbers). Sections: rise 32px and fade over 700ms once, via one IntersectionObserver (`[data-reveal]`), hidden only when scripts run. Tagline: each word goes from 30% to full opacity as it crosses 60% of the viewport. Mobile menu: full height blurred panel, toggle lines morph into a cross, links rise 24px, 60ms apart, capped at 400ms. Benefit cards: each visual tells a short story on a loop and returns to its resting design (a highlight inspects the companies, the source number pulses, a sheen crosses the attachment, a reply travels the statuses and "Entretien" pops), paused when off screen (`[data-story]`). Reduced motion: no movement, plain fades, no story. The hero example mail only loads in; a looping story on it needs the owner's go.

**Ship list.** Skip link, `aria-current` on the section in view, semantic landmarks, favicon `app/icon.svg`, title, description and Open Graph image, branded 404, footer legal links shown disabled "(bientôt)" until the Sprint 5 privacy policy and terms exist. No cookie banner: the landing sets no tracking cookie.
