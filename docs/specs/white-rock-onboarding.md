# Arthur Murray White Rock — Onboarding Status

**Studio ID:** `bbd9233a-2352-4997-8d18-d7791296f549`
**Location:** Surrey, British Columbia, Canada — `America/Vancouver`
**Created:** 2026-07-28
**Last updated:** 2026-08-05

The first non-US studio, and the first outside `America/Chicago`. Cloned from the
Schaumburg estate, which is the established second-studio precedent.

---

## Assets

| Asset | ID |
|---|---|
| n8n `Voice AI Functions (AM White Rock)` | `QNRW2PHkiY0i3dij` |
| n8n `AM White Rock Inquiries Workflow` | `aPxHTPqPfsWWuQcw` |
| n8n `AM White Rock – Discord Reports` | `DJxR6JeLMCcbERxe` |
| Retell agent `AM White Rock Agent (Joshua-draft)` | `agent_6d0b5e7d413c9817461a0eb347` |
| Retell conversation flow | `conversation_flow_e50547385d12` |

> **Status changed since this line was first written.** As of 2026-08-05 all three
> workflows are **active**, and the agent is **published at v11** (flow v11). The
> `AI Callback Trigger` is enabled and sweeps every 30 minutes, and the
> `email = jdrsalve@gmail.com` test filter on `Get row(s)` is gone — it reads real
> `scheduled_calls` rows now. The queue is currently empty (0 pending, 0 ever dialled),
> so nothing has gone out, but this is a live dialer, not a parked one. The remaining
> caller-ID blocker is below.

`AMLS Conversations Webhook` (`R3jLXpQzFfYfn7nM`) is **not** cloned — it resolves the
studio dynamically via `studios.ghl_account_id = body.location.id`. See its caveat below.

Lincolnshire's flow (`conversation_flow_433bca831dcb`) was verified untouched after every
change: still 12 `-joshua` URLs, 12 "Lincolnshire" strings, 10 CST/CDT refs.

---

## Done

### Supabase
- `studio_field_options`: added the two `action` values the voice workflow looks up.
  `getId()` returns `null` on a miss and the update nodes would then write
  `action = null`, wiping the lead's action instead of setting it.

  | Value | id | bg / text |
  |---|---|---|
  | `AI Called` | `db53c8e7-8560-4fd9-ac65-c0d7098babbe` | `status-bg-purple` / `status-text-purple` |
  | `Did Not Answer` | `ad944ad5-f551-47ed-ad53-995290b8738d` | none (default gray, as Lincolnshire) |

  **Schaumburg still has this bug** — it has neither option, so its voice workflow nulls
  the action on every AI call and every no-answer. Worth fixing there too.

### n8n — Voice AI Functions
- 15 webhook paths renamed to `-whiterock` (n8n auto-generated opaque UUIDs on
  duplication; renamed before wiring the agent so tool URLs got set once, not twice)
- `studio_id` → White Rock in `Get Field Option IDs`, `Get Field Option IDs1`,
  `Fetch Studio`, `Transform API Response` (the last writes the `calls` row)
- `America/Chicago` → `America/Vancouver` in 14 nodes: 3 GHL free-slots query params,
  `Return Current DateTime`, and code nodes `Check Day`, `Check Day1`,
  `Derive Date Range`, `Derive Date Range1`, `Day Summary1`, `Get Alternates`,
  `Calculate Slot Window`, `Format Slots`, `isCallbackBlank`
- `Get ISO Time` prompt + system message: CST/CDT (−06:00/−05:00) → PST/PDT (−08:00/−07:00)
- `Trigger Retell Outbound Call` → `override_agent_id` = `agent_6d0b5e7d413c9817461a0eb347`

### n8n — Inquiries
- `Find Existing Lead` + `Create Lead` → White Rock `studio_id`
- `Create Lead` field options remapped to White Rock's own UUIDs: status `Active`,
  level `Inquiry`, source **`Website Form`** (no `Online` option exists — closest match
  for a web-form inquiry delivered by email)

### n8n — Discord Reports
- Renamed (dropped `copy` and a stray double space)
- Both lead counts → White Rock `studio_id`; both summary strings → "AM White Rock"

### n8n — workflow-level timezone (all three)
`settings.timezone` set to `America/Vancouver`. Discord Reports had inherited an explicit
`America/Chicago` from Schaumburg, so its two 8am schedule triggers would have fired at
6am local. The other two were unset (inheriting the instance default); now explicit, so
any bare `$now` resolves in studio-local time.

Found only by a full-workflow sweep — it lives in `settings`, not in any node, so
node-level spot checks missed it.

### Retell agent (`agent_6d0b5e7d413c9817461a0eb347`)
- `webhook_url` → `…/webhook/post-call-whiterock`
- `timezone` → `America/Vancouver`
- `pronunciation_dictionary` → cleared (removed the "Lincolnshire" IPA entry)
- `voicemail_option` text → White Rock

### Retell conversation flow (`conversation_flow_e50547385d12`)
- **12 tool URLs** → the `-whiterock` paths. Note `get_earliest_slot` used an underscore
  (`get_earliest_slot-joshua`) where the rest used hyphens; it now points at
  `get-earliest-slot-whiterock` to match the n8n path.
- **12 "Arthur Murray Lincolnshire"** → "Arthur Murray White Rock" (global prompt
  identity, openers, sign-offs, returning-student condition)
- **DST calculator** rewritten: `getChicagoOffset` → `getVancouverOffset`, returns
  −7/−8 instead of −5/−6, label PDT/PST instead of CDT/CST. The date math is unchanged —
  Canada and the US share the same DST rule.
- **The important one:** two node variable descriptions instructed the LLM
  *"Always include the Chicago timezone offset: -05:00 during CDT…, -06:00 during CST"*.
  These drive the ISO offsets the agent generates for `preferred_time` and `day`, which
  feed availability checks and booking. Now −07:00 PDT / −08:00 PST. Left unfixed this
  would have booked every appointment two hours off.
- One `(CDT/CST)` label in node prompt text → `(PDT/PST)`

Verified after write: 12 `-whiterock` URLs, 0 `-joshua`, 0 "Lincolnshire", 0 CST/CDT.

**Deliberately left:** the dynamic variable is still named `current_time_AmericaChicago`
and referenced as `{{ current_time_America/Chicago }}` in 3 tool schemas. It is only a
name — the flow's own code node populates it with Vancouver time. Renaming would mean
catching every reference for no functional gain. Confusing to read; harmless to run.

---

## Disabled pending external accounts

Parked 2026-07-28 because GHL, the inquiries inbox, and Notion don't exist yet. Each
still carries Schaumburg's IDs and credentials — re-enable only after retargeting.

### Voice AI Functions — 10 nodes

| Node | Blocked on | Carries |
|---|---|---|
| `Search Contact` | GHL | locationId, Schaumburg PIT |
| `Create New Event` | GHL | locationId, calendarId, assignedUserId, PIT |
| `Delete Event` | GHL | Schaumburg PIT |
| `Update Appointment` | GHL | Schaumburg PIT |
| `Get Free Slots on GHL` | GHL | calendarId, PIT |
| `Get Free Slots on GHL1` | GHL | calendarId, PIT |
| `Get Free Slots (Earliest)` | GHL | calendarId, PIT |
| `Update Dashboard` | GHL | Schaumburg locationId + calendarId in body |
| `HTTP Request` (reschedule → app) | GHL | Schaumburg locationId in body |
| `HTTP Request1` (delete → app) | GHL | Schaumburg locationId in body |

All 10 Notion nodes in this workflow were already disabled, as were
`Append row in sheet` (Sheets) and `Send a message1` / `Send a message2` (Discord).

### Inquiries — 5 nodes

| Node | Blocked on | Carries |
|---|---|---|
| `Gmail Trigger - Inquiries` | inbox | sender `info@amschaumburg.com`, `AM Schaumburg` OAuth |
| `Check Notion Duplicate` | Notion | `SCHAUMBURG INQUIRY MASTER LIST` |
| `Create Notion Page` | Notion | `SCHAUMBURG INQUIRY MASTER LIST` |
| `Create GHL Contact` | GHL | locationId, custom field `KMpbP5JuOzb1zvoXNdIe`, PIT |
| `Send Welcome Email` | GHL | Schaumburg phone, address, hours, $80, signature |

Discord Reports needed nothing disabled — it only touches Supabase and Discord.

> **Caveat:** a disabled node in n8n passes its input straight through rather than
> halting the branch. These paths will produce wrong results, not clean errors, if the
> workflow is activated. Keep all three inactive regardless.

---

## To do when GHL exists

1. Create an n8n credential `GHL AM White Rock PIT`
2. Swap `locationId` `upQmnNZT3QeZXbNOA34D` → White Rock's (5 nodes above)
3. Swap `calendarId` `XGsTFu73ZQKOZXXdzSuK` → White Rock's (5 nodes above)
4. Swap `assignedUserId` `pSffQn8bFaJIvBSBiP0l` in `Create New Event`
5. Rewrite `Send Welcome Email` body end to end — it is Schaumburg's: phone
   (847) 882-3700 ×2, $80.00, "608 E Golf Rd, Schaumburg, IL 60173", the Tue–Sat hours,
   and the "Team Arthur Murray Schaumburg" signature
6. Write `ghl_account_id` / `ghl_calendar_id` to the studio row
7. Re-enable the 15 disabled nodes
8. Replace the GHL booking widget link in the conversation flow
   (`…/widget/bookings/aml-intro-lesson`)

Also: `AMLS Conversations Webhook` is multi-tenant on the Supabase side but its
`Search GHL Conversations` node has a **hardcoded PIT token** (`pit-0bb51f8c-…`). It
will 401 for White Rock's location and needs to resolve the studio's own key.

## To do when Notion exists

`studios.notion_leads_db_id` is null. If White Rock skips Notion permanently, removing
the two disabled nodes is not enough — `Is New Lead?` AND's a condition on
`$('Check Notion Duplicate').first().json.id`. That condition must also go, and
`Find Existing Lead` rewired directly into `Is New Lead?`.

## To do when a Retell number exists

`Trigger Retell Outbound Call` still has `from_number: "+17623713782"`.

**Correction (2026-08-05): this is _not_ Schaumburg's number**, as an earlier draft of
this doc claimed. Verified against `list-phone-numbers` — the account holds exactly three,
and none has an inbound/outbound agent binding:

| Number | Area code | Used by |
|---|---|---|
| `+16307964623` | 630 — Illinois | Lincolnshire (`Voice AI Functions`, and `RETELL_FROM_NUMBER`) |
| `+18472609336` | 847 — Schaumburg IL | Schaumburg |
| `+17623713782` | 762 — **Georgia** | Nothing else — a spare, referenced only here |

So the real problem is narrower than "dials from Schaumburg's caller ID": there is no
cross-studio identity leak, it is simply a US Georgia number cold-calling BC leads. That
costs answer rate and reads as spam to a Surrey recipient. A Canadian (604/778) number is
still the right fix. The workflow is now active, so this is live the moment a callback is
queued.

**White Rock has no inbound number at all.** Nothing is bound to the agent for inbound, so
today the only way a caller reaches Sarah is an outbound callback. Any transfer test has
to be driven that way — there is nothing to dial in to.

`studios.retell_agent_id` and `studios.retell_api_key` are still empty on the studio row.
The API key is account-level and shared with Lincolnshire/Schaumburg (`key_11bb…`).

---

## Studio details — resolved 2026-07-28

| What | Decision | Status |
|---|---|---|
| Front-desk transfer number | `+16045421900` (604 = Surrey/White Rock BC) | ✅ set in 2 transfer nodes |
| Intro lesson price | Keep `$80` for now — no BC pricing yet | ⏳ revisit; currency unconfirmed (USD vs CAD) |
| Schedule | Replicate Lincolnshire | ✅ see below |
| Agent persona | Keep "Sarah" | ✅ no change (5 refs) |
| Closed days | Sunday + Monday | ✅ already matched Lincolnshire |

**Schedule — real values applied 2026-07-28.** The Lincolnshire placeholder was replaced
with White Rock's actual schedule. The placeholder was **inverted on two days**: Monday
was closed (should be open) and Saturday was open (should be closed), and four of its
slot times fell inside White Rock's break windows.

| Column | Placeholder (Lincolnshire) | Actual |
|---|---|---|
| `calendar_start_hour` | 11 | **12** |
| `calendar_end_hour` | 21 | 21 |
| `appointment_duration_minutes` | 45 | 45 |
| `appointment_min_advance_weeks` | 1 | 1 |
| Open days | Tue–Sat | **Mon–Fri** |

Slots (45 min, studio-local wall clock):
- **Mon–Thu** — 12:00, 12:45, 13:30, ⟨break 14:15–15:30⟩ 15:30, ⟨break 16:15–17:15⟩
  17:15, 18:00, 18:45, 19:30
- **Fri** — same minus 19:30 (last lesson ends 7:30 PM)

`Check Day` / `Check Day1` in the n8n workflow had `closedDays = { Sunday, Monday }`
inherited from Schaumburg; now `{ Saturday, Sunday }`.

Verified through the live availability API: Mon 8 slots, Tue 8, Fri 7, Sat closed,
Sun closed.

> **Known cosmetic gap:** `Format Studio Details` speaks studio hours as
> `calendar_start_hour` → `calendar_end_hour`, so Sarah will say "12 PM to 9 PM" when the
> last lesson actually ends 8:15 PM. The grid bound has to be 21 to contain the 19:30–20:15
> slot. Fixing the spoken string properly needs a separate hours field.

**Pricing — applied 2026-07-28.** Intro lesson is **$30 plus tax**, not the $80 inherited
from Lincolnshire. Replaced in all 6 places in the conversation flow: 5 spoken quotes now
read "$30 per person, plus tax", and the internal "do NOT pitch the $30 introductory
lesson" instruction was kept consistent. Lincolnshire's flow still reads $80, verified.

**Still open on pricing:**
- Currency is implied CAD by context but never stated aloud.
- The **Foundation Program** ($380 + tax — 4 lessons, 4 group classes, 4 parties, plus a
  complimentary lesson) is NOT in the agent. Deliberately left out pending a decision on
  whether Sarah should mention it if asked.

**Studio email:** `info@dancewhiterock.ca`. Leads are forwarded to **dev@lunastra.ai**,
which is what the Gmail trigger must watch. The sender filter is still unknown — a
forwarded message's sender depends on the forwarding mechanism, so this stays unset until
a real forwarded lead can be inspected.

---

## Unanswered-transfer notifications + question-loop fix — 2026-08-05

Two client requests, both White Rock only. Lincolnshire (`conversation_flow_433bca831dcb`,
v16) and Schaumburg were verified untouched afterwards: still `cold_transfer` ×2 and the
canned question ×6.

### 1. "If the AI transfers to us and nobody picks up, can we get a notification?"

The note half already existed — `escalate_message` → n8n → `Build Escalation Note` →
`Find Lead for Escalation` → `Compose Escalation Note` → `Append Note to Lead`, which
appends `[timestamp] AI escalation — <message>` to `leads.notes`. Append-only, scoped by
`id` AND `studio_id`. What was missing was (a) any notification and (b) detection of the
case the client actually described.

**The detection gap.** Both transfer nodes were `cold_transfer`. Retell hands off and
drops the moment the destination *answers* — so the "Transfer failed" edge fires only on
ring-out or busy. If the front desk rolls to **voicemail**, the carrier answers, Retell
counts the transfer as successful, and the caller is dumped into a voicemail box with no
signal to anyone. Evidence: all 4 transfers ever recorded (Lincolnshire) ended
`disconnected_reason = call_transfer`; the failure edge has never fired in production.

Per the API schema, cold transfer exposes only `cold_transfer_mode` and
`transfer_ring_duration_ms` — no human detection. That lives on **warm transfer**
(`opt_out_human_detection`, default false; `agent_detection_timeout_ms` = "time to wait
before considering transfer fails"). Both nodes were switched to:

```
warm_transfer, opt_out_human_detection: false, agent_detection_timeout_ms: 30000,
transfer_ring_duration_ms: 25000, on_hold_music: ringtone, enable_bridge_audio_cue: true,
private_handoff_option: { type: prompt, ... }
```

`private_handoff_option` (not `public_`) means only the staff member hears the one-line
"who is calling and why" summary — the caller does not.

**The notification.** Migration `059_ai_escalation_notifications.sql` adds
`notify_ai_escalation(studio_id, first_name, last_name, phone, email, message)` —
`SECURITY DEFINER`, execute revoked from `anon`/`authenticated`, granted to `service_role`.
It resolves the lead itself (email first, else last-10-digits phone), then fans out one
`notifications` row per recipient: **studio members ∪ every super_admin**, `UNION`-deduped.

Deliberately *not* gated on `notify_appointment_created` — that pref is about bookings,
and someone who muted booking noise should still hear that a caller went unanswered.
There is therefore no opt-out for escalations yet.

n8n calls it from one new node, `Notify Studio (Escalation)`, hung off
`Escalation Status Message` — i.e. **after** Retell already got its response, so it cannot
eat into the 8s `escalate_message` timeout, and **in parallel** with the note chain, so it
still fires when no lead matches (link falls back to `/call-history`).

No UI work was needed: `getNotifications` and the bell's Realtime subscription filter on
`user_id`/`studio_id` only, with no `type` filter or per-type icon switch, so
`ai_escalation` renders like any other kind.

**Super-admin split — partly fixed (migration `060`).** Super admins get a row for every
studio, so a cross-studio escalation surfaced badly:

- The badge counted rows the popover could never show. `getUnreadNotificationCount` is
  scoped to the selected studio, but the Realtime handler incremented on every row, so the
  number drifted above the list and read as a bug. **Fixed** — the increment is now scoped
  to match.
- The toast showed only the title, so a super admin in White Rock saw
  "AI escalation — needs follow-up" for a Schaumburg caller with no idea which studio.
  **Fixed** — `notify_ai_escalation` now carries `studio_name` in metadata, and the toast
  renders `<Studio> — <title>` when the row is not the current studio.

`NotificationType` was also widened; it was a one-member union (`'appointment_booked'`)
that no longer described the table.

> **Still open:** cross-studio rows are only *visible* after switching studios — the list
> stays per-studio by design. Deep-linking with an auto-switch on click is the follow-up.
>
> **Also open:** the escalation toast is gated on `notify_appointment_toast`, an
> appointment-specific pref now silently controlling escalation alerts. Someone who muted
> booking noise has muted unanswered-caller alerts without being told. And it renders via
> `showSuccess` — green "success" styling for "nobody picked up."

### 2. "Can the agent answer and move on instead of always asking if we have questions?"

The line was hardcoded verbatim in 3 nodes: `conversation-1777403153194-0`,
`node-1777604430953`, `node-1777609061737` (BACKUP) — identical in Lincolnshire's flow too.
Only `node-1777604430953` is live; it is a **global node** (entered from anywhere on a
question) and the other two have no inbound edges.

The catch: all six of its exit edges are keyed on the *caller's reply*, two of them
literally on the answer to "can we move on?". The canned question was the mechanism that
produced the utterance that let the node exit. So this needed an edge change, not just a
prompt edit — a new `edge-question-handling-auto-bridge` fires when the agent has answered
and the caller has not raised anything new. The return target is the `Master Switch`
branch node, so the hand-back is context-aware.

All 3 copies were rewritten (so a future swap to BACKUP can't reintroduce it), plus the
now-stale "Do NOT state <phrase> after" carve-out in the group-classes path.

### 3. Making an unanswered transfer distinguishable in the notes column — v12

The note line reads `[stamp] AI escalation — <message>`, and `<message>` is LLM-authored.
`escalate_message` fires from **three** places in the flow, so an unanswered transfer and
an ordinary "caller asked about pricing" escalation looked identical when scanning the
column.

The two `Escalate Message` **function** nodes on the transfer-failure path
(`node-1776333155412`, `node-1777305637976`) now carry an
`instruction: { type: 'prompt', text }` requiring `message` to begin with
`Live transfer unanswered — `. Function nodes support `instruction`; it simply was not
set. That meant no tool-schema change and no second tool, and the third call site stays
unprefixed — which is what keeps the two separable.

The patch script **traces** `transfer_call` → failure edge → apology → function node and
asserts the traced pair matches the expected IDs, rather than hardcoding them. Rewire that
path later and the patch fails loudly instead of instructing the wrong node. It also
re-asserts the v11 invariants (`warm_transfer` ×2, `cold_transfer` ×0, canned line absent)
before writing.

> **This is a prompt directive, not an enforced field.** It will hold most of the time but
> is not guaranteed. If the prefix ever needs to be filtered on programmatically, the real
> fix is a separate tool with `"const"` on that argument.

### How it was shipped

`PATCH /update-conversation-flow` on a published flow returns
`400 Cannot update published conversation flow`. Correct sequence, run twice:

1. `POST /create-agent-version` `{base_version: N}` → draft agent `vN+1` + flow `vN+1`
2. `PATCH /update-conversation-flow/{id}?version=N+1` (the `version` param is required —
   without it the PATCH targets latest and 400s again)
3. `POST /publish-agent-version` `{version: N+1}`
4. n8n `override_agent_version` → `N+1`

Applied v10 → **v11** (warm transfer + question loop), then v11 → **v12** (note prefix).
Pin is now **12**.

Step 4 matters as much as the rest: the dialer pins the version, so publishing alone
changes nothing for outbound. It had been pinned at **0** all along, which is why outbound
callbacks were still quoting **$80** — flow v0 predates the 2026-07-28 pricing fix. The
0 → 11 bump corrected that as a side effect.

Rollback: every prior version stays published and intact. Set the pin back to `11`
(drops only the note prefix), `10` (corrected pricing, original cold transfer), or `0`.

### Not yet proven

**No signal has traversed the full path.** The RPC was tested by calling it directly
(phone match, email match, no-match fallback, studio name — all correct, test rows
deleted); the n8n node has never fired. White Rock has 1 call total and 0 transfers ever.

One test callback with the studio line left to ring out exercises all four unknowns:

1. Does warm-transfer human detection actually flag White Rock's voicemail greeting?
2. Does `Notify Studio (Escalation)`'s expression pull `first_name` / `phone_number` /
   `message` correctly off the live webhook body? (Written against the shape
   `Build Escalation Note` uses, never observed executing.)
3. Can the `AMLS WebApp Temp` credential execute the RPC? (Execute is granted to
   `service_role`; that credential is *inferred* to be service role because it performs
   RLS-blocked PATCHes elsewhere — not confirmed.)
4. Does the agent honour the `Live transfer unanswered — ` prefix?

Until that runs this is shipped, not proven.

---

## Other open items

- ~~**0 members in `studio_users`.**~~ **Resolved** — 1 member as of 2026-08-05, plus 3
  account-wide super_admins. Relevant now because the escalation notification fans out to
  that union: 4 recipients per escalation.
- **Shared callback data table.** All four callback nodes point at `AI Callback`
  (`9U0GXNR5uRUTWUPy`), which has no studio column — a third studio's callbacks mix in.
- **Test scaffolding is GONE as of 2026-08-05** — this entry is kept only so the change
  is visible. `Get row(s)` no longer filters `email = jdrsalve@gmail.com`; it reads real
  `scheduled_calls` for the studio. `AI Callback Trigger` is **enabled** (30-min sweep).
  A `Call Window Gate` code node now sits before `Voice Agent Enabled?` and fails closed,
  so a due callback is held until the studio's `call_hours` window opens rather than
  dialling at 3am. `Test Outbound call` still points at the Lincolnshire test agent
  (`agent_7de0c24381ce8c2f4198ffafd2`, from `+16307964623`) — that one is unchanged.
- **Discord channel.** Reports post to the shared `Discord AMLS Alerts` webhook — decide
  whether White Rock gets its own.
- **The flow never calls `question-handler` or `get-studio-details`.** Both webhooks
  exist in the workflow (Schaumburg-era additions). `Get Studio Details` is worth wiring
  up — it reads name/address/hours from Supabase instead of hardcoding them.

---

## Cross-studio bug (pre-existing, worsens with a third studio)

Three lead lookups in the voice workflow match on phone/email with **no `studio_id`
filter**:

- `Get a row` — phone + email
- `Get a row2` — phone + email
- `Get Lead (ended)` — email only

`Update a row`, `Update a row1`, and `Update a row2` then write to whatever row came
back. With two studios this was latent; a third makes a cross-studio write more likely.
Add a `studio_id` condition to all three before White Rock goes live.
