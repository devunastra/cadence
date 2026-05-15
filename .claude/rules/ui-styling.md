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

## Data Tables

All table-based pages (Leads, Call History, etc.) must follow these patterns exactly.

### Page Layout
- Page heading: `text-2xl font-semibold flex-shrink-0 px-5 pt-10 pb-3` with `color: var(--color-text-primary)`
- Content wrapper: `flex flex-col flex-1 min-h-0` (constrains table height so pagination stays pinned)
- Shell root: `relative flex flex-col h-full px-5 pb-4 gap-3 [font-family:var(--font-inter,Inter,sans-serif)]`
- `<main>` in `app/(app)/layout.tsx` must be `flex-1 flex flex-col overflow-hidden` for height chain to work

### Table Card
- Outer: `relative flex-1 min-h-0 rounded-xl overflow-hidden shadow-sm` with `border: 1px solid var(--color-border)`
- Inner scroll wrapper: `h-full overflow-y-auto overflow-x-auto no-theme-transition` with `backgroundColor: var(--color-bg)`
- `<table>`: `w-full text-sm border-collapse`

### Table Header
- `<thead>`: `sticky top-0 z-10` with `backgroundColor: var(--color-surface)` (on `<thead>`, not `<tr>`)
- `<th>`: `pl-3 pr-4 py-3 text-left text-xs font-medium uppercase tracking-wider` with `color: var(--color-text-muted)`
- Bottom border: `borderBottom: 1px solid var(--color-border)`

### Table Rows
- Cell padding: `px-3 py-3 align-middle`
- Row background: `bg-[var(--color-bg)]`
- Row hover: `hover:bg-[var(--color-surface)]` (CSS class, not JS handlers)
- Row border: `borderBottom: 1px solid var(--color-border)`
- Transition: `transition-colors`
- Clickable rows: add `cursor-pointer`
- Text color: `var(--color-text-primary)` for primary data, `var(--color-text-secondary)` for secondary, `var(--color-text-muted)` for null/empty placeholders

### Badges (in table cells)
- Classes: `inline-flex items-center px-2 py-0.5 rounded text-sm font-medium`
- Colors: use `STATUS_COLORS` from `lib/constants.ts` → `status-bg-*` / `status-text-*` CSS classes
- Null/empty: show `—` (`\u2014`) in `var(--color-text-muted)`

### Pagination Footer
- Layout: `flex-shrink-0 flex items-center justify-between px-2 py-0.5 text-sm`
- Left side: "Rows per page" label + segmented button group (20 / 50 / 100)
  - Active: `backgroundColor: var(--color-accent)`, `color: #ffffff`
  - Inactive: `backgroundColor: var(--color-bg)`, `color: var(--color-text-secondary)`
  - Hover (inactive): `backgroundColor: var(--color-surface)`, `color: var(--color-text-primary)`
  - Border: `1px solid var(--color-border)`, active: `borderColor: var(--color-accent)`
  - First button: `rounded-l-md`, last: `rounded-r-md`
- Right side: "1–50 of 234" text + First/Prev/PageInput/Next/Last nav buttons
  - Text: `var(--color-text-secondary)`
  - Nav buttons: `p-2 rounded-md` with `border: 1px solid var(--color-border)`
  - Disabled: `opacity-30 cursor-not-allowed`
  - Icons: `size={16}`
- Default page size: 50

### Empty State
- Padding: `py-8` centered in table
- Text: `text-sm` in `var(--color-text-muted)`
- Contextual message per tab/filter state

### Sidebar Icons
- All nav icons: `size={20}`, clean outline style from Lucide
- Style: simple, object/concept icons — avoid "action" variants (e.g. `Phone` not `PhoneCall`)

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
