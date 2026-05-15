# Spec: Call History Page

## Summary

A new sidebar page that gives all roles a paginated, searchable, filterable table of every call in the `calls` table — organized into 4 tabs (MVP), with Follow-up tab deferred. No schema changes needed. Built entirely on existing data.

---

## Users

| Role | What they see | What they can do |
|------|---------------|------------------|
| super_admin | All calls for selected studio | View, search, filter, open detail drawer, navigate to linked lead |
| studio_owner | All calls for their studio | Same |
| studio_staff | All calls for their studio | Same (read-only, no mutations) |

No role has write access on this page.

---

## Tabs

| Tab | Filter Logic |
|-----|-------------|
| All Calls | No filter |
| Outbound | `direction = 'outbound'` |
| Inbound | `direction = 'inbound'` |
| Failed | `picked_up = false` OR `outcome = 'unsuccessful'` OR `disconnected_reason IN ('voicemail', 'dial_no_answer', 'dial_busy')` — excludes `agent_hangup` and `user_hangup` (these are normal call endings, not failures) |

- Switching tabs resets pagination to page 1
- Active tab is NOT persisted — always opens on All Calls

---

## Acceptance Criteria

- [ ] "Call History" entry appears in sidebar nav (icon: `PhoneCall`) for all three roles, after Call Analytics
- [ ] Page loads first page of calls (default sort: `created_at` desc, page size 50) for active studio
- [ ] Four tabs visible: All Calls, Outbound, Inbound, Failed
- [ ] Active tab underlined with `--color-accent`
- [ ] Switching tabs applies correct server-side filter and resets to page 1
- [ ] Failed tab includes calls where `picked_up = false` OR `outcome = 'unsuccessful'` OR `disconnected_reason` in `('voicemail', 'dial_no_answer', 'dial_busy')` — excludes `agent_hangup` and `user_hangup`
- [ ] Search filters by lead name and phone (join to `leads`) — debounced 400ms
- [ ] Filter bar supports: Direction, Sentiment, Outcome, Appointment Booked, Disconnect Reason, Quality Score, Date Range
- [ ] Date range default: All Time (pagination handles large datasets)
- [ ] Filters saved to `user_preferences.page_filters.callHistory` (1s debounce), restored on next load
- [ ] Clicking a row opens a detail drawer with full call info
- [ ] Detail drawer has "View Lead" link to `/leads/[lead_id]` (hidden when `lead_id` is null)
- [ ] Duration displayed as `m:ss` (e.g. "2:34")
- [ ] Calls with `lead_id = null` show "Unknown contact"
- [ ] Pagination controls: previous / next / page size (20 / 50 / 100)
- [ ] Skeleton loaders during initial load and transitions
- [ ] Contextual empty state per tab
- [ ] All UI uses CSS custom properties — dark mode works automatically

---

## Filters

| Field | Filter Type | Default | Persisted? |
|-------|-------------|---------|------------|
| Direction | Single-select (All / Inbound / Outbound) | All | Yes |
| Sentiment | Multi-select (Positive, Neutral, Negative, Unknown) | All selected | Yes |
| Outcome | Multi-select (Successful, Unsuccessful) | All selected | Yes |
| Appointment Booked | Single-select (Any / Yes / No) | Any | Yes |
| Disconnect Reason | Multi-select (all values) | All selected | Yes |
| Quality Score | Operator + numeric value | Empty (no filter) | Yes |
| Date Range | From / to date picker | All Time | Yes |
| Search (lead name, phone) | Free-text input | Empty | No (ephemeral) |

- **Default sort:** `created_at` descending
- **Secondary sort columns:** Duration, Quality Score, Lead Name
- **Sort persisted to:** `user_preferences.page_filters.callHistory.sort`

---

## Detail Drawer

Slide-in panel on row click, showing:

- Lead name + link to `/leads/[lead_id]`
- Call date/time
- Duration (`m:ss`)
- Direction badge
- Sentiment badge
- Outcome badge
- Appointment booked flag
- Quality score
- Disconnect reason
- AI summary (`transcript_summary`)
- Full transcript (scrollable, fixed max-height)
- Audio player (if `recording_url` exists)

---

## UI States

| View / Component | Loading | Empty | Error | Success |
|------------------|---------|-------|-------|---------|
| Call table (initial) | Full-row skeleton shimmer (3 rows) | "No calls yet for this studio" | Toast: "Failed to load calls." | Paginated table |
| Tab switch | Skeleton overlay on table body | Per-tab empty message | Toast: "Failed to load calls." | Filtered results |
| Search | Spinner in search field | "No calls match your search" | Toast: "Search failed." | Table updates |
| Filter change | Skeleton overlay | "No calls match these filters" | Toast: "Filter failed." | Table updates |
| Detail drawer | Skeleton for transcript area | "No transcript available" | Toast: "Failed to load transcript." | Full content |
| Pagination | Skeleton overlay | n/a | Toast: "Failed to load page." | New page |

**Per-tab empty messages:**

- All Calls: "No calls have been recorded yet."
- Outbound: "No outbound calls found."
- Inbound: "No inbound calls found."
- Failed: "No failed calls — all calls connected successfully."

---

## Realtime Behavior

- **Needs Realtime?** Yes — calls arrive via Retell webhook continuously
- **Trigger:** Retell post-call webhook inserts row into `calls` → Supabase Realtime fires INSERT
- **User sees:** New row prepended to table if on page 1 of All Calls tab with no active search. Otherwise silently ignored.
- **Subscription:** `studio_id=eq.${studioId}` filter on `calls` table, INSERT only
- **Cleanup:** Unsubscribe on unmount via `useEffect` cleanup

---

## Edge Cases

| # | Category | Scenario | Expected Behavior | Severity |
|---|----------|----------|-------------------|----------|
| 1 | Network | Supabase timeout on initial load | Error toast, empty table with retry | High |
| 2 | Network | Timeout during tab/filter change | Toast, keep previous results visible | High |
| 3 | Network | Recording URL 404 | "Recording unavailable" in drawer | Med |
| 4 | Network | Rapid search typing (stale responses) | Cancel previous request, apply most recent | Med |
| 5 | Concurrency | New call arrives via webhook | Prepend if on page 1 All Calls tab | Med |
| 6 | Concurrency | Studio switched while drawer open | Drawer closes, table reloads | High |
| 7 | State | Deep link to `/call-history` with no studio | Redirect to `/login` | High |
| 8 | State | Navigate away and back | Filters restored from preferences; search cleared | Low |
| 9 | State | On page 3, filter returns 1 page | Reset to page 1 | High |
| 10 | Data | `lead_id = null` | "Unknown contact", hide "View Lead" link | High |
| 11 | Data | `duration_seconds = null` | Show "—" | Med |
| 12 | Data | `transcript = null` | "No transcript available" in drawer | Med |
| 13 | Data | `recording_url = null` | Audio player not rendered | Med |
| 14 | Data | `quality_score = null` | Show "—" | Med |
| 15 | Data | Follow-up tab — lead with 1000+ calls | Server-side query with GROUP BY, paginated | High |
| 16 | Data | Special characters in search | Parameterized query, no injection risk | High |
| 17 | Data | Very long transcript | Scrollable panel with fixed max-height | Med |
| 18 | Permissions | Cross-studio URL manipulation | RLS returns 0 rows, empty state shown | High |
| 19 | Permissions | `lead_id` points to different studio's lead | Join enforces `studio_id` scoping, treated as "Unknown contact" | High |
| 20 | Browser | Mobile viewport | Essential columns only, horizontal scroll for full table | Med |
| 21 | Browser | Window < 900px | Filter bar collapses into "Filters" button | Med |
| 22 | Auth | Token expired | Next action returns 401, redirect to `/login` | High |
| 23 | Auth | Studio membership revoked mid-session | RLS returns 0 rows on next fetch | High |
| 24 | Webhooks | Duplicate Retell webhook | Upsert on `retell_call_id` prevents duplicates | High |
| 25 | Webhooks | Retell sends call with `lead_id = null` | Row shows "Unknown contact", excluded from Follow-up tab | Med |

---

## Affected Layers

- **DB:** No new tables or columns. Follow-up tab requires a subquery/CTE or Supabase RPC function (`HAVING COUNT(*) > 1` not expressible via PostgREST filters)
- **RLS:** No changes — `calls` table already has `studio_id` RLS
- **Server actions:** New `fetchCallHistory` in `app/actions.ts` + extend `PageFilters` interface with `callHistory` key
- **API routes:** None needed
- **Components:**
  - `app/(app)/call-history/page.tsx` — server component (loads user, studio, saved filters, first page)
  - `components/call-history/call-history-shell.tsx` — client shell (tabs, search, filter bar, table, pagination)
  - `components/call-history/call-history-table.tsx` — table rows, skeleton, empty states
  - `components/call-history/call-detail-drawer.tsx` — slide-in panel
  - `components/call-history/call-history-filter-bar.tsx` — adapted from transcripts filter bar
  - `components/sidebar/` — add Call History nav item
- **Realtime:** Subscribe to `calls` INSERT events by `studio_id`
- **Preferences:** New `callHistory` key in `user_preferences.page_filters`
- **Activity logs:** No mutations — none needed
- **Constants:** Add badge colors for sentiment and disconnect reason values to `STATUS_COLORS` in `lib/constants.ts`

---

## Dependencies

- **Depends on:** `calls` table, `leads` table (join for name/phone), `user_preferences.page_filters`, existing badge/color system
- **Blocks:** Transcript Analyzer integration, Requested Callbacks tab

---

## Out of Scope (MVP)

- **Follow-up Calls tab** — requires subquery/RPC; deferred for future implementation
- **Requested Callbacks tab** — needs Transcript Analyzer to identify callback requests
- **Transcript search** — searching within transcript text needs GIN index for performance; deferred. MVP search covers lead name + phone only.
- **Transcript Analyzer integration** — separate feature
- **Manual call logging** — adding calls not from Retell
- **Mark as called / call scheduling / task assignment** — write mutations
- **CSV export / bulk actions**
- **Inline transcript search highlighting**
- **Per-row "Refresh from Retell" button**

---

## Decisions Made

1. **Sidebar icon** — `PhoneCall` (Lucide)
2. **Follow-up tab** — Deprioritized, deferred for future implementation
3. **Date range default** — All Time (pagination handles large datasets)
4. **Transcript search** — Deprioritized. MVP search covers lead name + phone only.
5. **Detail view** — Slide-in detail drawer (consistent with transcripts tab in Call Analytics)
6. **Failed tab scope** — Excludes `agent_hangup` and `user_hangup` (normal call endings, not failures)
