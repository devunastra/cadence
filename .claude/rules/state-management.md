# State Management Rules — AMLS WebApp

## Philosophy

No global state store (no Redux, Zustand, Jotai, etc.). State is component-local unless it needs to cross a significant boundary.

---

## Where State Lives

| State type | Where it lives |
|-----------|----------------|
| UI state (open/close, selected rows, filters) | Component `useState` |
| Server data (leads, calls, conversations) | Server components fetch → pass as props |
| Real-time updates | Supabase Realtime subscription in client component |
| User preferences (col widths, theme, view, notifications) | `user_preferences` table, fetched server-side and passed as `initialPrefs` prop |
| Filter + sort state (Leads, Transcripts, Calendar list) | `user_preferences.page_filters` JSONB — loaded on mount, saved on change (debounced 1s) via `savePageFilters` server action |
| Analytics date range + direction | `user_preferences.analytics` JSONB — saved via `saveAnalyticsPreferences` |
| Theme (light/dark) | `next-themes` ThemeProvider (wraps entire app in `components/providers.tsx`) |

---

## Real-time Updates

Supabase Realtime via `postgres_changes` subscriptions. Active subscriptions:

- **`leads`** — `leads-table.tsx` receives INSERT/UPDATE/DELETE, updates local state, shows toast notifications
- **`messages`** + **`conversations`** — `conversations/page.tsx` receives new messages + conversation updates instantly
- **`appointments`** — `calendar-shell.tsx` receives INSERT/UPDATE/DELETE, updates week view and list view

Pattern: subscribe on mount, unsubscribe on unmount via `useEffect` cleanup. Always filter by `studio_id`.

```ts
const channel = supabase
  .channel('my-channel')
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'leads',
    filter: `studio_id=eq.${studioId}`,
  }, (payload) => { /* update local state */ })
  .subscribe()
return () => supabase.removeChannel(channel)
```

---

## Server Actions vs API Routes

- **Server Actions** (`app/actions.ts`): Mutations, data fetching, preference persistence. Called from client components.
- **API Routes** (`app/api/`): External webhooks (GHL, Retell), operations needing rate limiting, responses to third-party services.
- Do not mix these — webhooks must be API routes (they receive external POST requests from GHL/Retell).

---

## Mutations Pattern

Client components call server actions (`app/actions.ts`) for mutations. Server actions call GHL where needed and write to Supabase. Real-time subscriptions then reflect changes in the UI — no manual refetch needed.

```ts
// Good — call server action from client component
await updateLead(leadId, { status: 'Active' })
// Realtime subscription will push the UPDATE back automatically

// Good — direct Supabase mutation for simple cases
const { error } = await supabase.from('leads').update({ status }).eq('id', leadId)
```

---

## Filter/Sort Persistence Pattern

Filter and sort state is persisted to `user_preferences.page_filters` using a debounced save (1s). Each page:

1. **Loads** saved filters from server on mount (passed as `initialPageFilters` prop from the page server component)
2. **Initialises** filter state from those saved values
3. **Saves** on every change via `savePageFilters(studioId, { leads: { filters, sort } })` with a 1s debounce

```ts
// In component init
const [statusFilter, setStatusFilter] = useState<string[]>(
  initialPageFilters?.leads?.filters?.status ?? []
)

// In useEffect — debounced save
useEffect(() => {
  const t = setTimeout(() => savePageFilters(studioId, { leads: { filters, sort } }), 1000)
  return () => clearTimeout(t)
}, [studioId, mounted, statusFilter, ...])
```

---

## Pagination

- Leads table: server-side pagination, `page` + `pageSize` state in `leads-table.tsx`
- Default page size: 50, options: 20 / 50 / 100
- Conversations: server-side pagination via `app/api/conversations` route
- Appointment list: server-side pagination via `fetchAppointmentList` action
