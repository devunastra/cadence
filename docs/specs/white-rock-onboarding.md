# Arthur Murray White Rock — Onboarding Status

**Studio ID:** `bbd9233a-2352-4997-8d18-d7791296f549`
**Location:** Surrey, British Columbia, Canada — `America/Vancouver`
**Created:** 2026-07-28
**Last updated:** 2026-07-28

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

All three workflows are **inactive**; the agent is an **unpublished v0 draft**. Keep both
that way until the blockers below clear.

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

`Trigger Retell Outbound Call` still has `from_number: "+17623713782"` — Schaumburg's.
The agent ID is already White Rock's, so this node is half-configured. **Do not activate
this workflow until the number is set**, or callbacks dial BC leads from Schaumburg's
caller ID. A Canadian (604/778) number is the right choice.

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

**Schedule replication.** Lincolnshire's closed days (Sunday + Monday) were already what
White Rock inherited, so `Check Day` / `Check Day1` needed no change. But the studio row
differed and `appointment_slots` was empty `{}` — which matters because `Fetch Studio` →
`Format Studio Details` derives the spoken open-days string from it, so the agent would
have said nothing. Copied from Lincolnshire:

| Column | Was | Now |
|---|---|---|
| `calendar_start_hour` | 6 | 11 |
| `calendar_end_hour` | 22 | 21 |
| `appointment_duration_minutes` | 45 | 45 (unchanged) |
| `appointment_min_advance_weeks` | 1 | 1 (unchanged) |
| `appointment_slots` | `{}` | Tue–Sat — Tue–Fri 14:00–20:15, Sat 11:00–16:15 |

Slot times are studio-local wall clock, so they were copied literally — "same local
schedule", no timezone conversion. Confirm these hours actually suit the BC studio.

**Still open:** price is a placeholder inherited from Lincolnshire, and the currency is
unconfirmed. A BC studio quoting "$80" will be heard as CAD by callers.

---

## Other open items

- **0 members in `studio_users`.** Nobody can see this studio in the app except a
  super_admin — RLS scopes by membership.
- **Shared callback data table.** All four callback nodes point at `AI Callback`
  (`9U0GXNR5uRUTWUPy`), which has no studio column — a third studio's callbacks mix in.
- **Test scaffolding left in place deliberately:** `Get row(s)` filters
  `email = jdrsalve@gmail.com`, `AI Callback Trigger` is disabled, and
  `Test Outbound call` points at a Lincolnshire test agent
  (`agent_7de0c24381ce8c2f4198ffafd2`, from `+16307964623`).
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
