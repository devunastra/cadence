# Mobile Responsive Spec — AMLS WebApp

> **Goal:** Make the entire app mobile-responsive (<768px) without changing the desktop layout.
> **Status:** Phase 1 shipped (commit c04f0dd). Phases 2-7 pending.
> **Last updated:** 2026-05-22

---

## Phase 1: Foundation — Sidebar & Layout Shell (DONE)

Commit: `c04f0dd` — "feat: add mobile responsive layout (Phase 1)"

### What was done:
- Sidebar converts to slide-out drawer with backdrop on mobile (<768px)
- `AppShell` component (`components/app-shell.tsx`) — hamburger header bar with studio name
- `useIsMobile()` hook (`lib/hooks.ts`) — breakpoint 767px, SSR-safe, real-time updates via `matchMedia`
- Reduced page heading top padding on mobile (`pt-5 md:pt-10`) across all 16 pages + loading skeletons
- Pagination stacks vertically on mobile (`flex-col md:flex-row`) across 6 table pages
- Filter dropdowns cap width to viewport (`max-w-[calc(100vw-2.5rem)]`)
- Tabs scroll horizontally (`overflow-x-auto` + `whitespace-nowrap`)
- Leads toolbar restructured: search on own row, mobile-only New Lead button (`hidden md:flex` / `flex md:hidden`)
- Call History/Follow-ups search goes full-width on mobile (`w-full md:flex-1 md:min-w-[200px] md:max-w-[360px]`)

### Established patterns (reuse everywhere):
| Pattern | Usage |
|---------|-------|
| `useIsMobile()` from `lib/hooks.ts` | Viewport detection in client components |
| `pt-5 md:pt-10` | Page heading top padding |
| `flex-col md:flex-row` | Stack layouts vertically on mobile |
| `overflow-x-auto` + `whitespace-nowrap` | Horizontal tab scrolling |
| `w-full md:flex-1 md:max-w-[...]` | Full-width inputs on mobile |
| `max-w-[calc(100vw-2.5rem)]` | Cap dropdowns/popups to viewport |
| `hidden md:flex` / `flex md:hidden` | Show/hide elements per breakpoint |
| Tailwind `md:` prefix for server components (no hook) | Loading skeletons, layouts |

### Files created/modified:
- **Created:** `components/app-shell.tsx`, `lib/hooks.ts` (added `useIsMobile`)
- **Modified:** `app/(app)/layout.tsx`, `components/sidebar/sidebar.tsx`, all page/loading files, `leads-table.tsx`, `leads-filter-bar.tsx`, `call-history-shell.tsx`, `follow-ups-shell.tsx`, `quality-review-shell.tsx`, `activity-log-table.tsx`, `appointment-list-panel.tsx`

---

## Phase 2: Conversations (highest complexity)

**Problem:** 3-panel layout (340px list + flex-1 thread + 384px contact panel) can't fit on mobile.

**Approach:** Stacked view navigation — only one panel visible at a time on mobile. A `mobileView` state (`'list' | 'thread' | 'contact'`) controls which panel renders.

### Files to modify:
| File | Changes |
|------|---------|
| `app/(app)/conversations/page.tsx` | Add `useIsMobile`, `mobileView` state, conditional panel rendering, back navigation |
| `components/conversations/contact-side-panel.tsx` | Accept `isMobile`/`onBack` props, full-width on mobile with back header |
| `components/conversations/compose-box.tsx` | Email modal goes full-screen on mobile |
| `components/conversations/conversation-thread.tsx` | Reduce padding `px-3 md:px-5` |
| `app/(app)/conversations/loading.tsx` | Single-panel skeleton on mobile via Tailwind responsive classes |

### Key changes in page.tsx:
1. Import `useIsMobile`, add `mobileView` state
2. Wrap each panel: `{(!isMobile || mobileView === 'list') && (...)}`
3. Left panel: `w-[340px]` becomes full-width on mobile
4. Thread header: add back arrow (ArrowLeft) on mobile, add contact-info button (UserRound)
5. `selectConversation()`: also set `mobileView('thread')` when mobile
6. `deleteConv()` / `bulkAction('delete')`: reset to `mobileView('list')` when selected conv deleted
7. Deep link (`?ghlContactId=`): auto-set `mobileView('thread')`
8. Browser back button: `pushState`/`popstate` for list<->thread<->contact transitions
9. Resize handling: effect syncs `mobileView` when `isMobile` changes
10. Page heading only shows in list view on mobile

### Contact side panel on mobile:
- Full-width instead of `w-96`
- Sticky header with back arrow + "Contact Info" title
- Same LeadInfoPanel content

### Compose box on mobile:
- Email modal: `inset: 0` (full viewport) instead of `75% x 90%` centered
- Collapsed bar: ensure 44px touch targets

---

## Phase 3: Leads Table

**Problem:** Multi-column data table with fixed column widths doesn't fit on mobile. Lead detail page has 2-panel layout.

**Approach:** Horizontal scroll for the table. Lead detail page uses stacked view navigation (same pattern as conversations).

### Files to modify:
| File | Changes |
|------|---------|
| `components/leads/leads-table.tsx` | Table container `overflow-x-auto`, consider reducing visible columns on mobile |
| `components/leads/leads-filter-bar.tsx` | Already has Phase 1 changes, may need touch-up |
| `app/(app)/leads/[id]/page.tsx` | Lead detail layout adaptation |
| `components/leads/lead-profile-client-shell.tsx` | 2-panel -> stacked on mobile (info panel / conversation panel) |
| `components/leads/lead-info-panel.tsx` | Full-width on mobile |
| `components/leads/new-lead-modal.tsx` | Full-screen on mobile |

---

## Phase 4: Calendar

**Problem:** 7-column week grid can't fit on mobile. Appointment modals need full-screen treatment.

**Approach:** Default to list view on mobile. Week view shows single-day view with day navigation arrows.

### Files to modify:
| File | Changes |
|------|---------|
| `components/calendar/calendar-shell.tsx` | Default to list view on mobile, hide week grid or show day view |
| `components/calendar/calendar-grid.tsx` | Single-day column on mobile with day picker |
| `components/calendar/appointment-list-panel.tsx` | Already has Phase 1 pagination changes |
| `components/calendar/appointment-modal.tsx` | Full-screen on mobile |
| `components/calendar/create-appointment-modal.tsx` | Full-screen on mobile |

---

## Phase 5: Settings

**Problem:** 208px sidebar nav + content panel doesn't fit on mobile.

**Approach:** Replace sidebar nav with a stacked menu (full-width list of links) on mobile. Tapping a menu item navigates to the sub-page. Back button returns to menu.

### Files to modify:
| File | Changes |
|------|---------|
| `app/(app)/settings/layout.tsx` | Conditionally show sidebar nav vs. stacked menu |
| `components/settings/settings-nav.tsx` | Full-width stacked list on mobile |
| Various settings sub-pages | Form layout adjustments for narrow screens |

---

## Phase 6: Call Analytics & Call History

**Problem:** KPI cards assume 4-column grid. Call history table has many columns. Call detail drawer is side-panel.

**Approach:** KPI cards -> 2-column grid. Charts already use recharts `ResponsiveContainer` (responsive by default). Tables get horizontal scroll. Drawer goes full-width.

### Files to modify:
| File | Changes |
|------|---------|
| `components/call-analytics/analytics-shell.tsx` | Stat cards: `grid-cols-2 md:grid-cols-4` |
| `components/call-analytics/transcripts-panel.tsx` | Layout adjustments |
| `components/call-history/call-history-shell.tsx` | Table `overflow-x-auto`, already has Phase 1 changes |
| `components/call-history/call-detail-drawer.tsx` | Full-width on mobile |
| `components/call-quality/quality-review-shell.tsx` | Same table patterns as call history |

---

## Phase 7: Global Polish

Final pass for consistency, edge cases, and touch optimization.

### Checklist:
- [ ] Touch targets audit: all buttons/links >= 44px tap area on mobile
- [ ] Modal audit: all modals full-screen or properly sized on mobile
- [ ] Form inputs: font-size >= 16px to prevent iOS zoom
- [ ] Test all pages at 375px (iPhone SE) and 390px (iPhone 14)
- [ ] Verify no horizontal overflow on any page
- [ ] Verify all `overflow-x-auto` containers scroll properly
- [ ] Test landscape orientation
- [ ] Test hamburger menu -> page navigation -> interactions -> back on every page
- [ ] Verify desktop layout unchanged at 768px+

---

## Implementation Notes

- Execute phases 2-7 sequentially; each phase is one commit
- Test on mobile viewport after each phase before proceeding
- Never change desktop layout — all mobile changes are conditional on `useIsMobile()` or Tailwind `md:` breakpoints
- Prefer Tailwind responsive classes in server components (loading skeletons, layouts) since hooks require `'use client'`
