# UI Styling Rules — AMLS WebApp

> **IMPORTANT:** This file is the single source of truth for all design decisions.
> Whenever a design change is made — new color, spacing, component pattern, or animation — update this file.
> Never hardcode hex values in components. Always use the CSS custom properties defined in `app/globals.css`.

---

## Design Philosophy

Production-ready, sleek, modern — inspired by Apple, Stripe, Wise, and Linear.
- One strong accent color (`#2383E2`) on a neutral base
- Color is reserved for status badges and interactive states only
- No decorative color on navigation or layout chrome

---

## CSS Design Tokens

All tokens are defined in `app/globals.css` as CSS custom properties.

### Accent
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-accent` | `#2383E2` | `#2383E2` | Buttons (primary), checkboxes (checked), active tab underline, focus rings |
| `--color-accent-hover` | `#1a6ec7` | `#1a6ec7` | Hover state on accent elements |
| `--color-accent-subtle` | `#EBF3FD` | `rgba(35,131,226,0.12)` | Tinted surface behind accent UI |

### Backgrounds
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-bg` | `#ffffff` | `#111111` | Page/app background |
| `--color-surface` | `#f7f7f7` | `#1a1a1a` | Table rows, input bg, card bg |
| `--color-surface-hover` | `#f0f0ef` | `#222222` | Row hover, dropdown option hover |

### Borders
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-border` | `#e5e5e3` | `#2a2a2a` | Dividers, table lines, input borders |
| `--color-border-strong` | `#d0d0ce` | `#3a3a3a` | Emphasized borders, modal edges |

### Text
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--color-text-primary` | `#111111` | `rgba(255,255,255,0.92)` | Headings, cell data, active nav items |
| `--color-text-secondary` | `#6b7280` | `rgba(255,255,255,0.50)` | Labels, placeholders, inactive nav items |
| `--color-text-muted` | `#9ca3af` | `rgba(255,255,255,0.30)` | Timestamps, metadata, helper text |

### Sidebar
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--sidebar-bg` | `#ffffff` | `#161616` | Sidebar background |
| `--sidebar-width` | `240px` | `240px` | Expanded sidebar width |
| `--sidebar-width-collapsed` | `56px` | `56px` | Collapsed sidebar width |

### Animation Timings
| Token | Value | Usage |
|-------|-------|-------|
| `--transition-fast` | `150ms ease` | Hover states, nav items, opacity changes |
| `--transition-base` | `200ms ease` | Checkbox fill, button bg, modal open |

---

## Typography

- **Font:** Inter (imported via Google Fonts in `app/layout.tsx`, applied globally on `body`)
- **Sizes:**
  - Page headings: `text-xl font-semibold` or `text-lg font-semibold`
  - Table column headers: `text-xs font-medium uppercase` in `var(--color-text-muted)`
  - Cell data / nav items: `text-sm font-medium`
  - Secondary/helper text: `text-xs` in `var(--color-text-secondary)`
- **Weight scale:** `font-normal` (body), `font-medium` (labels, nav), `font-semibold` (headings, active nav)

---

## Buttons

### Primary (CTA)
- Background: `var(--color-accent)`
- Text: white
- Border radius: `rounded-lg` (8px)
- Hover: `var(--color-accent-hover)` + `transform: scale(1.02)`
- Transition: `var(--transition-fast)`

### Secondary / Outline
- Background: `var(--color-bg)`
- Border: `1px solid var(--color-border)`
- Text: `var(--color-text-primary)`
- Hover: `background: var(--color-surface)`
- Transition: `var(--transition-fast)`

### Ghost / Pill (toolbar buttons)
- No border, no background by default
- Hover: `background: var(--color-surface)`
- Padding: `6px 12px`, border radius: `6px`

---

## Checkboxes

- Always visible at low opacity when unchecked (`opacity: 0.45`)
- Shape: `border-radius: 4px` — not fully square, not circle
- Unchecked: `border: 1.5px solid var(--color-border)`, transparent fill
- Checked: background fades to `var(--color-accent)`, checkmark fades in — `200ms ease` transition on `opacity` and `background` only
- No stroke-dashoffset animation — keep it simple
- Checkbox column: no vertical border separator, tighter padding than other columns
- Header (master) checkbox: shows indeterminate (minus) state when partial rows selected

---

## Status Badges

Color is managed via two systems — use the right one for the context:

1. **CSS classes** (`status-bg-*` / `status-text-*`) — use for badge `<span>` elements via `className`. Defined in `app/globals.css`, mapped through `STATUS_COLORS` in `lib/constants.ts`.
2. **`NOTION_COLORS`** (exported from `lib/constants.ts`) — use for JS-only contexts: chart SVG fills, inline DOM style manipulation. Never hardcode hex values directly.

**Never hardcode Notion hex values in components.** Import from `NOTION_COLORS` or use the CSS classes.

### Notion palette (canonical reference)

| Color | Background | Text | CSS class suffix |
|-------|-----------|------|-----------------|
| Green | `#EDF3EC` | `#448361` | `green` |
| Yellow | `#FBF3DB` | `#CB912F` | `yellow` |
| Red | `#FFE2DD` | `#C4554D` | `red` |
| Blue | `#D3E5EF` | `#337EA9` | `blue` |
| Purple | `#EDE9F4` | `#9065B0` | `purple` |
| Pink | `#F5E0E9` | `#C14C8A` | `pink` |
| Gray / Default | `#F1F1EF` | `#787774` | `gray` / `default` |
| Orange | `#FAEBDD` | `#C97B48` | `orange` |
| Brown | `#EEE0DA` | `#9F6B53` | `brown` |

### Status → color mapping (examples)

| Status | Color |
|--------|-------|
| Active, Create, Successful, Scheduled | green |
| Out of Town, Call Back | yellow |
| Didn't Buy/Show, Delete, Unsuccessful, DO NOT CALL | red |
| Inquiry, Update, Revisit | blue |
| Middle, Back, Emailed, Facebook Ads | purple |
| Front, Solicitation, NO SHOW, Wedding | pink |
| Loss, Inactive, Broken Toe, Walk-In | gray |

---

## Skeleton Loaders

- Full row height (~40px) — not thin bars
- 3 shimmer blocks per row at widths: `~5%` (checkbox), `~20%` (name), `~60%` (data)
- Animation: `@keyframes shimmer` — gradient sweep from `var(--color-surface)` → `var(--color-surface-hover)` → `var(--color-surface)`, `1.5s infinite linear`
- Dark mode: uses dark surface tokens automatically — no extra code needed

---

## Progress Bar

- Fixed at very top of viewport, `3px` height
- Color: `var(--color-accent)`
- Triggered on Next.js route changes via `usePathname` + `useEffect`
- Slides from 0% → ~80% during load, jumps to 100% on complete, then fades out

---

## Sidebar Nav Items

- Active state: `background: var(--color-surface)` pill + `font-semibold` + `color: var(--color-text-primary)` — **no blue/accent on nav**
- Inactive: `color: var(--color-text-secondary)`
- Hover: `color: var(--color-text-primary)` + `background: var(--color-surface)`, `transition: var(--transition-fast)`
- Icon + label spacing: `gap-3`

---

## Dark Mode

- Implemented via `next-themes` with `attribute="class"`
- `.dark` class added to `<html>` element
- All tokens flip automatically via CSS custom properties
- The accent color `#2383E2` is identical in both modes — it reads well on both backgrounds
- AM logo: `filter: brightness(0)` in light mode (white→black), no filter in dark mode (stays white)
- Never use `dark:` Tailwind variants for color — use CSS tokens instead so they stay in sync
