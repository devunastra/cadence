# Test Plan: Scheduled Callbacks Tab

**Feature:** Scheduled Callbacks — 3rd tab on `/follow-ups`
**Spec ref:** `docs/specs/cancel-follow-up-spec.md`
**Status:** Ready for manual execution (requires n8n workflow active + env vars set)
**Severity scale:** P0 = blocking release, P1 = high priority, P2 = nice-to-confirm
**Last updated:** 2026-05-21 — revised for final implementation

---

## What Changed Since the Previous Version

The following behaviors changed after the initial test plan was written. Test cases have been updated, added, or annotated accordingly.

1. **Row-click opens CallDetailDrawer** (new category 12): clicking any row now fetches and opens the lead's most recent prior call in `CallDetailDrawer`. If no prior call exists, a warning toast fires instead. Hover cancel-button tests (category 9) are NOT affected because cancel uses `e.stopPropagation()`.
2. **`fetchMostRecentCallForLead` server action** added: new action called by the table on row click. It queries `calls` scoped to `studio_id + lead_id`, ordered by `created_at DESC limit 1`, joined with `leads.name + leads.phone`. Returns `CallHistoryRow | null`.
3. **`openingDetailFor` double-click guard**: while a row-detail fetch is in flight, `openingDetailFor` is set to that row's `n8n_row_id` (a `number`). Subsequent clicks on any row return early. Row opacity drops to 0.6 during the fetch.
4. **Cancel button uses `e.stopPropagation()`**: clicking the PhoneOff icon stops the event from bubbling to the row's `onClick`, so the cancel modal opens without triggering the drawer fetch.
5. **Pagination fix in `fetchScheduledCallbacks`**: the leads query now uses `.range(offset, offset + PAGE - 1)` with `PAGE = 1000`, looping until all n8n phones are matched or leads are exhausted. This bypasses Supabase's project-level `max_rows = 1000` cap. AMLS currently has 1786 leads — without pagination, leads #1001–#1786 were invisible to the matching logic.
6. **n8n filter syntax**: the data table node uses `keyName` / `keyValue` / `condition: "isEmpty"` (not `columnName` / `value: null`). Relevant only when testing n8n workflow internals directly.
7. **`n8n_row_id` type is `number`** (integer, auto-assigned by n8n) — not `string`. The `cancelScheduledCallback` server action signature is `cancelScheduledCallback(n8nRowId: number)`.
8. **Diagnostic console.log lines removed**: production-clean.

---

## Overview

The Scheduled Callbacks tab lists every pending AI callback queued in the n8n AI Callback data table (ID: `9U0GXNR5uRUTWUPy`). Each row represents a lead who asked the AI agent to call them back at a specific time. Studio staff can:

- Click a row to open `CallDetailDrawer` showing the lead's most recent prior call (transcript, summary, recording). If no prior call exists, a warning toast appears.
- Cancel a pending callback before the AI makes the call.

Cancelling stamps `called_at = now()` on the n8n row via a cancel webhook, making the row invisible to the n8n 30-minute trigger. The UI removes the row optimistically.

Visibility is enforced in the server action: each n8n row is matched to a `leads` record by normalized phone number. Rows with no matching lead (orphans) are hidden from everyone. Non-super-admin users only see rows whose matched lead belongs to one of their assigned studios.

---

## Preconditions (must all be true before starting)

- [ ] n8n workflow `AMLS Scheduled Callbacks Webhook (Joshua)` (ID: `DrMdkkkCZBZTu3OS`) is **ACTIVE**
- [ ] n8n Header Auth credential is bound to both webhook trigger nodes with header name `X-Callbacks-Secret`
- [ ] `.env.local` (local) and Netlify environment (prod) contain:
  - `N8N_SCHEDULED_CALLBACKS_LIST_URL=https://lunastra-ai-n8n.up.railway.app/webhook/scheduled-callbacks-list`
  - `N8N_SCHEDULED_CALLBACKS_CANCEL_URL=https://lunastra-ai-n8n.up.railway.app/webhook/scheduled-callbacks-cancel`
  - `N8N_SCHEDULED_CALLBACKS_SECRET=<value matching the n8n credential>`
- [ ] At least one lead with a known phone number exists in each test studio in Supabase
- [ ] Three test accounts are available and can be logged in simultaneously (super_admin, studio_owner, studio_staff)
- [ ] The existing Follow-ups and Callback Requests tabs are known-good before running these tests (baseline)
- [ ] At least one lead in the primary test studio has at least one call record in the `calls` table (needed for row-click drawer tests)

---

## Test Data Setup

### Test leads required in Supabase

You need leads whose phone numbers you control, so you can insert matching n8n rows without touching real leads.

| Test Lead Label | Studio | Phone (raw, as stored in `leads.phone`) | Has prior calls? | Notes |
|---|---|---|---|---|
| Lead A | Studio 1 (primary) | `(555) 100-0001` | Yes (at least 1) | Formatted — tests E.164 normalization |
| Lead B | Studio 1 (primary) | `+15551000002` | Yes (at least 1) | Already E.164 |
| Lead C | Studio 1 (primary) | `5551000003` | No | Raw 10-digit — tests no-prior-call toast |
| Lead D | Studio 2 (secondary) | `(555) 200-0001` | Optional | Cross-studio isolation tests |
| Lead E | Studio 1 (primary) | `+15551000005` | Yes | Multi-cancel / race path tests |

**Important for drawer tests:** Lead A and Lead B must have at least one row in the `calls` table with a matching `lead_id`. The call record should ideally have a non-null `transcript_summary` so the drawer renders non-trivially.

### Inserting test rows into the n8n AI Callback data table

Use the n8n UI or MCP to insert rows directly into the AI Callback data table (ID: `9U0GXNR5uRUTWUPy`). For each test case that needs a pending row, insert a row with these columns:

| Column | Value to use |
|---|---|
| `first_name` | `Test` |
| `last_name` | `Callback` (or a unique suffix per row) |
| `phone_number` | The E.164 normalized form of the test lead's phone |
| `email` | `test@example.com` (or null for null-field tests) |
| `dance_interest` | `Salsa` (or null) |
| `reason` | `Called back tomorrow` |
| `callback_time` | A future ISO timestamp, e.g. `2030-01-01T14:00:00.000Z` |
| `called_at` | **Leave empty / null** — this is what makes a row "pending" |

Use far-future `callback_time` values (year 2030) to prevent the 30-minute n8n trigger from auto-firing the call while you're running these tests.

### Safety note on production data (Cristobal at id 65)

Cristobal (lead id 65) is the live verification case for the pagination fix. **Do not cancel his real callback row via the UI during testing.** Joshua will insert a separate test row that matches a test lead's phone, not Cristobal's, to test the cancel flow.

For any cancel test that needs an n8n row: insert a fresh test row matching a test lead's phone. Delete the row from n8n after the test. Do not operate on any row that corresponds to a real lead with a pending callback.

### Cleanup after each test

After each test case that inserts a row: delete the row via the n8n data table UI or via MCP. Do not leave test rows in the table between test sessions. Rows with `called_at` already stamped are harmless but clutter the table.

### Phone number format variants for phone normalization tests

Insert the n8n row's `phone_number` in each of these formats (all should resolve to `+15551000001` after normalization):

| Format | Value |
|---|---|
| E.164 | `+15551000001` |
| 11-digit no plus | `15551000001` |
| 10-digit | `5551000001` |
| Formatted US | `(555) 100-0001` |
| Formatted with dashes | `555-100-0001` |
| Formatted with dots | `555.100.0001` |
| Whitespace inside | `555 100 0001` |

---

## Role Matrix

| Action | super_admin | studio_owner | studio_staff |
|---|---|---|---|
| See "Scheduled Callbacks" tab | Yes | Yes | Yes |
| See rows matched to their studio's leads | Yes (all studios) | Yes (own studios only) | Yes (own studios only) |
| See orphan rows (no matching lead) | No | No | No |
| See rows from Studio B while logged into Studio A | N/A — super_admin sees all | No | No |
| Click row to open CallDetailDrawer | Yes | Yes | Yes |
| Row-click toast when no prior call exists | Yes (warning) | Yes (warning) | Yes (warning) |
| Cancel a callback in their studio | Yes | Yes | Yes |
| Cancel a callback in another studio (cross-studio) | Yes | No — action throws | No — action throws |
| See Filter pill on this tab | No (hidden) | No (hidden) | No (hidden) |
| See Refresh button on this tab | Yes | Yes | Yes |
| See KPI cards above the tabs | Yes | Yes | Yes |

---

## Test Cases

---

### Category 1: Auth / RLS / Visibility

---

**TC-AUTH-01** — Tab visible to all roles
- **Severity:** P0
- **Steps:**
  - [ ] Log in as studio_staff. Navigate to `/follow-ups`. Confirm a "Scheduled Callbacks" tab appears as the 3rd tab.
  - [ ] Log in as studio_owner. Same check.
  - [ ] Log in as super_admin. Same check.
- **Expected:** The tab is visible to all three roles. No role sees it hidden or absent.

---

**TC-AUTH-02** — studio_owner sees only own-studio rows
- **Severity:** P0
- **Steps:**
  - [ ] Insert a pending n8n row for Lead A (Studio 1) and Lead D (Studio 2).
  - [ ] Log in as studio_owner of Studio 1 only. Open the Scheduled Callbacks tab.
  - [ ] Verify Lead A's row appears. Verify Lead D's row does NOT appear.
  - [ ] Log in as studio_owner of Studio 2. Verify Lead D appears and Lead A does not.
  - [ ] Clean up both rows.
- **Expected:** Each studio_owner sees exactly and only the rows whose matched lead is in their studio.

---

**TC-AUTH-03** — studio_staff sees same rows as studio_owner (own studio)
- **Severity:** P1
- **Steps:**
  - [ ] Insert a pending n8n row for Lead A (Studio 1).
  - [ ] Log in as studio_staff for Studio 1. Open the Scheduled Callbacks tab.
  - [ ] Verify the row for Lead A appears.
  - [ ] Clean up the row.
- **Expected:** studio_staff sees the same visible set as studio_owner for the same studio.

---

**TC-AUTH-04** — super_admin sees rows across all studios
- **Severity:** P1
- **Steps:**
  - [ ] Insert pending rows for Lead A (Studio 1) and Lead D (Studio 2).
  - [ ] Log in as super_admin. Open the Scheduled Callbacks tab.
  - [ ] Verify both rows appear in the table.
  - [ ] Clean up both rows.
- **Expected:** super_admin sees all rows from all studios, not just one.

---

**TC-AUTH-05** — Orphan rows (no matching lead) are hidden from everyone, including super_admin
- **Severity:** P1
- **Steps:**
  - [ ] Insert a pending n8n row with `phone_number = +15559999999` — a number that does NOT exist in `leads.phone` in any studio.
  - [ ] Log in as super_admin. Open the Scheduled Callbacks tab.
  - [ ] Verify no row appears for that phone number.
  - [ ] Log in as studio_owner. Same check.
  - [ ] Clean up the orphan row from n8n.
- **Expected:** Orphan rows are invisible to all roles. The row count does not include them.

---

**TC-AUTH-06** — Cross-studio cancel attempt fails
- **Severity:** P0
- **Steps:**
  - [ ] Insert a pending n8n row for Lead D (Studio 2).
  - [ ] Using browser DevTools or a REST client, call the `cancelScheduledCallback` server action directly (simulate a studio_owner of Studio 1 attempting to cancel the Studio 2 row by passing its `n8n_row_id`).
    - Easiest approach: log in as studio_owner of Studio 1 in the browser. Lead D's row will not be visible. In the browser console, call the server action via `fetch('/...')` or watch the network tab to find the action endpoint and call it with the known `n8n_row_id` (integer).
  - [ ] Observe the response.
- **Expected:** The server action throws `"Callback not found or not authorized to cancel"`. The n8n row is not stamped. No toast of success appears. The row in Studio 2 is unaffected.
- **How it works:** `cancelScheduledCallback` calls `fetchScheduledCallbacks()` first (which applies studio scoping) and throws if the row ID is not in the visible set.

---

**TC-AUTH-07** — Session expiry mid-cancel
- **Severity:** P1
- **Steps:**
  - [ ] Log in as studio_staff. Open the Scheduled Callbacks tab with at least one visible row.
  - [ ] Manually expire the session: open a separate browser tab, call Supabase sign-out, or delete the auth cookie via DevTools > Application > Cookies.
  - [ ] Return to the original tab. Click the PhoneOff cancel button on a row.
  - [ ] Confirm the cancel in the modal.
- **Expected:** The server action fails with an unauthorized error. The user is redirected to `/login` (proxy behavior) or an error toast appears. The n8n row is NOT stamped.

---

### Category 2: Phone Normalization

All tests in this category verify that a match is correctly made between the n8n row's `phone_number` and `leads.phone` regardless of formatting on either side.

**Automated coverage note:** All 29 unit test cases for `normalizePhone` pass via vitest (`__tests__/lib/normalize-phone.test.ts`). The manual tests below verify the same invariants end-to-end through the real Supabase leads query and n8n webhook.

---

**TC-PHONE-01** — Match: n8n E.164 vs leads formatted US
- **Severity:** P1
- **Steps:**
  - [ ] Confirm Lead A's `leads.phone` is `(555) 100-0001` in Supabase.
  - [ ] Insert n8n row with `phone_number = +15551000001`.
  - [ ] Open the Scheduled Callbacks tab.
- **Expected:** Lead A's row appears.

---

**TC-PHONE-02** — Match: n8n 10-digit raw vs leads E.164
- **Severity:** P1
- **Steps:**
  - [ ] Confirm Lead B's `leads.phone` is `+15551000002`.
  - [ ] Insert n8n row with `phone_number = 5551000002`.
  - [ ] Open the tab.
- **Expected:** Lead B's row appears. The phone displayed in the table is formatted as `(555) 100-0002` (the component formats for display).

---

**TC-PHONE-03** — Match: n8n formatted with dashes vs leads raw 10-digit
- **Severity:** P1
- **Steps:**
  - [ ] Confirm Lead C's `leads.phone` is `5551000003`.
  - [ ] Insert n8n row with `phone_number = 555-100-0003`.
  - [ ] Open the tab.
- **Expected:** Lead C's row appears.

---

**TC-PHONE-04** — Match: n8n 11-digit (no plus) vs leads E.164
- **Severity:** P1
- **Steps:**
  - [ ] Lead B (`+15551000002`). Insert n8n row with `phone_number = 15551000002`.
  - [ ] Open the tab.
- **Expected:** Lead B's row appears.

---

**TC-PHONE-05** — No match: non-US number (+44...)
- **Severity:** P2
- **Steps:**
  - [ ] Insert n8n row with `phone_number = +447911123456`.
  - [ ] Ensure no lead in Supabase has this phone.
  - [ ] Open the tab.
- **Expected:** The row is treated as an orphan and does not appear. (normalizePhone returns `+447911123456` for this input — a 12-digit string starting with +. This will not match any US lead unless a lead happens to have this exact phone.)

---

**TC-PHONE-06** — No match: garbage input in n8n phone field
- **Severity:** P2
- **Steps:**
  - [ ] Insert n8n row with `phone_number = abc-notaphone`.
  - [ ] Open the tab.
- **Expected:** The row does not appear (normalizePhone returns null, orphan-dropped).

---

**TC-PHONE-07** — No match: null phone in n8n row
- **Severity:** P2
- **Steps:**
  - [ ] Insert n8n row with `phone_number = null` (if the n8n table allows it).
  - [ ] Open the tab.
- **Expected:** The row does not appear.

---

**TC-PHONE-08** — Match: n8n phone with whitespace inside
- **Severity:** P2
- **Steps:**
  - [ ] Insert n8n row with `phone_number = "555 100 0001"` (spaces inside, 10 digits if spaces stripped).
  - [ ] Confirm Lead A has `(555) 100-0001` in Supabase.
  - [ ] Open the tab.
- **Expected:** Lead A's row appears. `replace(/\D/g, '')` strips the spaces, leaving 10 digits, which normalizes to `+15551000001`.

---

**TC-PHONE-09** — Match: n8n phone with parentheses and dashes
- **Severity:** P2
- **Steps:**
  - [ ] Insert n8n row with `phone_number = (555) 100-0001`.
  - [ ] Confirm Lead A has the same phone stored (or in E.164 form).
  - [ ] Open the tab.
- **Expected:** Lead A's row appears.

---

**TC-PHONE-10** — Multi-lead phone collision (same phone in two studios)
- **Severity:** P1
- **Steps:**
  - [ ] Insert two leads in two different studios (Studio 1 and Studio 2) that share `phone = +15551000004`.
  - [ ] Insert one n8n row with `phone_number = +15551000004`.
  - [ ] Log in as super_admin. Open the tab.
  - [ ] Observe which lead's `studio_id` is attached to the row.
- **Expected:** Exactly one row appears (not two). The server action uses `leadByPhone.has(norm)` to prevent overwriting with a second match — the first lead encountered by the Supabase query (ordered by `id ASC`) wins. The row is visible to super_admin and to the studio_owner of whichever studio's lead came first.
- **Note:** This is a known edge case documented in the spec as a "data issue surfaced separately." The test verifies it doesn't crash or show duplicate rows — not that it picks the "correct" lead.

---

**TC-PHONE-11** — Pagination: leads beyond position 1000 are matched (AMLS 1786-lead case)
- **Severity:** P0
- **Steps:**
  - [ ] Confirm that the Supabase `leads` table has more than 1000 rows (AMLS currently has 1786). If fewer exist in the test environment, skip this test and document it.
  - [ ] Identify a lead whose `id` is beyond position 1000 when leads are ordered by `id ASC` — e.g., Cristobal at id 65 is a known real-world case, but use a test lead beyond row 1000 to avoid touching real data.
  - [ ] Insert a pending n8n row whose `phone_number` matches that high-position lead's phone.
  - [ ] Open the Scheduled Callbacks tab.
- **Expected:** The row appears. Without the `.range()` pagination loop, leads beyond position 1000 would have been silently skipped, causing their callbacks to show as orphans and be hidden. With the fix, all pages are fetched until all n8n phones are matched or leads are exhausted.
- **Safe production verification:** Cristobal (lead id 65 in production) has a real pending callback. To verify the pagination is working without touching his row: after the tab loads, confirm his row is visible (it should be, since his phone has already been matched in prior runs). Do NOT cancel it.

---

### Category 3: Cancel — Happy Path

---

**TC-CANCEL-01** — Full cancel happy path
- **Severity:** P0
- **Steps:**
  - [ ] Insert a pending n8n row for Lead A.
  - [ ] Log in as studio_owner or studio_staff. Open the Scheduled Callbacks tab. Confirm Lead A's row is visible.
  - [ ] Hover over Lead A's row. Verify the PhoneOff icon becomes fully visible (opacity increases to 1).
  - [ ] Move the mouse away. Verify the PhoneOff icon returns to low opacity (0.4).
  - [ ] Hover again, click the PhoneOff icon.
  - [ ] Verify the cancel confirmation modal opens. Read the modal copy: confirm it says "Cancel scheduled callback?" and includes Lead A's name and scheduled time.
  - [ ] Click "Cancel Callback".
  - [ ] Observe: the "Cancel Callback" button shows a spinner and "Cancelling…" text while the request is in flight.
  - [ ] Observe: after success, the modal closes, Lead A's row disappears from the table, and a green success toast appears: "Callback cancelled for Test Callback" (or whatever name was in the n8n row).
  - [ ] Open the n8n AI Callback data table and verify the row now has `called_at` stamped (not null).
- **Expected:** Full flow completes successfully. One row was in the table before; zero after cancel.

---

**TC-CANCEL-02** — Cancel does not open drawer (stopPropagation)
- **Severity:** P0
- **Steps:**
  - [ ] Insert a pending n8n row for Lead A.
  - [ ] Open the Scheduled Callbacks tab. Confirm Lead A's row is visible.
  - [ ] Click the PhoneOff cancel icon on Lead A's row (not anywhere else on the row).
  - [ ] While the cancel modal is open, observe whether the `CallDetailDrawer` appears.
  - [ ] Dismiss the modal with "Keep Callback".
- **Expected:** The cancel modal opens. The `CallDetailDrawer` does NOT open — `e.stopPropagation()` prevents the row's `onClick` from firing. `openingDetailFor` remains null. Row opacity stays at 1 (not 0.6).
- **Code ref:** `components/follow-ups/scheduled-callbacks-table.tsx` line ~300: `onClick={e => { e.stopPropagation(); setConfirmTarget(row) }}`

---

**TC-CANCEL-03** — Cancel updates the row count footer
- **Severity:** P1
- **Steps:**
  - [ ] Insert two pending n8n rows (Lead A and Lead B).
  - [ ] Open the Scheduled Callbacks tab. Verify the footer shows "2 scheduled callbacks".
  - [ ] Cancel Lead A's row.
  - [ ] Verify the footer now shows "1 scheduled callback" (singular form).
  - [ ] Cancel Lead B's row.
  - [ ] Verify the footer disappears (it only shows when rows.length > 0).
- **Expected:** Footer count updates correctly after each cancel. Singular/plural phrasing is correct.

---

**TC-CANCEL-04** — Cancel shows correct name when both first and last name are present
- **Severity:** P1
- **Steps:**
  - [ ] Insert n8n row with `first_name = "Jane"`, `last_name = "Smith"`.
  - [ ] Open the tab. Confirm Name column shows "Jane Smith".
  - [ ] Click the cancel button. Read the modal body.
  - [ ] Confirm the modal says "... will not call **Jane Smith** at the scheduled time."
  - [ ] After confirming, check the success toast says "Callback cancelled for Jane Smith".
- **Expected:** Full name used consistently across table, modal, and toast.

---

**TC-CANCEL-05** — Cancel shows "—" in Name column when both first and last name are null
- **Severity:** P2
- **Steps:**
  - [ ] Insert n8n row with `first_name = null`, `last_name = null`.
  - [ ] Open the tab. Verify the Name column shows "—" (em-dash, not the literal string "null" or empty string).
  - [ ] Click the cancel button. Verify the modal still opens and the description uses "—" where the name would be.
- **Expected:** Null names render as "—" in table and modal. No crash.

---

### Category 4: Cancel — Race Path (Already Called)

---

**TC-RACE-01** — n8n returns rowsUpdated: 0 (AI already made the call)
- **Severity:** P1
- **Steps:**
  - [ ] Insert a pending n8n row for Lead A.
  - [ ] Manually stamp `called_at = now()` on that row in the n8n data table (simulating the AI agent firing between the user's list-fetch and cancel-click).
  - [ ] Open the Scheduled Callbacks tab. The row may still be visible from the earlier list-fetch.
  - [ ] Click the PhoneOff cancel button. Confirm in the modal.
  - [ ] Observe the response.
- **Expected:**
  - The server action calls the cancel webhook. n8n's compound filter (`id = X AND called_at IS NULL`) matches nothing, so n8n returns `rowsUpdated: 0`.
  - The row is still removed from the UI (optimistic removal regardless of rowsUpdated value).
  - An amber warning toast appears: "Callback was already made by the AI agent".
  - No error toast. No crash.

---

**TC-RACE-02** — Two staff members cancel the same row simultaneously
- **Severity:** P1
- **Steps:**
  - [ ] Insert a pending n8n row for Lead E.
  - [ ] Open the Scheduled Callbacks tab in two browser sessions simultaneously (Staff User 1 and Staff User 2, both in Studio 1).
  - [ ] Both users click the PhoneOff button on Lead E's row at nearly the same time.
  - [ ] The first request reaches n8n and stamps `called_at`. The second request finds `called_at IS NULL` is no longer true.
- **Expected:**
  - First user: success toast "Callback cancelled for Test Callback". Row removed.
  - Second user: warning toast "Callback was already made by the AI agent" (rowsUpdated: 0). Row removed from second user's view too.
  - In n8n, the row has exactly one `called_at` timestamp — not overwritten. (n8n's `AND called_at IS NULL` filter makes this idempotent.)

---

### Category 5: Cancel — Error Paths

---

**TC-ERR-01** — n8n cancel webhook returns 5xx
- **Severity:** P0
- **Steps:**
  - [ ] Simulate a 5xx from the cancel webhook. The easiest way is to temporarily set `N8N_SCHEDULED_CALLBACKS_CANCEL_URL` to an invalid URL or a URL that returns 500. Alternatively, deactivate the cancel webhook node in n8n temporarily.
  - [ ] Insert a pending row for Lead A. Open the tab.
  - [ ] Click cancel. Confirm in the modal.
- **Expected:**
  - The "Cancel Callback" button shows "Cancelling…" spinner.
  - After the timeout/error, a red error toast appears: the message contains "Failed to cancel callback" (or the actual error text from the action).
  - The modal stays open (it does not auto-close on error).
  - Lead A's row remains in the table.
  - The PhoneOff button re-enables (cancellingId is cleared in the `finally` block).
  - n8n row is not stamped (verify in n8n table editor).
- **Restore:** Re-enable the cancel URL before continuing.

---

**TC-ERR-02** — n8n list webhook fails on initial tab load
- **Severity:** P0
- **Steps:**
  - [ ] Temporarily set `N8N_SCHEDULED_CALLBACKS_LIST_URL` to an invalid URL or deactivate the list webhook.
  - [ ] Navigate to `/follow-ups`. Click the "Scheduled Callbacks" tab.
- **Expected:**
  - A 3-row loading skeleton appears briefly.
  - The error state renders: the error message text appears in the table body, and a "Retry" button appears below it.
  - The page does not crash or throw a white screen.
  - The other two tabs (Follow-ups, Callback Requests) are unaffected.
- **Restore:** Re-enable the list URL.

---

**TC-ERR-03** — Retry button re-fetches after error
- **Severity:** P1
- **Steps:**
  - [ ] Reproduce the error state from TC-ERR-02.
  - [ ] While in the error state, restore the list webhook.
  - [ ] Click the "Retry" button in the error state.
- **Expected:** The table re-enters the loading state (skeleton rows appear), then resolves with the correct row data. No page refresh required.

---

**TC-ERR-04** — Webhook secret mismatch (misconfigured env)
- **Severity:** P0
- **Steps:**
  - [ ] Temporarily change `N8N_SCHEDULED_CALLBACKS_SECRET` in `.env.local` to a wrong value (e.g. append `_WRONG`). Restart the dev server.
  - [ ] Navigate to the Scheduled Callbacks tab.
- **Expected:**
  - n8n returns 401. The error message in the table body should surface a string containing "401" or "webhook not configured". It must not show an empty table — it must show the error state.
  - No crash, no white screen.
- **Restore:** Fix the secret and restart.

---

**TC-ERR-05** — Double-click cancel button prevented
- **Severity:** P1
- **Steps:**
  - [ ] Insert a pending row for Lead A.
  - [ ] Open the tab. Click the PhoneOff icon to open the modal.
  - [ ] Click "Cancel Callback" in the modal. Immediately click it again before the request returns.
- **Expected:**
  - The button is visually disabled (opacity reduced, `disabled` attribute set) after the first click.
  - Only one cancel request is sent to n8n. Verify in n8n that `called_at` is stamped exactly once.
  - No duplicate toast.

---

### Category 6: Refresh Behaviors

---

**TC-REFRESH-01** — Manual Refresh button on Scheduled Callbacks tab
- **Severity:** P1
- **Steps:**
  - [ ] Open the Scheduled Callbacks tab. Note the current row count.
  - [ ] In another browser tab, manually stamp `called_at` on one pending row directly in n8n (simulating the AI calling the lead). Do NOT cancel via the UI.
  - [ ] Return to the AMLS tab. Note the table has NOT auto-updated (no Realtime subscription).
  - [ ] Click the Refresh button (the circular arrow icon in the toolbar).
- **Expected:**
  - The table re-enters the loading state momentarily.
  - The stamped row disappears from the table on re-render.
  - Row count footer updates.
  - The Refresh button sends the trigger to the `ScheduledCallbacksTable` component (via `scheduledRefreshTrigger` state increment in `follow-ups-shell.tsx` `handleRefresh`).

---

**TC-REFRESH-02** — Auto-refresh on window focus (alt-tab away and back)
- **Severity:** P1
- **Steps:**
  - [ ] Open the Scheduled Callbacks tab in the browser.
  - [ ] In another tab or window, manually stamp `called_at` on one pending n8n row.
  - [ ] Alt-tab away from the browser (or click another application to blur the browser window).
  - [ ] Alt-tab back to the browser.
- **Expected:**
  - The window `focus` event fires, triggering `load()` in `ScheduledCallbacksTable`.
  - The table re-fetches. The stamped row disappears without the user clicking Refresh.

---

**TC-REFRESH-03** — Refresh while already loading (no double-fetch)
- **Severity:** P2
- **Steps:**
  - [ ] Open the Scheduled Callbacks tab (loading state begins).
  - [ ] While the skeleton is still visible (before data arrives), click the Refresh button repeatedly.
- **Expected:**
  - No crash.
  - The table resolves to the correct state once the first fetch completes. Subsequent refresh clicks during loading are either no-ops or queue a second fetch — but must not leave the table in a permanently broken state.
  - No duplicate rows.

---

**TC-REFRESH-04** — Refresh button on Follow-ups tab and Callback Requests tab still works
- **Severity:** P1
- **Steps:**
  - [ ] Navigate to the Follow-ups tab. Click Refresh.
- **Expected:** The quality reviews table re-fetches. The `handleRefresh` function calls `loadData` (not `setScheduledRefreshTrigger`) when `tab !== 'scheduled_callbacks'`.
  - [ ] Navigate to the Callback Requests tab. Click Refresh.
- **Expected:** Same behavior — quality reviews re-fetched.

---

**TC-REFRESH-05** — Auto-refresh only fires when Scheduled Callbacks tab is mounted
- **Severity:** P2
- **Steps:**
  - [ ] Navigate to the Follow-ups tab (first tab).
  - [ ] Alt-tab away and return.
- **Expected:** The window focus listener is attached inside `ScheduledCallbacksTable`. Since that component is not mounted (only Follow-ups tab is active), the auto-refresh for scheduled callbacks does NOT fire. No extra n8n fetch occurs.
- **Note:** `ScheduledCallbacksTable` is only rendered when `tab === 'scheduled_callbacks'`, so the focus listener is registered on mount and cleaned up on unmount.

---

### Category 7: UI States

---

**TC-UI-01** — Initial loading skeleton
- **Severity:** P1
- **Steps:**
  - [ ] Open the Scheduled Callbacks tab (with the list webhook responding slowly — throttle in DevTools Network to "Slow 3G" if needed).
  - [ ] Observe the table before data arrives.
- **Expected:**
  - Three skeleton rows appear. Each row has 7 cells with shimmer animation.
  - Column headers are still visible above the skeleton rows.
  - No real data is partially visible.
  - The skeleton matches the density of the other Follow-ups tabs.

---

**TC-UI-02** — Empty state when no pending rows
- **Severity:** P1
- **Steps:**
  - [ ] Ensure there are no pending rows in the n8n AI Callback table that match any lead in the user's studio (either the table is genuinely empty, or all matching rows have `called_at` stamped).
  - [ ] Open the Scheduled Callbacks tab.
- **Expected:** After the loading skeleton resolves, a single centered message appears: "No scheduled callbacks at this time." It uses `var(--color-text-muted)` color. No row count footer appears.

---

**TC-UI-03** — Populated state — sort order (ascending callback_time)
- **Severity:** P1
- **Steps:**
  - [ ] Insert three pending n8n rows: one with `callback_time` in 1 hour, one in 2 hours, one in 3 hours.
  - [ ] Open the Scheduled Callbacks tab.
- **Expected:** Rows appear in ascending `callback_time` order (the soonest callback first). The sort is applied server-side by the `fetchScheduledCallbacks` action.

---

**TC-UI-04** — Null fields render as em-dash in all columns
- **Severity:** P1
- **Steps:**
  - [ ] Insert a pending n8n row with `email = null`, `dance_interest = null`, `reason = null`. Ensure the phone matches a known lead.
  - [ ] Open the tab. Inspect the row.
- **Expected:**
  - Email column: "—" in `var(--color-text-muted)`.
  - Reason column: "—" in `var(--color-text-muted)`.
  - Dance Interest column: "—" in `var(--color-text-muted)`.
  - No column shows the literal text "null", "undefined", or an empty cell.

---

**TC-UI-05** — Singular vs plural row count footer
- **Severity:** P2
- **Steps:**
  - [ ] With exactly 1 pending row visible, open the tab. Check the footer.
- **Expected:** Footer shows "1 scheduled callback" (singular, no "s").
  - [ ] Add a second row. Refresh. Check the footer.
- **Expected:** Footer shows "2 scheduled callbacks" (plural).

---

**TC-UI-06** — Filter pill is hidden on Scheduled Callbacks tab
- **Severity:** P1
- **Steps:**
  - [ ] Navigate to the Follow-ups tab. Verify the Filter pill is visible in the toolbar.
  - [ ] Click the Scheduled Callbacks tab. Verify the Filter pill is gone.
  - [ ] Click back to the Follow-ups tab. Verify the Filter pill reappears.
  - [ ] Click the Callback Requests tab. Verify the Filter pill is visible there too.
- **Expected:** The Filter pill is conditionally hidden only on the `scheduled_callbacks` tab. The Refresh button remains visible on all three tabs.

---

**TC-UI-07** — KPI cards are unaffected by this tab
- **Severity:** P1
- **Steps:**
  - [ ] Note the values of all three KPI cards (Follow-ups Needed, Callback Requests, Pass Rate).
  - [ ] Click the Scheduled Callbacks tab.
  - [ ] Verify the KPI cards show the same values (they are not re-fetched or reset when switching to this tab).
- **Expected:** KPI card values are stable across tab switches. The `callbackCount` KPI reflects `call_reviews.callback_requested = true`, not the n8n pending queue — these are independent.

---

### Category 8: Modal UX

---

**TC-MODAL-01** — "Keep Callback" closes modal without cancelling
- **Severity:** P0
- **Steps:**
  - [ ] Insert a pending row for Lead A.
  - [ ] Open the tab. Click the PhoneOff icon. The modal opens.
  - [ ] Click the "Keep Callback" button (the left/secondary button in the modal footer).
- **Expected:**
  - The modal closes immediately.
  - No cancel request is sent to n8n.
  - Lead A's row remains in the table unchanged.
  - No toast appears.
  - Verify in n8n that `called_at` remains null.

---

**TC-MODAL-02** — Clicking the backdrop (overlay) closes the modal
- **Severity:** P1
- **Steps:**
  - [ ] Open the cancel modal for any row.
  - [ ] Click anywhere on the dark overlay outside the modal card.
- **Expected:** The modal closes. No cancel request is sent. The row remains.

---

**TC-MODAL-03** — X button (top-right) closes the modal
- **Severity:** P1
- **Steps:**
  - [ ] Open the cancel modal.
  - [ ] Click the X icon in the top-right corner of the modal card.
- **Expected:** Modal closes. No cancel sent. Row remains.

---

**TC-MODAL-04** — Modal cannot be dismissed while cancel is in progress
- **Severity:** P1
- **Steps:**
  - [ ] Open the cancel modal.
  - [ ] Click "Cancel Callback". While the spinner is showing ("Cancelling…" state), click the "Keep Callback" button, the X button, and the backdrop overlay.
- **Expected:**
  - `onClose` checks `if (cancellingId !== null) return` — so all three dismissal attempts are no-ops while in-flight.
  - The modal stays open.
  - The cancel completes and then the modal closes normally.

---

**TC-MODAL-05** — Modal shows amber styling (not red)
- **Severity:** P1
- **Steps:**
  - [ ] Open the cancel modal for any row.
  - [ ] Inspect the icon container color, the "Cancel Callback" button background, and the PhoneOff icon color.
- **Expected:**
  - The circular icon background is `rgba(217,119,6,0.12)` (amber tint).
  - The PhoneOff icon color is `#d97706` (amber).
  - The "Cancel Callback" button background is `#d97706` (amber, not red).
  - This visually communicates "reversible action" vs "destructive delete".

---

**TC-MODAL-06** — Modal shows correct lead name and scheduled time
- **Severity:** P1
- **Steps:**
  - [ ] Insert a row with `first_name = "Maria"`, `last_name = "Lopez"`, `callback_time = 2030-06-15T09:00:00.000Z`.
  - [ ] Open the cancel modal.
- **Expected:** Modal body text reads: "The AI agent will not call **Maria Lopez** at [formatted date/time]." The time is formatted via `formatDateTime()` — verify it shows a human-readable local time, not a raw ISO string.

---

### Category 9: Hover UX

---

**TC-HOVER-01** — Cancel button is visible at low opacity at rest
- **Severity:** P1
- **Steps:**
  - [ ] Open the Scheduled Callbacks tab with at least one row.
  - [ ] Without hovering over any row, observe the PhoneOff icon.
- **Expected:** The icon is visible but subdued — `opacity: 0.4`. It should be noticeable on touch devices but unobtrusive on desktop.

---

**TC-HOVER-02** — Cancel button reaches full opacity on row hover
- **Severity:** P1
- **Steps:**
  - [ ] Hover over a row (anywhere on the row, not just the button cell).
  - [ ] Observe the PhoneOff button.
- **Expected:** The button transitions to `opacity: 1` and turns amber (`color: #d97706`) with an amber background tint (`rgba(217,119,6,0.12)`). The row background also changes to `var(--color-surface)`.
- **Note:** The opacity/color transition is driven by `onMouseEnter`/`onMouseLeave` on the button element, not CSS group hover. Hovering elsewhere on the row (not the button) changes the row bg via CSS `hover:bg-[var(--color-surface)]` but does not directly change the button opacity — verify this works as expected end to end.

---

**TC-HOVER-03** — Cancel button stays fully visible while a cancel is in progress on that row
- **Severity:** P1
- **Steps:**
  - [ ] Click the cancel button, confirm in the modal. While the row is in `isCancelling = true` state (spinner showing):
  - [ ] Move the mouse away from the row.
- **Expected:** The button remains at `opacity: 1` (not falling back to 0.4) because `isCancelling` keeps it pinned. The `onMouseLeave` handler checks `isCancelling` before resetting opacity.

---

**TC-HOVER-04** — Cancel button on non-cancelling row is unaffected by another row's cancel
- **Severity:** P2
- **Steps:**
  - [ ] Insert two pending rows for Lead A and Lead B.
  - [ ] Begin cancelling Lead A (spinner showing on Lead A's row).
  - [ ] Hover over Lead B's row.
- **Expected:** Lead B's cancel button behaves normally — low opacity at rest, full opacity on hover. Lead A's spinner is independent.

---

### Category 10: Dark Mode

---

**TC-DARK-01** — Tab label and active underline render correctly in dark mode
- **Severity:** P1
- **Steps:**
  - [ ] Switch to dark mode via Settings > Appearance.
  - [ ] Navigate to `/follow-ups`. Click the Scheduled Callbacks tab.
- **Expected:** The active tab label uses `var(--color-accent)` (blue). The underline indicator uses `var(--color-accent)`. The tab background and text are readable against the dark `var(--color-bg)`.

---

**TC-DARK-02** — Table rows render correctly in dark mode
- **Severity:** P1
- **Steps:**
  - [ ] In dark mode, with at least one row visible, inspect:
    - Row background: `var(--color-bg)` (dark: `#111111`)
    - Row hover background: `var(--color-surface)` (dark: `#1a1a1a`)
    - Primary text: `var(--color-text-primary)` (dark: `rgba(255,255,255,0.92)`)
    - Secondary text: `var(--color-text-secondary)` (dark: `rgba(255,255,255,0.50)`)
    - Em-dash placeholders: `var(--color-text-muted)` (dark: `rgba(255,255,255,0.30)`)
    - Table borders: `var(--color-border)` (dark: `#2a2a2a`)
- **Expected:** All text is readable. No white-on-white or black-on-black situations. No hardcoded hex values override the dark tokens.

---

**TC-DARK-03** — Skeleton shimmer renders correctly in dark mode
- **Severity:** P2
- **Steps:**
  - [ ] In dark mode, navigate to the Scheduled Callbacks tab while the list webhook is slow.
  - [ ] Observe the 3 skeleton rows during the loading state.
- **Expected:** The shimmer animation uses the dark-mode surface tokens (`var(--color-surface)` and `var(--color-surface-hover)`) automatically. The shimmer should be visible but subtle — not a glaring white flash.

---

**TC-DARK-04** — Cancel confirmation modal renders correctly in dark mode
- **Severity:** P1
- **Steps:**
  - [ ] In dark mode, open the cancel confirmation modal.
  - [ ] Inspect:
    - Modal card background: `var(--color-bg)`
    - Modal border: `var(--color-border)`
    - Icon container: `rgba(217,119,6,0.12)` — semi-transparent, should look amber-tinted against dark bg
    - Heading text: `var(--color-text-primary)`
    - Body text: `var(--color-text-secondary)`
    - "Keep Callback" button: `var(--color-bg)` bg, `var(--color-text-primary)` text, `var(--color-border)` border
    - "Cancel Callback" button: amber `#d97706` bg, white text
    - Backdrop overlay: `bg-black/50` (fine in both modes)
- **Expected:** All elements readable. Amber accent is visible against dark background (amber on near-black has sufficient contrast).

---

**TC-DARK-05** — Toast variants render correctly in dark mode
- **Severity:** P1
- **Steps:**
  - [ ] In dark mode, trigger a successful cancel. Observe the green success toast.
  - [ ] Trigger a race cancel (rowsUpdated: 0). Observe the amber warning toast.
  - [ ] Trigger an error. Observe the red error toast.
- **Expected:**
  - All three toasts: `var(--color-bg)` background (dark: `#111111`), with a 2px colored left border matching the variant.
  - Toast text: `var(--color-text-body)` — readable against dark background.
  - The toast border colors: green `#16a34a`, amber `#d97706`, red `#dc2626` — all visible against dark bg.
  - The icon inside each toast uses the correct variant color.

---

**TC-DARK-06** — Error state and Retry button in dark mode
- **Severity:** P2
- **Steps:**
  - [ ] In dark mode, reproduce the error state (deactivate the list webhook).
  - [ ] Inspect the error text and Retry button.
- **Expected:** Error text uses `var(--color-text-muted)`. Retry button has `var(--color-bg)` background, `var(--color-border)` border, `var(--color-text-primary)` text — all readable in dark mode.

---

**TC-DARK-07** — Row opacity feedback during drawer fetch renders correctly in dark mode
- **Severity:** P2
- **Steps:**
  - [ ] In dark mode, click a row with a prior call (triggering the `fetchMostRecentCallForLead` fetch).
  - [ ] Observe the row during the fetch (before the drawer opens).
- **Expected:** The row dims to `opacity: 0.6` while `isOpeningDetail = true`. The text and row background should still be distinguishable even at reduced opacity.

---

### Category 11: Row-Click — CallDetailDrawer (NEW)

---

**TC-DRAWER-01** — Row click opens CallDetailDrawer with most recent call
- **Severity:** P0
- **Steps:**
  - [ ] Ensure Lead A has at least one call record in the `calls` table.
  - [ ] Insert a pending n8n row for Lead A.
  - [ ] Open the Scheduled Callbacks tab. Click anywhere on Lead A's row (not on the PhoneOff icon).
  - [ ] Wait for the drawer to open.
- **Expected:**
  - While the fetch is in flight, Lead A's row dims to `opacity: 0.6`.
  - The `CallDetailDrawer` slides open showing the lead's most recent call.
  - The drawer content matches the call record with the latest `created_at` for Lead A's `lead_id` in the `calls` table.
  - Row opacity returns to 1 after the drawer opens.
  - `openingDetailFor` is reset to null.

---

**TC-DRAWER-02** — Row click when lead has no prior calls shows warning toast (no drawer)
- **Severity:** P0
- **Steps:**
  - [ ] Lead C has no call records in the `calls` table. Insert a pending n8n row for Lead C.
  - [ ] Open the Scheduled Callbacks tab. Click Lead C's row.
- **Expected:**
  - Row dims to `opacity: 0.6` briefly while the fetch is in flight.
  - `fetchMostRecentCallForLead` returns null.
  - The `CallDetailDrawer` does NOT open.
  - An amber warning toast appears: "No call history yet for [Lead C's name]" (formatted via `formatName`).
  - Row opacity returns to 1.
  - `openingDetailFor` is reset to null.

---

**TC-DRAWER-03** — Double-click guard: second row click ignored while fetch is in flight
- **Severity:** P1
- **Steps:**
  - [ ] Insert pending n8n rows for Lead A and Lead B.
  - [ ] Click Lead A's row to start the `fetchMostRecentCallForLead` fetch.
  - [ ] While Lead A's row is dimmed (fetch in flight), click Lead B's row.
- **Expected:**
  - Lead B's row click is ignored (the `handleRowClick` function returns early because `openingDetailFor !== null`).
  - Only one fetch is in flight at a time.
  - The drawer opens for Lead A (the first click) and Lead B's click produces no effect.
  - No crash, no duplicate fetch, no two drawers stacking.

---

**TC-DRAWER-04** — Drawer shows correct data: lead name and most recent call
- **Severity:** P1
- **Steps:**
  - [ ] Lead A has two call records: one from 3 days ago and one from yesterday.
  - [ ] Insert a pending n8n row for Lead A. Open the tab and click Lead A's row.
- **Expected:**
  - The drawer shows the call from yesterday (the most recent by `created_at DESC`).
  - The lead name in the drawer matches Lead A's name from the `leads` table (fetched alongside the call via `fetchMostRecentCallForLead`'s parallel query).
  - The older call from 3 days ago is NOT shown.

---

**TC-DRAWER-05** — Drawer can be closed and a different row's drawer opened
- **Severity:** P1
- **Steps:**
  - [ ] Insert pending n8n rows for Lead A and Lead B (both have prior calls).
  - [ ] Click Lead A's row. Wait for the drawer to open.
  - [ ] Close the drawer (X button or Escape).
  - [ ] Click Lead B's row. Wait for the drawer to open.
- **Expected:**
  - Lead A's drawer closes normally.
  - Lead B's drawer opens with Lead B's most recent call.
  - `selectedCall` state is cleared on close and replaced with Lead B's call data on the second click.
  - No stale Lead A data appears in Lead B's drawer.

---

**TC-DRAWER-06** — Row click error (fetch throws) shows error toast
- **Severity:** P1
- **Steps:**
  - [ ] Simulate a `fetchMostRecentCallForLead` failure — the easiest approach is to temporarily revoke the Supabase session mid-test (DevTools > delete auth cookie), then click a row.
- **Expected:**
  - Row dims briefly, then returns to `opacity: 1`.
  - A red error toast appears with the error message.
  - `CallDetailDrawer` does NOT open.
  - `openingDetailFor` is reset to null.
  - No crash.

---

**TC-DRAWER-07** — Cancel click while drawer is open does not re-open a second drawer
- **Severity:** P1
- **Steps:**
  - [ ] Insert a pending n8n row for Lead A (has prior calls).
  - [ ] Click Lead A's row. The drawer opens.
  - [ ] While the drawer is open, click the PhoneOff cancel icon on Lead A's row.
- **Expected:**
  - `e.stopPropagation()` fires, so the row's `onClick` does NOT trigger.
  - The cancel modal opens on top of (or instead of) the drawer.
  - The drawer remains open in the background (or closes cleanly depending on z-index) but does NOT re-fetch.
  - `openingDetailFor` is not set by the cancel click.

---

### Category 12: No-Realtime Verification

---

**TC-RT-01** — No auto-update when n8n trigger stamps called_at (no Realtime)
- **Severity:** P1
- **Steps:**
  - [ ] Insert a pending n8n row for Lead A.
  - [ ] Open the Scheduled Callbacks tab. Confirm Lead A's row is visible.
  - [ ] In the n8n data table editor, manually stamp `called_at = now()` on Lead A's row (simulating the 30-min trigger calling the lead).
  - [ ] Wait 30 seconds. Do NOT click Refresh or change windows.
- **Expected:** Lead A's row does NOT disappear from the UI automatically. There is no Supabase Realtime subscription for n8n tables. The row stays visible until a manual refresh or window focus event triggers a re-fetch.
- **This is expected/correct behavior** — document it for staff so they know to refresh when expecting up-to-date data.

---

**TC-RT-02** — No Supabase Realtime subscription opened for this tab
- **Severity:** P2
- **Steps:**
  - [ ] Open the browser DevTools > Network tab. Filter by WebSocket connections.
  - [ ] Navigate to the Scheduled Callbacks tab.
  - [ ] Look for any new Supabase Realtime channel subscription for the n8n table.
- **Expected:** No new Realtime WebSocket frames for an n8n or scheduled-callbacks channel are opened. The existing `follow-ups-realtime` channel (for `call_reviews`) is already open from the shell component, but no additional channel is created for the Scheduled Callbacks tab.

---

## Regression Risks

These are existing features that the changes for Scheduled Callbacks could accidentally break. Run these spot-checks after completing the new feature tests.

---

**RR-01** — Follow-ups tab (first tab) — existing behavior unchanged
- [ ] Navigate to `/follow-ups`. Default tab should still be "Follow-ups" (not "Scheduled Callbacks").
- [ ] Verify the Follow-ups table loads and paginates correctly.
- [ ] Verify sort by column header works.
- [ ] Verify clicking a row opens the CallDetailDrawer.

---

**RR-02** — Callback Requests tab (second tab) — existing behavior unchanged
- [ ] Click the "Callback Requests" tab.
- [ ] Verify rows load, pagination works, and clicking a row opens the drawer.
- [ ] Verify the tab's empty state message ("No callback requests found.") still appears when appropriate.

---

**RR-03** — Filter pill on Follow-ups tab still works
- [ ] On the Follow-ups tab, click the Filter pill. Verify the filter panel opens.
- [ ] Set a Direction filter. Verify results update.
- [ ] Clear the filter. Verify full results return.

---

**RR-04** — Filter pill on Callback Requests tab still works
- [ ] Same as RR-03 but on the Callback Requests tab.

---

**RR-05** — Filter state does not persist incorrectly across tabs
- [ ] Set a Grade filter on the Follow-ups tab. Switch to Scheduled Callbacks. Switch back to Follow-ups.
- [ ] Verify the Grade filter is still active and the count badge shows the correct number.

---

**RR-06** — Toast provider in other pages still works
- [ ] Perform an action that triggers a toast on another page (e.g., save a lead inline, send a message in Conversations).
- [ ] Verify toasts still appear correctly in those contexts.
- [ ] The toast provider was extended with `showSuccess` and `showWarning` — verify that the existing `showError` API is unaffected.

---

**RR-07** — KPI card values are correct
- [ ] Verify the "Follow-ups Needed" and "Callback Requests" KPI values on the Follow-ups page match the row counts on the respective tabs.
- [ ] Navigate to the Scheduled Callbacks tab and back. Verify KPI values did not change.

---

**RR-08** — `ScheduledCallback` type does not conflict with existing types
- [ ] In the Leads page, confirm leads still load and inline editing works.
- [ ] In Call History, confirm the existing `Call` type-dependent features (drawers, badges) work.
- [ ] Check for TypeScript build errors: `npm run build` should complete without errors.

---

**RR-09** — Refresh button on other tabs does not trigger scheduled callback re-fetch
- [ ] On the Follow-ups tab, click Refresh. Verify no n8n webhook call is made to the scheduled-callbacks-list URL (check server logs or n8n execution history — no new execution should appear).

---

**RR-10** — Call History CallDetailDrawer is unaffected
- [ ] Navigate to Call History. Click any row. Verify the CallDetailDrawer opens normally with the expected content.
- [ ] The same drawer component is now used by Scheduled Callbacks — verify no shared state leaks between the two pages.

---

## What We Are Explicitly NOT Testing

The following are out of scope for this test plan.

- **n8n workflow internals** — whether the compound filter SQL is correct, whether the n8n data table update node syntax is valid (`keyName`/`keyValue`/`condition: "isEmpty"`), whether the Header Auth credential is bound correctly. These are Joshua's responsibility to test via the n8n UI.
- **The 30-minute auto-trigger behavior** — this is existing VAF functionality, unchanged by this feature.
- **Reschedule callback** — not in MVP scope.
- **Bulk cancel** — not in MVP scope.
- **Cancel from CallDetailDrawer or Call History** — Scheduled Callbacks tab is the only entry point in v1.
- **Persistent filters on the Scheduled Callbacks tab** — no filter UI in v1; nothing to test.
- **Polling / live updates** — there is no 30s poll; confirmed no-Realtime is the intended design (TC-RT-01 verifies this).
- **Phone number validation on the Retell/n8n side** — how the AI agent stores `phone_number` when scheduling the callback is out of scope (that's VAF logic).
- **Pagination on the Scheduled Callbacks tab** — not implemented in v1; all rows shown at once.
- **Activity log entries for cancellations** — the spec explicitly calls this out of scope.
- **Audit trail of who cancelled** — no `cancelled_by` field, no tracking; not testable.
- **The `studio_name` field on ScheduledCallback** — the type interface includes it in the spec draft but the final implementation does not populate it (super_admin multi-studio display is deferred). Verify it does not cause errors if undefined.
- **What the drawer shows when the lead has calls from other studios** — `fetchMostRecentCallForLead` scopes by `studio_id`, so cross-studio calls are excluded by design.

---

## Automated Test Results

**Tests run against:** `normalizePhone()` (pure function mirrored from `app/actions.ts` lines ~2501–2508)
**Test file:** `__tests__/lib/normalize-phone.test.ts`
**Framework:** Vitest 4.1.2

```
Tests run: 29  |  Passed: 29  |  Failed: 0
Duration: 2.05s
```

All 29 cases pass. Coverage includes: null/undefined/empty/whitespace inputs, 10-digit raw, 10-digit formatted (US, dashes, dots, spaces, mixed punctuation), 11-digit no-plus, E.164 passthrough (US and non-US), 9-digit too-short, garbage input, two-side matching symmetry (all format pairs), and non-US number not matching a US lead.

---

## Pass Criteria

The feature is ready to ship when:

1. All P0 tests pass: TC-AUTH-01, TC-AUTH-02, TC-AUTH-06, TC-CANCEL-01, TC-CANCEL-02, TC-DRAWER-01, TC-DRAWER-02, TC-ERR-01, TC-ERR-02, TC-ERR-04, TC-MODAL-01, TC-PHONE-11, and RR-01 through RR-03.
2. All P1 tests pass.
3. No regression in the existing Follow-ups or Callback Requests tab behavior (RR-01 through RR-10).
4. Dark mode is verified for all P1 dark mode cases (TC-DARK-01 through TC-DARK-05, TC-DARK-07).
5. The cross-studio cancel attempt (TC-AUTH-06) is confirmed blocked at the server action layer.
6. The pagination case (TC-PHONE-11) is verified — either by live prod verification (Cristobal row visible) or by inserting a test lead beyond row 1000 in a staging environment.
7. All test data rows inserted during testing have been cleaned up from the n8n AI Callback data table.
