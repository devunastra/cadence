# Spec: Cancel Follow-up Calls

## Summary

Allow studio staff to cancel pending AI callback calls from the Follow-ups page. When a lead tells the Retell AI agent to call them back at a specific time, the callback gets queued in an n8n data table. This feature lets staff cancel that queued callback from the web app — e.g., when someone already called the client manually.

---

## Background: How AI Callbacks Work Today

1. During a Retell call, the lead says "call me back tomorrow at 1pm"
2. The Retell agent POSTs to the `schedule_ai_callback` webhook in n8n's **Voice AI Functions** workflow
3. The webhook parses the time and inserts a row into the **n8n "AI Callback" data table** (ID: `9U0GXNR5uRUTWUPy`)
4. Every 30 minutes, the `AI Callback Trigger` (n8n schedule trigger) queries for rows where `callback_time <= now AND called_at IS EMPTY`
5. For each pending row, it calls `Retell create-phone-call` to make the outbound call
6. After calling, it stamps `called_at` with the current timestamp (so the row is skipped on future runs)

### n8n AI Callback Data Table Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | auto | Row ID |
| `first_name` | string | Lead's first name |
| `last_name` | string | Lead's last name |
| `phone_number` | string | Lead phone (E.164 format) |
| `email` | string | Lead email |
| `dance_interest` | string | What dance they're interested in |
| `reason` | string | Reason for inquiry |
| `callback_time` | datetime | When to call back |
| `called_at` | datetime | Timestamp when call was made (empty = pending) |

### Separate System: call_reviews

The `call_reviews` table (Supabase) is populated **after** a call by GPT-5.5 analysis. It flags `callback_requested = true` when the transcript shows the lead asked for a callback. These are the rows shown on the Follow-ups page's "Callback Requests" tab.

**The link between systems:** Both reference the same lead, matched by phone number. `call_reviews` has `call_id` -> `calls.lead_id` -> `leads.phone` -> n8n data table `phone_number`.

---

## Users

| Role | What they see | What they can do |
|------|---------------|------------------|
| `super_admin` | Cancel button on each Callbacks tab row | Cancel any pending callback |
| `studio_owner` | Cancel button on each Callbacks tab row | Cancel callbacks for their studio |
| `studio_staff` | Cancel button on each Callbacks tab row | Cancel callbacks for their studio |

All three roles can cancel. RLS enforces studio isolation — users only see their own studio's call reviews.

---

## Acceptance Criteria

- [ ] A cancel button (PhoneOff icon) appears on each row in the **Callbacks tab only** (not the Follow-ups tab)
- [ ] Clicking the cancel button opens a confirmation dialog before canceling
- [ ] On confirm, the pending n8n AI Callback row is neutralized (via cancel webhook setting `called_at`)
- [ ] On confirm, `call_reviews.callback_cancelled` is set to `true`
- [ ] Cancelled rows no longer appear in the Callbacks tab
- [ ] The "Callback Requests" KPI card count excludes cancelled rows
- [ ] If no matching n8n row is found (already called or never queued), the review is still marked cancelled with a warning toast
- [ ] If the n8n webhook fails, the review is NOT marked cancelled and an error toast is shown
- [ ] The cancel button shows a loading spinner while processing
- [ ] Dark mode renders correctly (uses CSS custom properties)

---

## UI States

| Component | Loading | Empty | Error | Success |
|-----------|---------|-------|-------|---------|
| Cancel button | Spinner replaces icon, row action disabled | N/A | Red error toast ("Failed to cancel callback") | Row disappears from table, success toast |
| Confirmation dialog | Confirm button shows "Cancelling..." + disabled | N/A | Dialog stays open, error toast | Dialog closes, table refreshes |
| Callbacks tab (after cancel) | Normal skeleton on refresh | "No callback requests found." | Standard error handling | Updated row count + KPI |

---

## Edge Cases

| # | Category | Scenario | Expected Behavior | Severity |
|---|----------|----------|-------------------|----------|
| 1 | Data | Lead has no phone number in `leads` table | Mark review cancelled anyway, warn "No phone on file — could not check call queue" | Low |
| 2 | Data | No pending n8n row found (already called or never queued) | Mark review cancelled, info toast "No pending callback found in queue" | Low |
| 3 | Data | Multiple pending n8n rows for same phone | Cancel all matching rows | Low |
| 4 | Concurrency | 30-min n8n trigger fires mid-cancel (race condition) | n8n row gets `called_at` stamped, our webhook update is a no-op. Still mark review cancelled with warning. | Low |
| 5 | Network | n8n webhook times out or returns error | Do NOT mark review cancelled. Show error toast. User can retry. | Medium |
| 6 | Network | Supabase update fails after n8n cancel succeeds | Show error toast. n8n row is already neutralized but review still shows in UI. User can retry (n8n cancel is idempotent). | Medium |
| 7 | Permissions | Cross-studio access attempt | RLS blocks — user can only see/update their own studio's reviews | High |
| 8 | State | User cancels, then page refreshes via Realtime | Row already gone from query results (filtered by `callback_cancelled`) | Low |
| 9 | Auth | Session expired mid-cancel | Server action returns Unauthorized, redirect to login | Medium |
| 10 | Browser | Double-click on cancel button | Disabled state on first click prevents duplicate requests | Low |

---

## Affected Layers

### DB: New migration `031_callback_cancelled.sql`
- Add `callback_cancelled boolean DEFAULT false` to `call_reviews`
- No backfill needed — all existing rows default to `false`
- Null values in UI: not applicable (boolean with default)

### RLS: No policy changes
- Existing SELECT policy on `call_reviews` covers reads
- UPDATE for `callback_cancelled` uses service client (via `getAuthorizedClient` for super_admin) or user client (RLS scoped to studio)
- Need to add an UPDATE policy for `call_reviews` (currently only has SELECT)

### Server actions: `app/actions.ts`
- **New:** `cancelCallback(reviewId: string, studioId: string)` — looks up phone, hits n8n webhook, marks review cancelled
- **Modify:** `fetchQualityReviews` — exclude `callback_cancelled = true` when `callbackRequested` filter is on
- **Modify:** `fetchFollowUpKpis` — exclude cancelled rows from `callbackCount`

### API routes: None
- The n8n cancel webhook is called from the server action (server-side fetch), not a separate API route

### n8n: New cancel webhook workflow
- Small workflow: webhook receives `{ phone_number }` -> queries AI Callback table for matching pending rows -> sets `called_at = now` -> returns result
- Authenticated via header secret (same pattern as existing GHL webhooks)
- Created via n8n MCP tools

### Components
- **Modify:** `components/follow-ups/follow-ups-shell.tsx` — add cancel button column (Callbacks tab only), confirmation dialog, toast feedback
- **Reuse:** `components/confirm-delete-modal.tsx` pattern (but with amber/PhoneOff styling instead of red/Trash2)

### Types
- **Modify:** `lib/types.ts` — add `callback_cancelled: boolean` to `CallReview` interface

### Realtime: No changes
- Existing subscription on `call_reviews` table will automatically refresh when `callback_cancelled` is updated

### Preferences: No changes
- No new filters to persist

### Activity logs: Not needed
- Cancel action is low-risk and not a lead mutation

### Enum options: None

---

## Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `N8N_CANCEL_CALLBACK_WEBHOOK_URL` | `https://lunastra-ai-n8n.up.railway.app/webhook/{path}` | URL of the cancel callback webhook in n8n |
| `N8N_CANCEL_CALLBACK_WEBHOOK_SECRET` | (generated) | Header auth secret for the webhook |

---

## Data Flow

```
Staff clicks Cancel icon on Callbacks tab row
  -> Confirmation dialog opens
  -> Staff clicks "Cancel Callback"
  -> cancelCallback(reviewId, studioId) server action fires
    -> Supabase: SELECT call_id FROM call_reviews WHERE id = reviewId
    -> Supabase: SELECT lead_id FROM calls WHERE id = call_id
    -> Supabase: SELECT phone FROM leads WHERE id = lead_id
    -> n8n webhook: POST { phone_number } with auth header
      -> n8n queries AI Callback table for phone match + called_at empty
      -> n8n sets called_at = now on matching rows
      -> n8n returns { success, rows_updated }
    -> Supabase: UPDATE call_reviews SET callback_cancelled = true WHERE id = reviewId
    -> Return { success: true, warning?: string }
  -> UI: close dialog, show toast, refresh table + KPIs
  -> Realtime subscription also triggers refresh (belt + suspenders)
```

---

## Matching Strategy

The n8n AI Callback data table has no `lead_id` or `call_id`. The web app's `call_reviews` has no `phone_number`. The match chain:

```
call_reviews.call_id
  -> calls.lead_id
    -> leads.phone
      -> n8n data table phone_number (WHERE called_at IS EMPTY)
```

Phone numbers are stored in E.164 format in the n8n table. The `leads.phone` field may need normalization before matching — the server action should strip formatting to match E.164.

---

## Out of Scope (MVP)

- **Reschedule callback** (change the callback time instead of canceling) — separate feature
- **Cancel from CallDetailDrawer** — can add later, cancel button in table row is sufficient for MVP
- **Audit trail of who cancelled** — can add `cancelled_by` and `cancelled_at` columns later if needed
- **Bulk cancel** (select multiple rows and cancel all) — not needed yet
- **Sync n8n data table state into Supabase** (showing "Pending" / "Called" / "Cancelled" status) — future enhancement
- **Cancel from the Call History page** — only on Follow-ups page for now

---

## Spec Validation

- [x] User flows documented (all three roles)
- [x] Edge cases identified across 8 categories (10 cases)
- [x] UI states specified (loading, empty, error, success)
- [x] Backend requirements clear (server action + n8n webhook)
- [x] Cross-studio isolation addressed (RLS)
- [x] Acceptance criteria testable (10 criteria)
- [x] Dark mode in scope (CSS custom properties)
- [x] Integration impact assessed (n8n webhook, no GHL/Retell changes)
- [ ] ~~Activity log coverage~~ — not needed for this feature
- [ ] ~~Enum option decision~~ — not applicable
- [x] Realtime behavior specified (existing subscription covers it)
- [x] Data migration/backfill scoped (additive column, default false)
- [ ] ~~Filter persistence~~ — no new filters

---

## Open Questions

1. **RLS UPDATE policy:** `call_reviews` currently only has a SELECT policy. Should the UPDATE policy allow all studio members to cancel, or restrict to `studio_owner` + `super_admin` only?
2. **Toast provider:** The current toast system only supports error toasts (`showError`). Should we extend it to support success/warning toasts for this feature, or use a simpler inline feedback approach?

---

## Recommended Next Step

-> `senior-software-engineer` to build (server action + migration + n8n workflow + UI changes)
-> `qa-tester` for test plan after implementation
