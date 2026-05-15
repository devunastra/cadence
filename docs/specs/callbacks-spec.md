# Callbacks Feature Spec — Call History

## Summary

Surface "callback" calls — inbound calls from leads who previously missed an outbound call from the AI agent — in three ways:

1. **"Callback" chip** (orange) on qualifying rows wherever they appear (All Calls, Inbound tabs)
2. **Callback filter** ("Callbacks only" toggle) on the All Calls and Inbound tabs
3. **Dedicated Callbacks tab** (5th tab) showing only callback rows with extra context columns

## Inbound vs Callbacks

- **Inbound** = every call where someone dialed the AI agent's number
- **Callbacks** = only inbound calls where that person was previously called outbound by the AI agent and didn't pick up

If a random person calls the AI agent for the first time — that's inbound but not a callback. If the AI called someone, they missed it, then they call back — that's both inbound and a callback.

## Matching Logic

An inbound call qualifies as a "callback" when:

1. `direction = 'inbound'`
2. The call is linked to a lead (`lead_id` is not null)
3. That lead has at least one prior outbound call where `picked_up = false`
4. The missed outbound occurred before the inbound call

No time window — any prior miss ever qualifies (can be capped later if needed).

## Schema Changes

Added two nullable text columns to the `calls` table (migration 029):

- `caller_phone` — the number that placed the call (Retell's `from_number`)
- `called_phone` — the number that was dialed (Retell's `to_number`)

Index: `idx_calls_caller_phone_studio` on `(studio_id, caller_phone)` where `caller_phone IS NOT NULL AND direction = 'inbound'`.

## UI: Callbacks Tab

Fifth tab on `/call-history`, after Failed. Columns:

| Column | Description |
|---|---|
| Callback Date | When the lead called back |
| Lead Name | Clickable, links to `/leads/[id]` |
| Phone | Lead's phone number |
| Time Since Missed | Time elapsed between the last missed outbound and the callback |
| Duration | Call duration |
| Outcome | Successful / unsuccessful badge |
| Status | Orange "Callback" chip + blue "Forwarded" chip if transferred |
| Quality | Quality score |

Empty state: "No callbacks recorded yet. Callbacks appear when a lead calls back after a missed outbound call."

## UI: Callback Chip

- Orange badge (`status-bg-orange` / `status-text-orange`) reading "Callback"
- Appears inline next to the direction badge on qualifying rows in All Calls and Inbound tabs
- On the Callbacks tab, shown in the Status column

## UI: Forwarded Chip

- Blue badge (`status-bg-blue` / `status-text-blue`) reading "Forwarded"
- Shown alongside the Callback chip when `transferred = true`
- Indicates the callback was successfully forwarded to the local studio

## UI: Callback Filter

- "Callbacks only" checkbox toggle in the filter panel
- Only visible on All Calls and Inbound tabs (redundant on Callbacks tab)
- Persisted to `user_preferences.page_filters.callHistory.filters.callbackOnly`

## Server Logic

`fetchCallHistory` in `app/actions.ts` handles all tabs including callbacks:

1. For `callbacks` tab or `callbackOnly` filter: queries leads with prior missed outbound calls, restricts inbound calls to those leads
2. For `all` and `inbound` tabs: post-processes rows to flag `is_callback` on qualifying inbound calls
3. Returns `last_missed_outbound_at` for the time-since column

## Sync Updates

`mapRetellCallSync` now extracts `call.from_number` and `call.to_number` from the Retell API response and writes them to `caller_phone` / `called_phone`.

`refreshSingleCallFromRetell` also writes these fields when refreshing a single call.

## Backfill

Admin route at `app/api/admin/backfill-call-phones/route.ts`:

- Fetches all call records with null `caller_phone`
- Hits Retell `/v2/get-call/{id}` for each to get `from_number`/`to_number`
- Writes them back to the `calls` table
- Protected by `CRON_SECRET`, processes up to 1,000 calls per run with 100ms delay between API calls
- Run multiple times if needed — skips already-populated rows

## Role Visibility

All three roles (super_admin, studio_owner, studio_staff) see the chip, filter, and tab. Read-only — no role gating needed.

## Edge Cases

- Multiple missed outbound calls before callback — shows most recent for "time since" column
- Lead calls back multiple times — each is a separate row, each gets the chip
- Same callback row visible in All Calls, Inbound, and Callbacks tabs — chip appears in all three
- Phone format inconsistency — normalization to digits-only before matching
- Pre-migration rows with null phone — excluded from callback matching, no chip shown
- `picked_up = null` (ambiguous) — treated as not missed, doesn't qualify

## Out of Scope (deferred)

- Tab count badge on the Callbacks tab label
- "Resolved/Pending" status on callbacks
- Time-window limit on qualifying missed calls (e.g. 30/90 days)
- KPI card on Call Analytics dashboard
- Backfill of historical phone data (admin route built, not yet run)
- Notification/toast when a new callback arrives
