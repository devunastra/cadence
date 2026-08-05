# AI Calling Hours — configurable outbound call window

**Status:** shipped end-to-end 2026-08-05. App + all 6 n8n workflows live.
**Last updated:** 2026-08-05

The client's request:

> is it possible to have a setting somewhere in the dashboard that can set when
> that specific agent is active? For example for Arthur Murray White Rock if I
> wanted it active from 9 AM to 10 PM I could simply edit it in the dashboard.

---

## 1. What changed

The call window already existed and already worked. It was **hardcoded in three
separate n8n Code nodes**, one per studio, so changing it needed a developer.
This moved it to `studios.call_hours` and put an editor in Settings → Business
Profile. Nothing about the *behaviour* was redesigned — the window was relocated.

Two things came along for free:

1. **DST arithmetic is gone.** Each node hand-rolled its own changeover dates
   (White Rock computed the second-Sunday-in-March / first-Sunday-in-November
   boundaries in local `Date` maths). Everything now derives offsets from the
   studio's IANA `timezone` via `Intl`, so it is correct for any zone.
2. **The dialer sweeps are gated too.** Previously only *new inquiries* respected
   the window; a callback scheduled by hand from Follow-ups for 03:00 was dialled
   at 03:00. See §4.

---

## 2. Schema

`studios.call_hours jsonb` — [migration 056](../../supabase/migrations/056_studios_call_hours.sql).

```json
{"0": null, "1": {"open": "12:00", "close": "20:00"}, ...}
```

Day keys are `"0"` (Sunday) … `"6"` (Saturday), matching the existing
`studios.appointment_slots` convention. Times are wall-clock in `studios.timezone`.

**The two "empty" states are not the same** — this is the part that bites:

| Value | Meaning |
|---|---|
| `NULL` | No window configured → **calls allowed 24/7** |
| `'{}'` | Same as NULL → 24/7 |
| Every day present and `null` | Studio **never** places outbound calls |

`NULL` is the column default, which is what made the migration purely additive:
studios that never had a window (the test studios) keep behaving exactly as before.

A window with `close <= open` is treated as **CLOSED**, never as an overnight
wrap. Overnight windows are deliberately unsupported — guessing wrong means
cold-calling at 2am, so the ambiguous input fails closed. The editor blocks it at
source and `normalizeCallHours` strips it server-side.

### Seeded values

Seeded to mirror what was hardcoded in n8n on 2026-08-05, so deploying changed
nothing:

| Studio | Window | Timezone |
|---|---|---|
| Lincolnshire | Every day 08:00–22:00 | America/Chicago |
| Schaumburg | Tue–Fri 13:00–21:00, Sat 10:00–15:00 | America/Chicago |
| White Rock | Mon–Thu 12:00–20:00, Fri 12:00–19:00 | America/Vancouver |
| Joshua Test / Dev Test / Dylan Test / Prod Test | NULL (24/7) | — |

---

## 3. Code

| Layer | Where |
|---|---|
| Window logic | [`lib/call-hours.ts`](../../lib/call-hours.ts) — `isWithinCallHours`, `nextCallWindowOpening`, `normalizeCallHours` |
| Tests | [`__tests__/lib/call-hours.test.ts`](../../__tests__/lib/call-hours.test.ts) — 57 cases, incl. both Vancouver DST crossings |
| Editor UI | [`components/settings/call-hours-editor.tsx`](../../components/settings/call-hours-editor.tsx) |
| Persistence | `updateStudio` in [`app/actions.ts`](../../app/actions.ts) — runs `normalizeCallHours` before the write |

**`call_hours` is never written unvalidated.** It feeds a decision to place phone
calls, so `updateStudio` normalizes it server-side regardless of what the client
sent. Malformed days and inverted windows collapse to `null` (closed) rather than
being stored as-is.

### The n8n port

n8n Code nodes can't import from `lib/`, so the logic is **duplicated** in each
workflow. That duplication is the maintenance cost of this design — if you change
`lib/call-hours.ts`, change the nodes too. Each node says so at the top.

The port was verified rather than eyeballed: the deployed node body was executed
against the real seeded window at **15-minute steps across all of 2026** (35,040
instants, covering both DST transitions) and compared to an independent reference
implementation. Zero mismatches. The TS implementation was then cross-checked
against the node's output on the same instants.

---

## 4. Where the window is enforced

Six workflows. Two different jobs.

### Inquiry workflows — decide call-now vs queue-for-later

| Workflow | ID | Node |
|---|---|---|
| Improved Make Workflow v2 (Lincolnshire) | `nbVcDIn35E7z5AgB` | `Get Central Time CST/CDT` + `Calc Next Call Window` |
| AM Schaumburg Inquiries Workflow | `rMbzNhw2XP7eBJQq` | `Calc Schaumburg Call Window` |
| AM White Rock Inquiries Workflow | `aPxHTPqPfsWWuQcw` | `Calc White Rock Call Window` |

Each gained a `Fetch Call Hours` HTTP node upstream that reads
`select=id,timezone,call_hours`. A lead arriving outside the window is **queued
for the next opening**, not dropped.

⚠️ **Lincolnshire's node name is now a misnomer.** `Get Central Time CST/CDT` no
longer does anything Central-specific. It was left named that way because
renaming a node means rewiring its connections, and the risk wasn't worth the
cosmetics. The node's own header comment says so.

### Dialer sweeps — hold a due row until the window opens

| Workflow | ID |
|---|---|
| Voice AI Functions (Lincolnshire) | `gcDhc61cSLTPXOKv` |
| Voice AI Functions (AM Schaumburg) | `Wgg5bQTPJYFsDSn8` |
| Voice AI Functions (AM White Rock) | `QNRW2PHkiY0i3dij` |

Each gained a `Call Window Gate` Code node between `Check Voice Agent Setting`
and `Voice Agent Enabled?`, and `Check Voice Agent Setting`'s select widened to
`voice_agent_enabled,call_hours,timezone` (one fetch, not two).

The gate returns `[]` when out of window, which stops the chain before anything
dials. **The row is left pending** — `called_at` stays null, so the next
30-minute sweep re-reads it and dials the moment the window opens. Nothing is
dropped and no extra state is needed.

> `gcDhc61cSLTPXOKv` was recorded as un-saveable via MCP in
> [`scheduled-calls.md`](./scheduled-calls.md) §"Lincolnshire is blocked", because
> of an orphaned disabled Gmail node. **That is no longer true** — `Send a message`
> is now connected from `Send a message2`, and the save went through. Both notes
> in that doc (the block, and G1's claim that Lincolnshire has no voice-agent
> guard) are stale.

---

## 5. Fail-closed behaviour

Every failure path refuses to dial rather than risking a 3am call:

| Condition | Inquiry workflows | Dialer gate |
|---|---|---|
| Studio fetch failed | Queue immediately; dialer gate holds it | Don't dial; retry next sweep |
| `call_hours` unparseable (string / number / array) | Queue immediately | Don't dial |
| `call_hours` NULL or `{}` | Call now (unrestricted) | Dial (unrestricted) |
| Every day closed | Drop — nothing sane to queue against | Don't dial |
| No opening within 7 days | Queue nothing rather than invent a time | n/a |
| Lead has no phone | Drop before queueing | n/a |

The inquiry side deliberately depends on the dialer gate as its backstop: on a
failed read it queues at `now` and lets the gate decide. This only works because
both halves shipped together.

---

## 6. Behaviour changes to be aware of

Everything above was designed to be behaviour-neutral except these:

1. **Lincolnshire out-of-hours leads now queue at 08:00, not 11:00.** The old
   `Calc Next Call Window` hardcoded 11:00 Chicago, which never matched the
   08:00 window the hours check itself used. It now queues against the studio's
   real opening time. Leads arriving overnight get called ~3 hours earlier.
2. **All three dialers now respect the window.** A callback scheduled from
   Follow-ups for an out-of-hours time will wait. Previously it dialled on time,
   whatever the hour.
3. **Schaumburg's held backlog got safer.** Its 4 pending rows are past-due and
   held by `voice_agent_enabled = false`. `scheduled-calls.md` §7 step 2 warns
   that three of them fire *immediately* when that switch flips. With the gate
   they now also have to wait for 13:00–21:00 Tue–Fri, so flipping the switch at
   2am no longer cold-calls anyone. The warning is softened, not removed — decide
   per row whether the call is still wanted.

---

## 7. Deliberately not done

- **Inbound calls are unaffected.** These hours gate outbound dialing only. If
  someone rings the studio's Retell number at 23:00 the AI still answers, because
  inbound is routed at the Retell phone-number level. Gating it is separate work
  and needs a product decision about what the caller hears instead.
- **One window per day.** No split shifts (e.g. 09:00–12:00 + 14:00–18:00). No
  studio needed it and it doubles the UI.
- **No per-agent windows.** The window is per *studio*, not per Retell agent. A
  studio with separate inbound/outbound agents shares one outbound window. The
  client's phrasing said "that specific agent", but every studio currently maps
  to one outbound agent, so studio-level is the same thing today.
- **±30 min precision is unchanged.** The sweep still runs every 30 minutes, so a
  window opening at 09:00 can dial at up to 09:29. Same trade-off as G2 in
  `scheduled-calls.md`.
- **The three workflow copies were not updated** — `Improved Make Workflow v2 copy
  (Joshua)` (`uzxG2c4AzQNz0y6M`), `Improved Make Workflow v2 copy 2`
  (`kYshxaD3z7QQXTzy`), and `Voice AI Functions copy (Joshua)`
  (`LXlMa0Gy2Fq2xuUO`, **active**). They still carry hardcoded windows and will
  drift.
