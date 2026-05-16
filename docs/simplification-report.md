# Simplification Report — Post-Performance Refactor

> Generated 2026-05-16. Review after committing the navigation performance changes.

---

## Context

Pages were converted from async server components (SSR data fetching) to `'use client'` components that read `studioId` from `StudioProvider` context and fetch data client-side. This left behind dead `initial*` props, zombie code paths, and redundant patterns.

---

## P1 — Dead `initial*` props (never passed by any caller)

### 1. `components/call-history/call-history-shell.tsx` (lines 379–416)
- **Dead props:** `initialCalls`, `initialTotal`, `initialPageFilters`
- Only caller: `<CallHistoryShell studioId={studioId} />`
- `if (initialCalls) return` guard at line 416 never triggers
- `useState(!initialCalls)` → always `true`
- ~8 lines saved

### 2. `components/call-analytics/analytics-shell.tsx` (lines 40–107)
- **Dead props:** `initialData`, `initialRange`, `initialDirection`, `initialTranscriptFilters`
- Only caller passes `studioId` + `initialTab`
- `if (initialData) return` guard at line 107 never triggers
- `defaultRange` IIFE always runs the fallback branch
- ~18 lines saved

### 3. `components/calendar/calendar-shell.tsx` (lines 23–96)
- **Dead props:** `initialAppointments`, `initialWeekStart`, `initialListFilters`
- Only caller passes `studioId`, `calStartHour`, `calEndHour`, `slotConfig`, `userRole`
- `if (initialAppointments) return` guard at line 96 never triggers
- ~12 lines saved

### 4. `components/leads/leads-table.tsx` (lines 84–207)
- **Dead props:** `initialCustomViews`, `initialLeads`, `initialTotal`, `initialPrefs`, `initialPageFilters`, `studioName`
- Only caller: `<LeadsTable studioId={studioId} />`
- `skipFirstFetch` init `(initialLeads ?? []).length > 0` always evaluates to `false`
- ~10 lines saved (prop removal)

---

## P2 — Dead state variable

### 5. `components/leads/leads-table.tsx` (lines 87, 157, 165)
- `studioName` prop + `const [studioName, setStudioName]` state
- Never read in JSX or any handler. `setStudioName` never called.
- Trivially safe to remove.

---

## P3 — Tab cache overengineered

### 6. `components/call-history/call-history-shell.tsx` (lines 404–600)
- `tabCache` ref + `cacheKey` function uses `JSON.stringify` of 6 fields
- Every Realtime INSERT clears the entire cache (`tabCache.current = {}`)
- Cache only hits if user revisits an identical tab+filter+page+sort combo with zero Realtime events in between — low probability
- Initial mount fetch maps rows into cache twice (duplicate mapping)
- ~25 lines of complexity for minimal real-world benefit

---

## P4 — Duplicate fetch logic on mount

### 7. `components/call-history/call-history-shell.tsx` (lines 414–484)
- The 70-line browser-client mount `useEffect` duplicates lead-name resolution + callback detection that `fetchCallHistory` (server action via `loadCalls`) already handles
- Could replace with a simple `loadCalls('all', '', DEFAULT_FILTERS, ...)` call on mount
- ~40 lines saved

---

## P5 — Copy-pasted `mounted` pattern

### 8. All 4 shell components
- `const [mounted, setMounted] = useState(false)` + `useEffect(() => { setMounted(true) }, [])`
- Identical in `call-history-shell`, `analytics-shell`, `calendar-shell`, `leads-table`
- Could extract to a `useMounted()` hook in `lib/hooks.ts`
- ~12 lines saved total

---

## P6 — Redundant prop

### 9. `components/call-analytics/analytics-shell.tsx` (lines 42, 84)
- `initialDirection` is redundant with `initialTranscriptFilters.direction`
- Both are now always `undefined` anyway
- ~3 lines

---

## P7 — Pre-existing duplication (not from this refactor)

### 10. `app/api/conversations/route.ts` + `unread-count/route.ts` (lines 6–27 each)
- `getStudio()` function identically copy-pasted in both files
- Could extract to `lib/get-studio.ts`
- ~22 lines saved

---

## Recommended order

1. **P1 #1–#4** — Strip dead `initial*` props from all 4 shell interfaces + remove dead guards
2. **P2 #5** — Remove `studioName` dead state
3. **P4 #7** — Replace mount fetch with `loadCalls` call (removes ~40 lines + eliminates P3 #6 cache complexity)
4. **P5 #8** — Extract `useMounted()` hook
5. **P6 #9** + **P7 #10** — Cleanup passes
