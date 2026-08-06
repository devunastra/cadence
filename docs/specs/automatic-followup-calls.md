# Automatic Follow-up Calls — the no-answer ladder

**Status:** migrations 061 + 062 applied. White Rock and Lincolnshire wired and
live; Schaumburg wired-ready but its voice agent is off. **The ladder is running** —
7 rungs queued since 2026-08-05, 5 still pending. The on/off switch (§10) is live
end-to-end — app, RPC guard, and all three dialers.
**Last updated:** 2026-08-06

> Numbered 061, not 060 — `060_ai_escalation_studio_name.sql` landed on staging
> from a parallel session while this was being written.

The client's request:

> We need an automatic followup system:
> - if the lead doesn't pick up, they get called again the next day within their
>   preference window (evening 6:30pm, daytime 1:00pm)
> - if they still don't pick up they get called again 2 days after the previous call
> - if they still don't pick up call again 3 days after the previous call
> - and the LAST call will be one more time 5 days after the previous call

---

## 1. The headline: most of this already exists

Three of the four pieces this feature needs are already deployed and working.

| Piece | Status |
|---|---|
| Detecting "the lead didn't pick up" | **Exists.** `Classify Call Action (Call End)` already emits `call_action: 'did_not_answer'`, and `If2` already branches on it to stamp the lead's Action field. |
| A queue of future outbound calls | **Exists.** `scheduled_calls` (migration 053), drained every 30 min by the `AI Callback Trigger` in each `Voice AI Functions` workflow. |
| Not calling people at 3am | **Exists.** `Call Window Gate` (2026-08-05) holds out-of-window rows and dials at the next opening. |
| Deciding *when* the next attempt goes out | **This spec.** |

So the build is one Postgres function, two columns, and one HTTP node per
workflow. It is not a new subsystem.

---

## 2. Where it attaches

The full existing path for an outbound call that nobody answers:

```
Retell call_ended webhook
  → Webhook → Is call_ended? [true]
  → Wait 90s → GET Retell Call → Transform API Response
  → Get Lead (ended) → Merge Lead ID (ended)
  → Classify Call Action (Call End)     ← emits call_action: 'did_not_answer'
  → IF Needs AI? → (Verify Transcript1 | Strip Internal Flags1)
  → If2  [call_action == 'did_not_answer']
      → Phone Number Formatting1 → Get Field Option IDs1 → Aggregate1
      → Resolve Did Not Answer ID → Get many database pages4
      → Update a database page4 → Update a row2
      → Upsert Call (ended)
      → ★ Queue Follow-up Call            ← THE ONLY NEW NODE
```

`Classify Call Action (Call End)` already defines "didn't pick up" for us, and it
is stricter than a bare `picked_up` flag:

```js
const definiteNoAnswer = new Set([
  'dial_no_answer', 'dial_busy', 'dial_failed', 'voicemail_reached',
  'ivr_reached', 'invalid_destination', 'telephony_provider_permission_denied',
  'telephony_provider_unavailable', 'sip_routing_error',
  'error_no_audio_received', 'registered_call_timeout'
])
// ...also: duration < 15s with no real transcript, or no transcript at all
```

**We reuse this verbatim.** Writing a second, subtly different definition of
"didn't answer" is how the two halves of a system drift apart.

### Why one RPC and not ladder logic in n8n

Directly following the precedent set by migration 059 (`notify_ai_escalation`):

> Why an RPC and not four more n8n HTTP nodes: the audience rule is a product
> decision, not workflow plumbing. Keeping it in one place means a third studio's
> workflow gets the same behaviour by calling the same function.

The interval ladder, the preference-window mapping, and the stop conditions are
all product decisions. Encoded once in Postgres, a fourth studio gets correct
follow-ups by adding one node. Encoded in n8n, they get copy-paste drift — which
is exactly what migrations 053 and 056 exist to undo.

---

## 3. The ladder

Attempt 1 is the original call, whatever produced it. Each rung is measured from
**the call that just went unanswered**, not from the scheduled time.

| Rung | Fires | Cumulative |
|---|---|---|
| Attempt 1 | the original call | day 0 |
| Attempt 2 | +1 day | day 1 |
| Attempt 3 | +2 days | day 3 |
| Attempt 4 | +3 days | day 6 |
| Attempt 5 | +5 days | day 11 |
| — | ladder exhausted, nothing further | |

**5 calls total across 11 days.** Four of them are automatic.

Measuring from the actual call rather than the intended time matters. If a row is
held over a closed weekend and dials Tuesday instead of Sunday, the next rung is
+2 days from *Tuesday*. The client's wording — "2 days after the previous call" —
says the call, and that is also the only reading that stays sane when a window
slides.

### Time of day

`leads.available` is free text, not an enum. Real values include `Daytime`,
`Evening`, `Weekend`, `justForFun, Evening`, `weddingDance, Daytime`,
`justForFun - Daytime`, and `not interested anymore`. So the match is
case-insensitive substring, not equality:

| `available` contains | Call at |
|---|---|
| `evening` | **18:30** studio-local |
| anything else, including `NULL` | **13:00** studio-local |

**1,215 of ~2,350 leads (~55%) have `available = NULL`.** Confirmed 2026-08-05:
these fall back to 13:00. `Weekend` also maps to 13:00 — it describes a *day*
preference, not a time, and 13:00 is inside every studio's window on every day
they are open. A 13:00 default is the only one that never collides with
Schaumburg's Saturday 10:00–15:00 window.

### When the target is outside calling hours

**Queue it anyway and let the existing gate slide it.** No new code.

`Call Window Gate` already returns `[]` for an out-of-window row, which stops the
chain before the dial and leaves the row pending (`called_at` stays NULL). The
next 30-minute sweep re-reads it and dials the moment the window opens.

This matters more than it sounds:

| Studio | Window | Collision |
|---|---|---|
| Lincolnshire | 08:00–22:00 daily | none — both 13:00 and 18:30 always fit |
| Schaumburg | Tue–Fri 13:00–21:00, Sat 10:00–15:00, closed Sun+Mon | **18:30 fails every Saturday**; both times fail Sun+Mon |
| White Rock | Mon–Thu 12:00–20:00, Fri 12:00–19:00, closed Sat+Sun | both times fail every weekend |

For Schaumburg an evening-preference lead who misses a Friday call gets rung 2
targeted at Saturday 18:30 → held → dialled Tuesday 13:00. That is a 4-day gap on
a "next day" rung. It is the correct behaviour (the studio is shut), but staff
should not be surprised by it.

---

### Verified against live config

The interval and preference expressions were run against all three studios'
real `timezone` + `call_hours` on 2026-08-05 (read-only, nothing written).
24 rungs simulated — 2 preferences × 4 rungs × 3 studios:

| Studio | Dials on time | Held by the gate |
|---|---|---|
| Lincolnshire | 8 / 8 | — |
| Schaumburg | 5 / 8 | Sat 18:30 (window closes 15:00); both Monday rungs (closed) |
| White Rock | 6 / 8 | both Saturday rungs (closed) |

**19 of 24 dial at the intended minute; 5 are held and dial at the next opening.
None are dropped.** This is the "slide" behaviour working as designed — and it is
also the evidence that the 13:00 default was the right choice: every held rung
above is either an evening preference or a fully closed day. A 18:30 default
would have added Saturday holds for Schaumburg across the board.

---

## 4. Stop conditions

The ladder must stop for reasons other than exhaustion. The RPC returns without
inserting when any of these hold.

| Condition | Why |
|---|---|
| `followup_attempt` already at 4 | ladder exhausted |
| A **pending** `scheduled_calls` row already exists for this lead | never double-queue; migration 053 deliberately allows duplicate pending rows, so this must be checked, not assumed |
| Same `retell_call_id` already queued a follow-up | idempotency — a webhook retry must not add a rung |
| `leads.action` ∈ `DO NOT CALL`, `WRONG NUMBER`, `WRONG LOCATION` | explicit do-not-contact |
| `leads.action` = `Scheduled` or `leads.first_lesson` is set | they booked; stop calling |
| `leads.status` ∈ `Inactive`, `solicitation`, `Wrong Location` | dead lead |
| lead row missing or `studio_id` mismatch | defensive |

Values above are the live `studio_field_options` for Lincolnshire, read
2026-08-05 — not invented.

**The lead picking up needs no stop condition.** A successful call classifies as
something other than `did_not_answer`, `If2` takes the false branch, and the RPC
is never called. The ladder ends by simply not continuing, which is the failure
mode you want: a bug in the ladder logic cannot cause extra calls to someone who
already answered.

---

## 5. Schema

```sql
ALTER TABLE public.scheduled_calls
  ADD COLUMN IF NOT EXISTS followup_attempt          smallint,
  ADD COLUMN IF NOT EXISTS followup_triggered_by_call_id text;

-- 'followup' is a third provenance alongside the existing two.
ALTER TABLE public.scheduled_calls DROP CONSTRAINT IF EXISTS scheduled_calls_source_check;
ALTER TABLE public.scheduled_calls ADD CONSTRAINT scheduled_calls_source_check
  CHECK (source IN ('ai_agent', 'manual', 'followup'));

-- Idempotency: one Retell call can spawn at most one follow-up, ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_calls_followup_dedupe
  ON public.scheduled_calls (followup_triggered_by_call_id)
  WHERE followup_triggered_by_call_id IS NOT NULL;
```

`followup_attempt` numbers the rung this row represents (1–4; attempt 1 in §3 is
the original call and has no row). NULL means the row is not part of a ladder,
which keeps every existing row and both existing producers untouched.

### Interval arithmetic

Done in studio-local wall-clock, then converted back — so a ladder spanning a DST
changeover still lands at 13:00, not 12:00:

```sql
v_target := ((timezone(v_tz, now())::date + v_days) + v_time) AT TIME ZONE v_tz;
```

This is the same principle as migration 056: `studios.timezone` is the only
source of offset truth. No hand-rolled DST maths.

---

### Privileges — the one thing not to copy-paste

`SECURITY DEFINER` + Supabase's default grants is an RLS bypass. Every new
function in `public` is granted EXECUTE to PUBLIC, `anon` and `authenticated`
automatically, and this function takes `studio_id` and `lead_id` as arguments
with **no membership check**. Left at the defaults, anyone holding the anon key —
which ships in the browser as `NEXT_PUBLIC_SUPABASE_ANON_KEY` — could queue
outbound phone calls against any studio, and any authenticated user of studio A
could queue calls for studio B.

Confirmed on the live database 2026-08-05: the ACL immediately after `CREATE`
was `=X/postgres anon=X/postgres authenticated=X/postgres service_role=X/postgres`.
migration 061 now revokes down to `postgres` + `service_role` and the live ACL
matches.

If this ever needs an app-side caller (a "retry now" button), **do not re-grant
to `authenticated`** — add a `studio_users` membership check inside the function
first. The argument-driven signature is only safe while the caller is trusted.

---

## 6. Deliberate consequences

Three behaviours that follow from this design and should not surprise anyone
later.

**Superseded in part by §10.** The first of the three below is still true of the
*voice agent* switch, but the ladder now has its own switch that behaves the
opposite way on purpose. Read §10 alongside this.

**Pausing the voice agent ends every in-flight sequence.** The migration-054
trigger abandons all pending rows when `voice_agent_enabled` flips false → true,
and follow-up rows are pending rows. Confirmed as intended 2026-08-05: this
stays. A studio that pauses for a week comes back with every ladder wiped, and
nothing announces it. It is consistent with the existing rule ("dial only the
future leads who will come after the switch on") but it does mean a lead can be
told-by-implication they'll get five calls and receive two.

**Call volume rises up to 5×.** Each dialer sweep reads at most 18 due rows
(`Get row(s)`, `limit: 18`). At 48 sweeps/day that is 864 dials/day of headroom,
far above current volume — but the cap is per *sweep*, so a burst at window-open
trickles across sweeps rather than dialling at once. Worth watching, not worth
pre-optimising.

**Schaumburg cannot be verified end-to-end.** `voice_agent_enabled = false` and
its `calls` table is empty. The ladder can be deployed there but not observed
working until the agent is switched on.

---

## 7. Unrelated finding

`syncRetellCallsNow` in [`app/actions.ts:1679`](../../app/actions.ts) is dead
code — nothing in the app calls it, and there is no cron job for it (`cron.job`
holds only `daily-call-review`, `notion-sync-pull`, and
`probe-integration-health`). The `calls` table is populated exclusively by the
`Upsert Call (ended)` node in each `Voice AI Functions` workflow.

This does not affect the ladder, which keys off the n8n classification chain
rather than the `calls` table. Noted because the route comment at
`app/api/webhooks/retell-call/route.ts:3` still claims a 15-minute Vercel cron
syncs calls, and that cron does not exist.

---

## 8. The n8n change, in full

One node per workflow. Nothing existing is edited — it is appended after
`Upsert Call (ended)`, which is currently terminal on that branch.

**Put the node where the post-call webhook actually lands, which is not always
the studio's own workflow.** Each Retell agent has a `webhook_url`, and one of
them points somewhere surprising (verified 2026-08-05):

| Studio agent | `webhook_url` path | Workflow that owns that path |
|---|---|---|
| AM White Rock `agent_6d0b5e7d41…` | `/webhook/post-call-whiterock` | `QNRW2PHkiY0i3dij` — its own ✅ |
| AM Schaumburg `agent_9bd7f902d7…` | `/webhook/post-call-schaumburg` | `Wgg5bQTPJYFsDSn8` — its own ✅ |
| AM Lincolnshire `agent_cd8a872b64…` | `/webhook/post-call-joshua` | `LXlMa0Gy2Fq2xuUO` — **Voice AI Functions copy (Joshua)** ⚠️ |

Two of three are clean; Lincolnshire is the lone outlier, which is what makes it
easy to miss.

So Lincolnshire's post-call processing — the lead Action update, the `calls`
upsert, all 234 of its call rows — runs inside a workflow named like a personal
dev clone. `gcDhc61cSLTPXOKv` ("Voice AI Functions", the Lincolnshire production
workflow) has had **zero webhook-mode executions**; every one of its recent runs
is a 30-minute `AI Callback Trigger` sweep. Adding the ladder node there would
be a no-op.

| Workflow | ID | Append after | Status |
|---|---|---|---|
| Voice AI Functions (AM White Rock) | `QNRW2PHkiY0i3dij` | `Upsert Call (ended)` | **done 2026-08-05** |
| Voice AI Functions copy (Joshua) | `LXlMa0Gy2Fq2xuUO` | `Upsert Call (ended)` | **this is Lincolnshire's real path** — see above |
| Voice AI Functions (Lincolnshire) | `gcDhc61cSLTPXOKv` | — | receives no webhooks; do not wire until the agent is repointed |
| Voice AI Functions (AM Schaumburg) | `Wgg5bQTPJYFsDSn8` | `Upsert Call (ended)` | check its agent's `webhook_url` first |

Repointing the Lincolnshire agent at a `post-call-lincolnshire` path on its own
workflow is the right fix, but it is a separate change with its own blast radius
— it moves live post-call processing between workflows. Not bundled here.

New node — `Queue Follow-up Call`, type `n8n-nodes-base.httpRequest` v4.4,
credential `supabaseApi` (`AMLS WebApp Temp`, the one every other Supabase HTTP
node on this branch already uses):

```
Method:  POST
URL:     https://npcpkffnswzvzmqolort.supabase.co/rest/v1/rpc/schedule_followup_call
Headers: Content-Type: application/json
Body (JSON, expression):
  {{ JSON.stringify({
       p_studio_id:      $('Merge Lead ID (ended)').first().json.studio_id,
       p_lead_id:        $('Merge Lead ID (ended)').first().json.lead_id,
       p_retell_call_id: $('Merge Lead ID (ended)').first().json.retell_call_id
     }) }}
Settings: onError = continueRegularOutput,  retryOnFail = true,  maxTries = 2
```

**Read all three arguments from `Merge Lead ID (ended)`, not from
`Phone Number Formatting1`.** That node emits only
`{phone_raw, phone_normalized, phone_e164, phone_country, lead_id}` — it has no
`retell_call_id`, so sourcing from it silently disables the idempotency guard.
`Merge Lead ID (ended)` is the object already POSTed to `calls`, so it carries
all three, and its `studio_id` is the per-studio constant set in
`Transform API Response` — which means the node body is **identical across all
three workflows**, with nothing to hardcode per studio.

`onError: continueRegularOutput` is deliberate. A follow-up that fails to queue
must never break the lead update or the call upsert that already ran upstream on
this branch — those are the records staff actually look at. The RPC returning
`{"queued": false, "reason": "..."}` is a normal outcome, not an error, and shows
up in the execution log either way.

---

## 9. Build order

Lowest blast radius first, per the standing review rule.

1. Migration — columns, constraint, unique index. Purely additive; changes no behaviour.
2. `schedule_followup_call` RPC + unit tests against the interval/preference/stop matrix.
3. Wire **White Rock only** (`QNRW2PHkiY0i3dij`) — one HTTP node after `Upsert Call (ended)`. Lowest volume of the three live studios.
4. Observe one full ladder.
5. Roll to Lincolnshire (`gcDhc61cSLTPXOKv`) and Schaumburg (`Wgg5bQTPJYFsDSn8`).
6. `/follow-ups` UI — "Attempt 2 of 5" badge, filter by source.

Steps 1–2 are safe to land ahead of any n8n change: with no workflow calling the
RPC, nothing happens.

### Done so far (2026-08-05)

1. ✅ Migration applied. Verified present: both columns, both indexes, widened
   `source` constraint, function.
2. ✅ Function exercised through a full ladder in a rolled-back transaction —
   rungs landed at +1/+2/+3/+5 days at 18:30 (evening correctly matched out of
   the compound string `justForFun, Evening`), a duplicate while a row was
   pending returned `pending_call_exists`, the fifth call returned
   `ladder_exhausted`, and replaying a `retell_call_id` returned
   `already_queued_for_call`. Zero rows persisted.
3. ✅ White Rock wired. Workflow validates with 0 errors; its 13 warnings are
   pre-existing disabled Notion/Discord nodes, none on the new edge.
4. ✅ Webhook routing audited for all three agents (table above). Schaumburg is
   clean; Lincolnshire is the outlier.
5. ✅ `/follow-ups` badge. `SourceBadge` gains a `followup` case reading
   **"Auto follow-up · attempt N of 5"** in orange — the same colour Call History
   uses for its Callback chip, since both mean a lead the agent hasn't reached.
   `followup_attempt` counts retries only, so the badge renders `attempt + 1`.
   Touched: `lib/types.ts` (widened `source`, two new fields),
   `app/actions.ts` (`SCHEDULED_CALL_COLUMNS`), and the table component.
   3 new tests (rung 1 → "attempt 2 of 5", rung 4 → "attempt 5 of 5", and a null
   attempt falling back to a bare label rather than "attempt NaN of 5").
   16/16 pass; `tsc --noEmit` and `next build` both clean.

The deployed function's `call_note` was re-issued to match that wording exactly —
"Automatic follow-up — attempt N of 5." One vocabulary in the badge, the note,
and this document.

6. ✅ Lincolnshire wired — on `LXlMa0Gy2Fq2xuUO`, where its post-call webhook
   actually lands. Validates with 0 errors.
7. ✅ Function privileges revoked down to `service_role` (see §5).

### The real Lincolnshire topology

Worth writing down, because it is not what the workflow names suggest.
Lincolnshire's pipeline is **split across two workflows**:

| Half | Workflow | Evidence |
|---|---|---|
| Dialing — 30-min `AI Callback Trigger` sweep over `scheduled_calls` | `gcDhc61cSLTPXOKv` | every recent execution is a `trigger`-mode sweep |
| Post-call — `calls` upsert, lead Action, **and now the ladder** | `LXlMa0Gy2Fq2xuUO` | every recent execution is `webhook` mode; the copy's dialer nodes are unreachable (no schedule trigger) |

The loop still closes: the copy queues a row with
`studio_id = 71274499-…`, and `gcDhc61cSLTPXOKv`'s `Get row(s)` filters on exactly
that studio_id, so the production dialer picks it up. But anyone disabling
"Voice AI Functions copy (Joshua)" on the assumption it is a personal clone would
silently stop Lincolnshire's post-call processing *and* its follow-up ladder.

### Still to do

8. ~~Observe one real ladder end-to-end.~~ **Rung 1 confirmed firing (2026-08-06.)**
   7 `source='followup'` rows exist, queued 2026-08-05: 4 Lincolnshire, 3 White
   Rock. All rung 1; 5 pending, 2 cancelled by staff. The preference mapping is
   visible in the data — Jennifer Velasquez landed at 18:30 and everyone else at
   13:00. Still unobserved: rungs 2–4, i.e. what happens when a *follow-up* call
   itself goes unanswered and has to advance the ladder.
9. Decide Lincolnshire's routing properly: repoint `agent_cd8a872b64…` from
   `/webhook/post-call-joshua` to `/webhook/post-call` (which
   `gcDhc61cSLTPXOKv` already listens on and which has never received a call),
   then move the ladder node across. Deliberately **not** bundled into this
   feature — it relocates live post-call processing for the highest-volume
   studio onto an untested endpoint, which needs its own test call and rollback
   plan.
10. Schaumburg: routing is already correct, but `voice_agent_enabled` is false,
    so nothing fires there until it is switched on.

**How to watch it.** New rungs appear as `source = 'followup'`:

```sql
select l.name, sc.followup_attempt, sc.callback_time, sc.called_at, sc.call_note
from scheduled_calls sc join leads l on l.id = sc.lead_id
where sc.source = 'followup'
order by sc.created_at desc;
```

A ladder that never starts shows up as a `Queue Follow-up Call` node returning
`{"queued": false, ...}` in the execution log — the `reason` names which stop
condition fired. That was the point of returning jsonb rather than void: the
2026-07-28 out-of-hours bug went unnoticed for a week because the failure was
silent.

---

## 10. The on/off switch (migration 062)

The client's request, 2026-08-06:

> can you add a switch in the system dashboard somewhere that can turn automatic
> followups on and off? it shouldn't affect the normal behavior of the agent tho,
> only followups

`studios.followups_enabled`, defaulting to `true`, surfaced as a toggle in the
Leads header beside the AI Voice Agent pill and the outbound agent selector.

### Not a second voice-agent pause

The whole value of the feature is what it does *not* touch. With the switch off the
agent still answers inbound, still dials new inquiries, still books, still
escalates. `setFollowupsEnabled` in [`app/actions.ts`](../../app/actions.ts) writes
one boolean and stops — no Retell call, no inbound-agent swap, no write to
`voice_agent_enabled`. Anything added there that talks to Retell breaks the promise
the switch makes.

### Off means hold, not cancel

Chosen over cancelling, and the reverse of what migration 054 does to the voice
agent's own backlog. Two halves:

| Half | Where | Effect |
|---|---|---|
| Stop queuing new rungs | `schedule_followup_call`, migration 062 | returns `{"queued": false, "reason": "followups_disabled"}` |
| Hold rungs already queued | `Call Window Gate` in each dialer | returns `[]`, row stays PENDING |

Held means the same thing it means out-of-hours: nothing is stamped, so
`called_at` / `cancelled_at` / `skipped_at` all stay NULL and the sweep after
switch-on dials the row at its **original** `callback_time`. Flipping the switch
twice loses nothing.

**Why the asymmetry with 054 is deliberate.** 054 abandons the backlog because a
studio that has been dark for a week should not suddenly cold-call a stale list. A
follow-up rung is not a stale list — it is one lead the agent already tried, on a
schedule that lead was effectively promised. Resuming it is the expected behaviour.

The 054 trigger is `AFTER UPDATE OF voice_agent_enabled` with a
`WHEN (OLD IS FALSE AND NEW IS TRUE)` clause, so writing `followups_enabled` cannot
trip it. **If that trigger ever widens to a bare `AFTER UPDATE`, toggling follow-ups
would silently wipe every pending call in the studio.**

### Verified (2026-08-06)

Exercised against Lincolnshire on the live database inside a `DO` block that
`RAISE EXCEPTION`s at the end, so every write rolled back. Zero rows persisted,
confirmed afterwards by count.

| Switch | Result |
|---|---|
| off | `{"queued": false, "reason": "followups_disabled"}` — no row inserted |
| on | `{"queued": true, "attempt": 1, "days_out": 1, "local_time": "… 13:00"}` |

All three studios read `followups_enabled = true` after the migration, so nothing
changed behaviourally on deploy. Function ACL still `postgres` + `service_role`
only — `CREATE OR REPLACE` preserves it, and 062 re-issues the REVOKE/GRANT anyway
so a from-scratch rebuild can't reintroduce the anon grant.

### The dialer half

Two edits per workflow. The `Call Window Gate` already implements hold-and-resume
for out-of-hours rows, so this is the same mechanism pointed at a different column.

| Workflow | ID | Needed |
|---|---|---|
| Voice AI Functions (AM White Rock) | `QNRW2PHkiY0i3dij` | yes |
| Voice AI Functions (Lincolnshire) | `gcDhc61cSLTPXOKv` | yes — this is where Lincolnshire *dials*, unlike the ladder node, which lives on the copy |
| Voice AI Functions (AM Schaumburg) | `Wgg5bQTPJYFsDSn8` | yes |
| Voice AI Functions copy (Joshua) | `LXlMa0Gy2Fq2xuUO` | **no** — its `AI Callback Trigger` is disabled, its `Get row(s)` points at a different studio, and it has no gate nodes at all |

1. `Check Voice Agent Setting` — append `followups_enabled` to the `select=` list.
2. `Call Window Gate` — hold when the row is a follow-up and the studio has them off.

All three gates were byte-identical before this change, and the `Check Voice Agent
Setting` nodes differ only by studio UUID, so one body applies to all three.

**The gate fails OPEN, deliberately.** It holds only when the row is explicitly
`source === 'followup'` **and** the flag is explicitly `false`, with the row lookup
wrapped in a try/catch. The asymmetry matters: a gate that wrongly holds would stop
ordinary scheduled callbacks — an existing feature — whereas one that wrongly
doesn't hold merely lets a follow-up through. A missing `followups_enabled` (a
half-applied rollout) therefore behaves exactly as before the switch existed, which
is what makes the two edits order-independent.

`$('Loop Over Items')` is the row source rather than `Phone Number Formatting`, for
the same reason §8 gives for the ladder node: the formatting node drops every field
except the phone parts and `lead_id`, so `source` is not on it. `Resolve Field IDs`
already reads the loop item the same way in the same chain.

#### Verified (2026-08-06)

All three workflows validate with 0 errors. The **deployed** gate body was then
extracted and executed against a 15-case matrix — not read and reasoned about, per
the lesson from the earlier Code-node port that shipped two bugs past inspection.
Real `call_hours` and `timezone` for White Rock and Schaumburg, with the clock
pinned per case.

| Group | Cases | Result |
|---|---|---|
| New behaviour — follow-up row honours the switch | 2 | pass |
| **Ordinary callbacks ignore the switch entirely** (`manual`, `ai_agent`, no `source`) | 3 | pass |
| Fail-open (column missing, loop node unreachable) | 2 | pass |
| **Pre-existing holds still fire** (out-of-hours, closed day, failed studio fetch) | 8 | pass |

The middle two groups are the point of the exercise: they are the regressions this
change could plausibly have caused, and neither happened.

App side: 8 component tests in
[`__tests__/components/followups-toggle.test.tsx`](../../__tests__/components/followups-toggle.test.tsx)
covering both states, the reassurance copy, both flip directions, the staff role
gate, the super_admin bypass, and the revert-on-failure path. `tsc --noEmit` and
`next build` both clean.
