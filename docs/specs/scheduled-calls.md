# Scheduled Calls — spec + cutover runbook

**Status:** app side done and verified. Joshua dev workflow swapped. **Three production
n8n workflows still read the old n8n data tables — cutover NOT done.**
**Last updated:** 2026-07-30

Supersedes the storage half of [`cancel-follow-up-spec.md`](./cancel-follow-up-spec.md).
That doc's List/Cancel webhook contract is dead; its UI/edge-case analysis still applies.

---

## 1. What this delivers

A studio can queue an outbound AI call for a lead at a chosen date and time, from
**Follow-ups → Scheduled Callbacks → “+ Schedule a Call”**. The client's request:

> Manually schedule followups. Like if I wanted the AI to call somebody at a
> specific date and time, I should be able to schedule it in the followups section.

The dialer that makes such calls already existed — a 30-minute n8n schedule
trigger. What was missing was a way for the *app* to put a row in its queue. The
bulk of this work was moving that queue somewhere the app can safely write.

---

## 2. Why the queue moved to Postgres

Pre-053 the queue was n8n data tables, **one per studio**:

| Studio | Data table |
|---|---|
| Lincolnshire | `9U0GXNR5uRUTWUPy` "AI Callback" |
| Schaumburg | `VmEyZDyEjnlYEIBb` "AI Callback Schaumburg" |

Rows carried **no `studio_id`**. Tenant ownership was reconstructed in app code by
paginating every lead and phone-matching. Consequences, all of which existed in
production before this change:

1. **Schaumburg's queue was invisible in the app.** The webhook workflow
   (`DrMdkkkCZBZTu3OS`) was hardcoded to Lincolnshire's table in both its List and
   Cancel nodes.
2. **Cancel silently failed for Schaumburg.** It stamped Lincolnshire's table,
   returned `rowsUpdated: 0`, and the UI optimistically removed the row — while
   the Schaumburg dialer still placed the call.
3. **The tab ignored the studio switcher.** `fetchScheduledCallbacks()` took no
   `studioId` and unioned every studio the caller belonged to.
4. **Cancel was phone-matched**, so it neutralised *every* pending row for a phone.
5. **Orphan rows vanished** — a queued row whose phone matched no visible lead was
   dropped from the list but still dialed.
6. **Isolation was a dropdown.** It failed twice the same way: the Schaumburg
   dialer was cloned pointing at Lincolnshire's live queue (caught pre-go-live,
   see [`n8n-schaumburg-build-log.md`](../n8n-schaumburg-build-log.md) §"Critical
   hazard"), and **the White Rock clone reproduced it** (see §6 below).

`scheduled_calls` (migration 053) has a real `studio_id` with an FK and RLS. A new
studio needs **zero** n8n changes.

---

## 3. What stayed in n8n

The dialer. n8n keeps the 30-minute trigger, the Retell `create-phone-call`
request, and the entire post-dial chain (field options → Notion → lead update).
Only the four storage nodes changed type. The risky machinery was left alone.

```
Retell schedule_ai_callback ─┐
                             ├─→  scheduled_calls (Postgres)  ──→ n8n AI Callback Trigger (30 min)
App "+ Schedule a Call"    ─┘            ▲                              │
                                         └── app list / cancel ─────────┴─→ Retell create-phone-call
                                                                            └─→ stamp called_at
```

---

## 4. Schema

`public.scheduled_calls` — see [migration 053](../../supabase/migrations/053_scheduled_calls.sql)
for the annotated DDL. Notes worth carrying in your head:

- **Three outcome columns, never overloaded.** `called_at` (dialled) /
  `cancelled_at` (a human cancelled) / `skipped_at` (system abandoned it, migration
  054). Pre-053 cancel overloaded `called_at`, making "we called them" and "staff
  cancelled" indistinguishable — 054 deliberately did not repeat that by reusing
  `cancelled_at` for the resume purge. **Pending = all three null**, and
  `idx_scheduled_calls_due` matches exactly that predicate.

### Resume purge (migration 054)

Pausing a voice agent does not defer its queued calls — switching the agent back on
**abandons** them. Only calls queued after the switch-on are dialled.

A trigger on `studios.voice_agent_enabled` (false → true) does the work, not the
dialer guard. The guard only sees rows that are *due*, so a row queued during the
pause with a callback_time next week would have slipped through it. Living in the
database means it holds regardless of who flips the column — the Settings toggle, a
SQL console, a future service — and is atomic with the flip, so there is no window
where the agent is on and a stale row is still dialable. `SECURITY DEFINER` because a
studio_owner's own RLS policy would otherwise filter the purge into a silent partial.

Everything selecting pending rows must carry `skipped_at IS NULL`:
`fetchScheduledCalls`, `scheduleCall`'s duplicate check, `cancelScheduledCall`'s
compare-and-set, and the `Get row(s)` filter in **all four** workflows. Miss one and
abandoned rows get re-read and dialled.

**Verification (2026-07-30, live DB, Joshua Test studio):** paused the studio, queued
a row due in **7 days**, switched the agent on → row came back `skipped_at` set,
`skip_reason='voice_agent_resumed'`, no longer dialable. A row inserted *after* the
switch-on stayed dialable. Both halves of the rule confirmed; test rows removed and
the studio restored. This is a DB trigger so it has no vitest coverage — the live
check above is the evidence.

**Existing backlog needs no manual cleanup.** Schaumburg and White Rock are both
`voice_agent_enabled = false`, so their queued rows purge automatically the first time
either is switched on. Schaumburg's four (Susan Krussel, Pauline Salcedo, Cole Keller,
Chris Kim) remain in `leads` with their inquiry text if anyone wants to call them by
hand.
- **`source`** is `'ai_agent'` or `'manual'`, surfaced as a badge in the UI.
- **`call_note`** is new: free text for *why* we're calling. `reason` was already
  taken by the lead's dance reason (Wedding / For Fun / …), which the post-dial
  field-option resolver consumes, so it was never available for context.
  Named `call_note` to stay unambiguous next to `leads.notes`.
- **`lead_id` is nullable** — an inbound caller can be queued before they exist as
  a lead. The UI handles the null case instead of dropping the row.
- **No unique constraint on pending rows**, deliberately. The Retell insert has
  `onError: continueErrorOutput` wired to an "Unsuccessful Callback Schedule"
  response, so a constraint violation would make the agent tell a live caller the
  callback failed. The app enforces one-pending-per-lead in `scheduleCall` and
  offers "Replace existing" instead.

### Server actions (`app/actions.ts`)

| Action | Notes |
|---|---|
| `fetchScheduledCalls(studioId)` | Pending rows for **one** studio, soonest first. The explicit `.eq` is what scopes super_admins, whose client bypasses RLS. |
| `scheduleCall({ studioId, leadId, callbackTime, callNote })` | Returns a discriminated union; validation failures are **returned, not thrown** (Next.js masks prod throws). Codes: `not_found`, `no_phone`, `past_time`, `bad_time`, `voice_agent_paused`, `duplicate`. |
| `cancelScheduledCall(id)` | Compare-and-set on `called_at IS NULL AND cancelled_at IS NULL`. Returns `{ cancelled: false }` when the dialer won the race, so the UI can say so instead of lying. |

`callbackTime` must be an **absolute ISO instant**. The modal converts the picked
wall-clock time using `naiveTzPartsToUtcIso(..., studio.timezone)` so DST is
handled in exactly one place. Never pass a naive local string.

---

## 5. Known gaps (unchanged by this work, or newly documented)

| # | Gap | Status |
|---|---|---|
| G1 | ~~**Two of three dialers ignore `voice_agent_enabled`.**~~ ✅ **CLOSED — stale as of 2026-08-05.** All three dialers now carry the guard (`Check Voice Agent Setting → Voice Agent Enabled? → Trigger Retell Outbound Call`), verified directly on `gcDhc61cSLTPXOKv`, `Wgg5bQTPJYFsDSn8` and `QNRW2PHkiY0i3dij`. Lincolnshire and White Rock gained theirs some time after this row was written. | ✅ Done |
| G2 | **±30 min precision.** The sweep runs every 30 minutes. The modal uses 30-minute steps and states "dials within 30 minutes" rather than implying to-the-minute. Tighten the trigger to 5–10 min if the client wants closer. | By design, disclosed in UI |
| G8 | **The dialers ignored calling hours entirely.** A callback scheduled from Follow-ups for 03:00 was dialled at 03:00 — only *new inquiries* respected a call window. ✅ **FIXED 2026-08-05** — all three dialers gained a `Call Window Gate` node reading `studios.call_hours`. See [`call-hours.md`](./call-hours.md). | ✅ Done |
| G3 | **Retell API key + `from_number` are inline in the n8n HTTP nodes**, in plaintext, hardcoded per workflow. Lincolnshire prod also hardcodes `agent_id` instead of using `active_outbound_agent_id`. | Not addressed |
| G4 | **`callback_time <= $now` on a data-table `date` column looked unreliable** — row 91 was scheduled 20:05 and stamped 20:00:46 on a real tick. Most other "early" stamps were off-boundary manual dev runs. A real `timestamptz` removes the ambiguity; worth re-checking post-cutover. | Expected to be fixed by 053 |
| G5 | `call_note` → Retell. **n8n half done 2026-07-30** — `Trigger Retell Outbound Call` in the Joshua copy and White Rock now sends `"call_note": "{{ $('Phone Number Formatting').item.json.call_note \|\| '' }}"`. The `\|\| ''` fallback stops a null rendering as the literal string `"null"` in the agent's context. It flows because `Get row(s)` returns every `scheduled_calls` column and `Phone Number Formatting` spreads `...data`. **Still open: the agent's prompt does not reference `{{call_note}}`, so Sarah still cannot read it.** Lincolnshire/Schaumburg also need the same line once swapped (their data tables have no `call_note` column). | Prompt work blocked on G6 |
| G7 | **Resuming a paused voice agent must discard its backlog.** ✅ **FIXED — migration 054.** Joshua's rule: *"when i turn on the agent, dont dial anyone, dial only the future leads who will come after the switch on."* Implemented as a trigger on `studios.voice_agent_enabled` (false → true) that stamps `skipped_at` + `skip_reason='voice_agent_resumed'` on every still-pending row for that studio. **Not** implemented in the dialer guard: that only ever sees rows which are *due*, so a row queued during the pause with a callback_time next week would have survived untouched — exactly the case the rule forbids. Verified end-to-end against the live DB (see §Verification). | ✅ Done 2026-07-30 |
| G6 | **Lincolnshire has three conflicting agent IDs.** `studios.active_outbound_agent_id` = `agent_cd8a872b64a03338e6c54a41a0`, `studios.retell_agent_id` = `agent_c6c4facfa0c12f9d7e1f1a8c83`, but prod's `Trigger Retell Outbound Call` hardcodes `agent_id: agent_a21bd030d52b9d54626fa9f44e`. The dialer therefore ignores `active_outbound_agent_id` entirely, contradicting migration 048's stated premise ("n8n reads this column at call time"). The Leads UI agent dropdown has no effect on scheduled callbacks. **Resolve which agent is authoritative before any prompt edit** — editing `agent_cd8a…` would touch an agent that never receives these calls. | Open — decision needed |

---

## 6. White Rock — mispointing resolved 2026-07-30

`Voice AI Functions (AM White Rock)` (`QNRW2PHkiY0i3dij`) was cloned with **all
four** callback nodes still pointing at `9U0GXNR5uRUTWUPy` — Lincolnshire's live
queue — the same mistake as the Schaumburg clone. It was contained (workflow
inactive, trigger disabled) and never fired — the workflow has zero executions in
its entire history.

⚠️ The `from_number` placeholder `REPLACE_WITH_WHITE_ROCK_NUMBER` is **gone as of
2026-07-30**; both `Trigger Retell Outbound Call` and `Test Outbound call` now carry
`+17623713782` with White Rock's agent `agent_6d0b5e7d413c9817461a0eb347`. That
removes a backstop that would previously have made any accidental dial fail at
Retell. Two safeties remain: the workflow is inactive and `AI Callback Trigger` is
disabled. Confirm `+17623713782` is the intended caller ID for a Surrey BC studio —
it is a US +1 762 (Georgia) number, and it is also the Joshua copy's `from_number`.

**Resolved 2026-07-30 12:10 UTC:** a dedicated data table `QcDzVFL8ccbemEcA`
("AI Callback White Rock", same 8 columns) was created and all four nodes
repointed. Verified — nothing in the White Rock workflow references
`9U0GXNR5uRUTWUPy` any more.

This also means White Rock now has its own data table to retire at cutover, so
step 3 below covers three workflows and three tables rather than two.

### Resolved same day: the missing `callback_time` condition

Briefly, White Rock's `Get row(s)` filtered on `called_at isEmpty` **only** — the
`email = jdrsalve@gmail.com` test gate had been removed without the
`callback_time <= {{ $now }}` condition both live workflows carry being added in its
place. Enabling that trigger would have dialled every pending row at once, ignoring
scheduled times.

Closed by the Supabase swap (step 3): the new filter string is
`studio_id=eq.<uuid>&called_at=is.null&cancelled_at=is.null&callback_time=lte.{{ $now.toISO() }}`,
which carries the condition. Worth remembering as a clone-checklist item — it is the
second thing after the table pointer that a cloned dialer gets wrong.

---

## 7. Cutover runbook

Pre-conditions already done:

- [x] Migration 053 applied. Table verified: 19 columns, 3 policies, 4 indexes, in
      `supabase_realtime`, `REPLICA IDENTITY FULL`, 0 rows.
- [x] App side: types, 3 server actions, modal, table, activity-log labels.
      `tsc --noEmit` clean, 103/103 tests pass, `npm run build` succeeds.
- [x] `Voice AI Functions copy (Joshua)` swapped to `scheduled_calls`
      (studio `de8bcd75…` = Arthur Murray Joshua Test). Trigger stays disabled.
      Workflow validates with 0 errors; both queue nodes kept
      `onError: continueErrorOutput`.
- [x] Query shapes rehearsed directly against Postgres: due-select, id-stamp, and
      compare-and-set cancel all behave as designed.

### Step 0 — n8n Supabase credentials (RESOLVED — empirically verified)

**Verified 2026-07-30 13:00 UTC in production.** Schaumburg execution `74402` shows
`Get row(s)` returning **3 items** from `scheduled_calls` with the new schema
(`id` as uuid, plus `call_note`, `source`, `cancelled_at`, `retell_call_id`). RLS
would have returned zero rows, so credential `yHLLUsK6GjoakeTT` **is service-role** —
no longer an inference. Three rows is also exactly correct: Susan, Pauline and Cole
are past due; Chris Kim (18:00Z) is not.

That same execution verified, on live data, without placing a call:

- the `studio_id` + `called_at=is.null` + `cancelled_at=is.null` + `callback_time=lte`
  filter string
- `call_note` surviving `Phone Number Formatting` into the Retell payload
- the kill-switch guard stopping the chain at `Voice Agent Enabled?` — 9 nodes ran,
  `Trigger Retell Outbound Call` did not

Lincolnshire execution `74403` read cleanly but returned **0 rows** (Jacob is not due
until Aug 3). Zero rows is ambiguous — indistinguishable from a credential that
cannot read — and Lincolnshire had been left on the *other* credential
(`6ZpTbSWHAP4Ro3FO`). All four of its callback nodes were therefore moved to
`yHLLUsK6GjoakeTT`, the proven one, eliminating that silent-failure mode on the only
studio whose agent is enabled. Both studios now use one credential for this path.

---

#### Original inference (superseded by the verification above)

`scheduled_calls` has RLS with all three policies keyed on `auth.uid()` via
`studio_users`. A node authenticating with the **anon** key gets `auth.uid() = NULL`,
so every policy is false: reads return **zero rows silently** and the dialer just
never calls anyone. Both swapped workflows therefore need a service-role credential.

Two `supabaseApi` credentials exist in the estate, both against project
`npcpkffnswzvzmqolort`, and both are service-role:

| Credential | ID | Evidence it bypasses RLS |
|---|---|---|
| `Supabase (Cadence - Dylan)` | `6ZpTbSWHAP4Ro3FO` | Lincolnshire prod `Update a row` / `Update a row2` write `leads.action`; `leads` is RLS-scoped by `auth.uid()` |
| `AMLS WebApp Temp` | `yHLLUsK6GjoakeTT` | Lincolnshire prod `Get Field Option IDs1` reads `studio_field_options`, whose SELECT policy is `studio_id IN (… WHERE user_id = auth.uid())` with no permissive fallback. That read is on the live post-call path that updates lead `action` — it demonstrably returns rows |

Credential per workflow follows each workflow's own existing convention:

- Joshua copy → `6ZpTbSWHAP4Ro3FO` (matches its `Get a row` / `Update a row`)
- White Rock → `yHLLUsK6GjoakeTT` (matches its `Get a row` / `Update a row`)

Neither value was read directly — the n8n API exposes credentials as opaque
references. The inference above is sound but one click confirms it: open
`Get row(s)` and *Execute step* with a pending row present for that studio. One row
back = service role; zero rows = wrong credential.

**Cleanup worth doing separately:** two service-role credentials for one project is
redundant, and "Temp" in the name suggests `yHLLUsK6GjoakeTT` was never meant to
persist. Consolidating to one is a small, separate task.

### Step 1 — dry-run the Joshua copy

With the trigger still disabled, insert a pending row for the Joshua Test studio
and execute the dialer chain manually. **This places a real phone call** — use
your own number.

### Step 2 — drain and freeze the old tables

Do this in a quiet window. Lincolnshire's call hours are 08:00–22:00 and
Schaumburg's are Tue–Fri 13:00–21:00 / Sat 10:00–15:00 (America/Chicago), so early
morning is safest.

1. Re-read both data tables for rows with `called_at` empty. As of 2026-07-30 there
   are **five**, and a live caller can add one at any moment, so re-check:

   | Table | id | Name | `callback_time` | Note |
   |---|---|---|---|---|
   | `9U0GXNR5uRUTWUPy` (Lincolnshire) | 106 | Jacob Finegan | 2026-08-03T16:00Z | future |
   | `VmEyZDyEjnlYEIBb` (Schaumburg) | 2 | Susan Krussel | 2026-07-28T20:08Z | overdue, held by the kill switch |
   | `VmEyZDyEjnlYEIBb` (Schaumburg) | 3 | Pauline Salcedo | 2026-07-29T18:00Z | overdue, held |
   | `VmEyZDyEjnlYEIBb` (Schaumburg) | 4 | Cole Keller | 2026-07-29T21:14Z | overdue, held. **Phone `+847777988` is malformed** (9 digits) — `parsePhone` yields `phone_e164: null` |
   | `VmEyZDyEjnlYEIBb` (Schaumburg) | 5 | Chris Kim | 2026-07-30T18:00Z | future |

   ⚠️ The four Schaumburg rows are pending only because `voice_agent_enabled = false`
   holds them at the guard. Because the due filter is `callback_time <= now()`, three
   of them fire **immediately** the moment that switch flips — including Susan's,
   queued 2026-07-28. Decide per row whether an immediate cold call is still wanted,
   or cancel/reschedule them before re-enabling. Fix Cole's phone number or that row
   will fail at the Retell call.
2. Copy each into `scheduled_calls` with the right `studio_id` (the commented
   `INSERT` at the bottom of migration 053 is a ready-made template).
3. Stamp `called_at` on the source rows so a mid-cutover n8n tick can't
   double-dial them.

### Step 3 — swap the remaining production workflows

Same four-node change as the Joshua copy, with the correct `studio_id` per
workflow. Nothing else in these workflows changes.

| Workflow | ID | `studio_id` to hardcode | Status |
|---|---|---|---|
| Voice AI Functions (AM White Rock) | `QNRW2PHkiY0i3dij` | `bbd9233a-2352-4997-8d18-d7791296f549` | ✅ **done 2026-07-30** — 0 errors, trigger still disabled, workflow still inactive |
| Voice AI Functions (AM Schaumburg) | `Wgg5bQTPJYFsDSn8` | `aeefb977-5d03-4e40-994a-327cb51b7918` | ✅ **done 2026-07-30** — all 4 nodes on `scheduled_calls`, `onError: continueErrorOutput` preserved on both inserts |
| Voice AI Functions (Lincolnshire) | `gcDhc61cSLTPXOKv` | `71274499-7c29-4621-990f-b60669ed1de3` | ⛔ **BLOCKED** — see below |

### ⛔ Lincolnshire is blocked by a pre-existing orphaned node — ✅ NO LONGER TRUE (2026-08-05)

**This block has cleared.** `Send a message` is now connected (from `Send a message2`),
so it is no longer a disconnected node and the structure gate no longer trips.
Four operations were saved to `gcDhc61cSLTPXOKv` on 2026-08-05 while adding the
call-window gate (see [`call-hours.md`](./call-hours.md) §4), all `saved: true`.
The Step 3 swap can now be done through MCP — the section below is kept for the
history of *why* it was blocked, not as current guidance.

The original report:

`n8n_update_partial_workflow` refuses to save **any** change to `gcDhc61cSLTPXOKv`:

```
Workflow validation failed: Disconnected nodes detected:
"Send a message" (n8n-nodes-base.gmail). Each node must have at least one connection.
```

`Send a message` (`a18ceb9d`) is a **disabled Gmail node with no connections** — pre-existing,
unrelated to this migration, and harmless while disabled. The workflow runs fine with it. But
the MCP tool's structure validation is a hard gate: the 4 operations applied cleanly in memory
and were then **discarded** (`saved: false`), so Lincolnshire is untouched.

Two paths, both needing a human decision:

1. **Do Lincolnshire's 4 nodes in the n8n UI** — the UI has no such gate. Configs are in the
   list above; node names are `Get row(s)`, `Update row(s)`, `Insert AI reschedule`,
   `Insert AI reschedule1`.
2. **Resolve the orphan first**, then re-run the MCP swap. Deleting it was deliberately *not*
   done: the cross-tool invariants in `voice-agent-spec.md` §18.13 say disabled nodes are
   intentional and document the migration path — *"Do not delete them."* The tool's own
   suggestion (wire `schedule_ai_callback → Send a message`) is worse: it would put a Gmail
   node in the callback path, live the moment anyone enables it.

**Until Lincolnshire is swapped it keeps using data table `9U0GXNR5uRUTWUPy`, unchanged and
working.** Its pending row (Jacob Finegan, due 2026-08-03) was migrated to `scheduled_calls`
and then **deleted again** — leaving it there would have double-dialled him if the swap landed
after Aug 3 (data table dials on the 3rd, then the migrated row becomes due once swapped).
Re-migrate it as part of the actual Lincolnshire cutover.

### Schaumburg post-swap state (verified 2026-07-30 12:4x UTC)

`scheduled_calls` holds exactly Schaumburg's 4 rows, all lead-linked. Three are past due and
the fourth (Chris Kim) falls due 18:00Z, but **all four are held at the
`Voice Agent Enabled?` guard** because `voice_agent_enabled = false`. No call fires until that
switch flips — at which point see the ⚠️ warning in step 2 about three immediate cold calls.

Schaumburg's data-table rows (`VmEyZDyEjnlYEIBb` ids 2–5) were deliberately left **unstamped**.
They're no longer read, so they can't double-dial, and leaving them means a revert of the swap
restores correct behaviour automatically instead of silently losing four callbacks.

White Rock went first because it is inactive with a disabled trigger, so the change
had no live blast radius. Its swap also closed the missing-`callback_time`-condition
gap in §6 as a side effect, since the new filter string carries the condition.

Its now-unused data table `QcDzVFL8ccbemEcA` ("AI Callback White Rock") can be
archived with the other two in step 5 — it was created 2026-07-30 and never took a
row.

⚠️ **Node names differ between workflows.** Lincolnshire's two insert nodes are called
`Insert AI reschedule` and `Insert AI reschedule1`, not `Queue AI Callback (default)` /
`(parsed time)`. Same wiring, same job — `Switch` outputs 0+1 feed the first, `Parse Time`
feeds the second, and both fan out to `Successful` / `Unsuccessful Callback Schedule`.
Verified 2026-07-30. The four data-table nodes to convert are:

| Workflow | Read | Stamp | Insert (default) | Insert (parsed) |
|---|---|---|---|---|
| Lincolnshire `gcDhc61cSLTPXOKv` | `Get row(s)` | `Update row(s)` | **`Insert AI reschedule`** | **`Insert AI reschedule1`** |
| Schaumburg `Wgg5bQTPJYFsDSn8` | `Get row(s)` | `Update row(s)` | `Queue AI Callback (default)` | `Queue AI Callback (parsed time)` |

Per workflow:

- `Get row(s)` → Supabase **getAll**, `tableId: scheduled_calls`, `limit: 18`,
  `orderBy: callback_time.asc`, `filterType: string`,
  `filterString: =studio_id=eq.<UUID>&called_at=is.null&cancelled_at=is.null&callback_time=lte.{{ $now.toISO() }}`
- `Update row(s)` → Supabase **update**, `filterString: =id=eq.{{ $('Get row(s)').item.json.id }}`,
  fields `called_at = {{ $now.toISO() }}` and `retell_call_id = {{ $json.call_id || null }}`
- `Queue AI Callback (default)` and `(parsed time)` → Supabase **create**, same
  field mapping as the Joshua copy, with `studio_id` hardcoded and
  `source: ai_agent`. **Keep `onError: continueErrorOutput`** — the error output
  feeds the "Unsuccessful Callback Schedule" response the conversation flow
  branches on.

The `studio_id` filter on `Get row(s)` is **not optional**. Without it every
workflow drains every studio's due rows — the old cross-tenant bug in a new shape.

### Step 4 — deploy the app together with step 3

Between the app deploy and the n8n swap, the two halves disagree: the app reads
`scheduled_calls` while n8n still reads the data tables. Land them together.

### Step 5 — retire the old path (⚠️ NOT as simple as it looks)

**Do NOT delete the `N8N_SCHEDULED_CALLBACKS_*` env vars, and do NOT deactivate
`DrMdkkkCZBZTu3OS`.** An earlier draft of this runbook said to do both. That was
wrong and would have broken the Integrations health page.

`lib/integration-health.ts` → `checkN8nCallbacks()` still reads
`N8N_SCHEDULED_CALLBACKS_LIST_URL` + `_SECRET` and probes that webhook for
Settings → Integrations. Removing the vars makes the probe report
`not_configured`; deactivating the workflow makes it report `error` — a red light
for a feature that is actually fine.

The probe is now **measuring the wrong dependency**. Scheduled calls no longer
touch that webhook at all; they depend on the `scheduled_calls` table and the n8n
dialer. So today it reports green for a retired system, and would report red for a
healthy one. Both signals are wrong.

Correct sequence, once the app deploy is confirmed live:

1. Repoint `checkN8nCallbacks()` at the real dependency — can the queue be read —
   or drop the probe and its card. It has thorough coverage in
   `__tests__/lib/integration-health.test.ts`, so rewrite tests alongside it. This
   was deliberately **not** done during the migration: rewriting a well-tested
   monitoring module at the tail end of a large change is how regressions get in.
2. *Then* deactivate `DrMdkkkCZBZTu3OS` and drop the env vars together.
3. Leave the three data tables (`9U0GXNR5uRUTWUPy`, `VmEyZDyEjnlYEIBb`,
   `QcDzVFL8ccbemEcA`) read-only for a week as a rollback path, then archive.

Ordering matters: the old app build reads the webhook, so nothing here is safe
until the new build is confirmed serving.

### Step 6 — verify

- [ ] Schedule a call from the app for each studio → row appears with
      `source = manual`, correct `studio_id`, correct UTC instant for the picked
      studio-local time.
- [ ] Switch studios in the sidebar → the tab's contents change (the pre-053 bug).
- [ ] A Schaumburg user sees Schaumburg's queue, not Lincolnshire's.
- [ ] Cancel a row → `cancelled_at` set, `called_at` still null, row leaves the
      list, activity log shows "AI call cancelled".
- [ ] Let one queued row come due → n8n stamps `called_at` + `retell_call_id`, and
      the row disappears from the tab via Realtime without a manual refresh.
- [ ] Schedule for a lead that already has one pending → "Replace existing" path
      cancels the old row and inserts the new one.
- [ ] With `voice_agent_enabled = false`, scheduling is refused with the paused
      message (and note G1: the dialer itself still doesn't check).
