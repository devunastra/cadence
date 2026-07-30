# Spec: Studio-Local Appointment Booking (no GHL)

**Status:** App layer **implemented and contract-tested**. n8n + Retell rewire pending deploy.
**Author:** drafted 2026-07-28, implemented same day
**First consumer:** Arthur Murray White Rock (`bbd9233a-2352-4997-8d18-d7791296f549`)

---

## Implementation status

| Piece | State |
|---|---|
| Migration `051_local_appointment_slot_uniqueness.sql` | ✅ applied |
| `lib/appointment-availability.ts` | ✅ |
| `lib/appointment-booking.ts` (shared persist) | ✅ |
| `app/actions.ts` — create / reschedule / delete / details / status branched | ✅ |
| `GET /api/appointments/availability` | ✅ |
| `POST /api/appointments` | ✅ |
| `PATCH · DELETE /api/appointments/[id]` | ✅ |
| `proxy.ts` — `/api/appointments` public path | ✅ |
| `N8N_APPOINTMENTS_SECRET` documented in `.env.example` | ✅ |
| **Set the secret in Netlify** | ⬜ deploy step |
| **n8n rewire (White Rock workflow only)** | ⬜ blocked on deploy |
| **Retell tool URLs** | ⬜ follows n8n |

### Contract test, run against the dev server

| # | Case | Result |
|---|---|---|
| 1 | No / wrong secret | `401 Unauthorized` |
| 2 | **Lincolnshire studio_id** | `409 studio_uses_ghl` — refused |
| 3 | White Rock, Wednesday | 9 slots, `America/Vancouver` |
| 4 | White Rock, Monday | `closed: true`, no slots |
| 5 | Create 14:00 | `200`, uuid id, 45-min end |
| 6 | Availability after create | 14:00 gone |
| 7 | Book 14:00 again | `409 slot_taken` + 3 alternatives |
| 8 | Reschedule → 18:00 | `200` |
| 9 | Availability after | 14:00 back, 18:00 gone |
| 10 | Cancel | `200` |
| 11 | Availability after cancel | all 9 free |

Test row was hard-deleted afterwards; `appointments` is back to 43 rows, all Lincolnshire.

### Deviations from the spec as drafted

- **The unique index is scoped to `calendar_id IS NULL`**, not all rows. All 43 existing
  rows are GHL-backed, so the index matches zero of them and cannot constrain Lincolnshire
  or Schaumburg. GHL remains their arbiter. This also made the migration apply with no data
  cleanup, which a table-wide index would have required — 15 test rows violate it.
- **Defect 1 was in three functions, not one** — `rescheduleAppointment`,
  `updateAppointmentDetails`, `updateAppointmentStatus`. All three fixed. Without that,
  a local appointment could not be moved, edited, *or* marked showed/no-show.
- **`persistAppointment` was extracted** to `lib/appointment-booking.ts` so the dashboard
  action and the API route share one write path instead of drifting.
- **`proxy.ts` needed a new public path.** Not in the draft; the routes were silently
  307-redirecting to `/login` and would have been unreachable from n8n.

---

## Summary

Let a studio with no GHL configuration take, move, and cancel appointments entirely
inside Cadence — availability computed from `studios.appointment_slots` minus booked
`appointments` rows, instead of GHL's free-slots API. Adds API routes so the Retell voice
agent can reach the same logic through n8n.

Studios that *do* have GHL keep their current path byte-for-byte.

---

## Why now

`createAppointment` hard-fails without GHL ([`app/actions.ts:2846`](../../app/actions.ts)):

```ts
if (!studio.ghl_account_id)  return { error: 'This studio is not connected to GHL…' }
if (!studio.ghl_calendar_id) return { error: 'No GHL calendar configured…' }
```

So today a studio without GHL cannot book at all — not from the dashboard, not from the
voice agent. The client has said most future studios won't have GHL, so every new studio
hits this wall. White Rock is simply the first.

---

## Users

This feature adds no new UI and no new permissions. The dashboard-side behavior change is
that the calendar's create/edit flows **start working** for non-GHL studios instead of
erroring.

| Role | What changes |
|---|---|
| `super_admin` | Can book/reschedule/cancel for a non-GHL studio. Unchanged for GHL studios. |
| `studio_owner` | Same — existing calendar permissions, now functional without GHL. |
| `studio_staff` | Same — existing calendar permissions, now functional without GHL. |

The **new** caller is machine, not human: n8n (on behalf of the Retell agent) hitting the
new API routes. It authenticates with a shared secret, not a user session — see
*Auth for API routes* below.

---

## Scope

### MVP

1. **Availability** — a function returning bookable slots for a studio + date:
   `getSlotsForDate(config)` minus `appointments` rows for that studio/date, minus
   anything before the min-advance cutoff.
2. **Branch the three mutations** in `app/actions.ts` on GHL config presence:
   `createAppointment`, `rescheduleAppointment`, `deleteAppointment`.
3. **Three API routes** so n8n can reach availability / create / cancel.
4. **Rewire White Rock's n8n workflow** off GHL onto those routes.

### Out of scope for MVP

| Deferred | Why |
|---|---|
| Backfilling local appointments into GHL if a studio adds GHL later | One-way migration, no demand yet. Local and GHL studios simply diverge. |
| Multi-instructor / capacity > 1 per slot | Current `appointment_slots` shape has no capacity concept. See Open Question 4. |
| Caller-initiated reschedule/cancel by phone lookup | Needs an appointment-lookup-by-contact endpoint. See Open Question 1. |
| Two-way sync or conflict resolution between local and GHL | Not applicable — a studio is one mode or the other. |
| Notifications / reminders for locally-booked appointments | `notified_at` exists; wiring it is separate work. |

---

## Acceptance Criteria

- [ ] A studio with `ghl_account_id` and `ghl_calendar_id` set produces **identical**
      network calls and DB writes to today — verified by regression test on Lincolnshire.
- [ ] A studio with neither set can create an appointment from the calendar UI; a row
      lands in `appointments` with a generated `id`, correct `studio_id`, and
      `calendar_id = null`.
- [ ] Availability for a non-GHL studio returns config slots minus booked ones.
- [ ] A slot already booked does not appear in availability.
- [ ] Booking a slot that was taken between fetch and submit fails with a clear,
      user-facing message — not a 500 and not a silent double-book.
- [ ] `rescheduleAppointment` works on a locally-created appointment
      (**currently impossible — see Defect 1**).
- [ ] `deleteAppointment` soft-deletes locally with no GHL call attempted.
- [ ] `appointment_events` rows are written for Created / Updated / Deleted so the
      conversation thread chips behave the same as GHL studios.
- [ ] `activity_logs` entries written for create / reschedule / delete, same
      `event_type` values as today.
- [ ] The API routes reject requests without a valid shared secret.
- [ ] The API routes are studio-scoped — a request for studio A cannot read or write
      studio B's appointments.
- [ ] Retell agent can complete a booking end-to-end against White Rock's workflow.

---

## Defects found while speccing

### Defect 1 — reschedule is unreachable for local appointments

[`app/actions.ts:2514`](../../app/actions.ts):

```ts
if (!appt?.calendar_id) return { error: 'Appointment not found' }
```

`calendar_id` is the **GHL calendar ID**. A locally-created appointment has none, so this
guard reports "Appointment not found" for a row that plainly exists. The guard is really
a null-check being used as an existence check.

**Fix:** split it — check the row exists, then branch on `calendar_id` for the GHL call.

### Defect 2 — `appointment_min_advance_weeks` is applied as days

[`lib/appointment-slots.ts:26`](../../lib/appointment-slots.ts):

```ts
// appointment_min_advance_weeks is treated as days (e.g. 1 = tomorrow).
const minDate = new Date(now.getTime() + config.appointment_min_advance_weeks * 86_400_000)
```

The column says weeks; the code multiplies by one day. Both live studios have the value
`1`, so today it means "tomorrow" rather than "next week". This is pre-existing and the
comment shows it is deliberate, but the voice agent will *speak* this rule to callers, so
the intent needs confirming before it is repeated aloud. See Open Question 3.

---

## Edge Cases

| # | Category | Scenario | Expected behavior | Severity |
|---|---|---|---|---|
| 1 | Concurrency | Two callers book the same slot simultaneously | DB constraint rejects the second; caller hears "that just got taken" and is offered alternates | **High** |
| 2 | Concurrency | Slot taken between the agent reading availability and confirming | Same as #1 — the create call is the source of truth, never the earlier read | **High** |
| 3 | Data | Studio has `appointment_slots = {}` | Availability returns empty; agent says no availability rather than erroring | High |
| 4 | Data | Requested date is a closed day | Empty slot list, distinct from "all booked" so the agent can say "we're closed" vs "fully booked" | Medium |
| 5 | Data | Requested date is in the past | Rejected by min-advance check | Medium |
| 6 | Data | Requested date is beyond any sane horizon (e.g. 2099) | Config slots exist for the weekday, so it would "succeed". Cap the lookahead window | Medium |
| 7 | Time | Slot strings are studio-local wall clock; `appointments.start_time` is `timestamptz` | Compare via `naiveStudioLocalToUtcIso()` (already used at `actions.ts:2573`) — never compare raw strings | **High** |
| 8 | Time | DST transition day — a slot time that doesn't exist or occurs twice | Document behavior; Vancouver and Chicago both shift, so this is not White Rock-specific | Medium |
| 9 | State | Appointment soft-deleted (`deleted_at` set) | Must **not** occupy its slot — availability filters on `deleted_at is null` | **High** |
| 10 | State | Appointment status is cancelled/no-show | Decide whether it frees the slot. See Open Question 5 | Medium |
| 11 | Permissions | API route called with a valid secret but a `studio_id` the caller shouldn't touch | Routes take `studio_id` explicitly; secret is global, so there is no per-studio authz. See Open Question 2 | **High** |
| 12 | Permissions | Studio has GHL configured but someone calls the local create route | Reject — a GHL studio must not get local-only rows that never reach GHL | High |
| 13 | Webhook | GHL appointment webhook fires for a studio now in local mode | Cannot happen (no GHL config), but the handler resolves studio by `locationId` and would no-op | Low |
| 14 | Network | n8n reaches the route but the DB write times out | Route returns a non-2xx; agent must not claim the booking succeeded | **High** |
| 15 | Data | Lead exists in Supabase but has no phone or email | Create still succeeds — `contact_id` is nullable; store `contact_name` | Low |
| 16 | Data | Same person books twice for different times | Allowed. Not a duplicate. | Low |
| 17 | Browser | Calendar UI shows a slot that was booked seconds ago by the agent | Realtime `appointments` subscription already exists on `calendar-shell.tsx` and covers this | Low |
| 18 | Session | Dashboard user's studio membership revoked mid-form | Existing auth guards in the server actions already cover this | Low |

---

## Affected Layers

### DB
One migration:
- Partial unique index enforcing one appointment per studio per start time:
  `create unique index … on appointments (studio_id, start_time) where deleted_at is null`
- **Blocked on Open Question 4** — wrong if a studio can run concurrent lessons.
- Must check existing rows for violations before applying.

No column changes. `appointments.id` is already `text`, so a generated UUID string fits
with no schema change, and `appointment_events` has no FK to `appointments`.

### RLS
No policy changes. `appointments` is already `studio_id`-scoped. The new API routes use
the service client and must enforce scoping in code, as the existing webhook routes do.

### Server actions (`app/actions.ts`)
- `createAppointment` — branch on GHL config; local path generates the id, skips contact
  resolution, inserts directly
- `rescheduleAppointment` — fix Defect 1, branch the GHL PUT
- `deleteAppointment` — branch the GHL DELETE (already non-fatal)

### New lib
- `getAvailableSlotsForDate(studioId, date)` — config slots minus booked. Wraps the
  existing `getSlotsForDate` so the UI and the agent share one implementation.

### API routes (new, under `app/api/`)
Must be routes, not server actions — n8n calls them over HTTP.

| Route | Method | Purpose |
|---|---|---|
| `/api/appointments/availability` | GET | slots for studio + date |
| `/api/appointments` | POST | create |
| `/api/appointments/[id]` | PATCH / DELETE | reschedule / cancel |

**Auth:** shared-secret bearer header, matching the pattern the GHL/Retell webhook routes
already use. Rate-limited via `lib/rate-limit.ts`.

### Components
No new components. `create-appointment-modal.tsx` and `appointment-modal.tsx` should call
the new availability helper so they stop offering booked slots — a real improvement for
GHL studios too, which today offer any configured slot regardless.

### Realtime
No new subscriptions. `calendar-shell.tsx` already subscribes to `appointments`, and
`conversations/page.tsx` to `appointment_events`.

### Activity logs
Reuse existing `event_type` values: `appointment_created`, `appointment_rescheduled`, and
whatever `deleteAppointment` writes today. Local path must log identically so the Activity
Log doesn't reveal which backend was used.

### Enum options
None. Appointment status stays hardcoded (`confirmed`), matching current behavior.

### n8n (White Rock workflow `QNRW2PHkiY0i3dij` only)
| Currently disabled | Replaced by |
|---|---|
| `Get Free Slots on GHL`, `…GHL1`, `…(Earliest)` | availability route |
| `Search Contact` + `Create New Event` | create route |
| `Update Appointment` | PATCH route |
| `Delete Event` | DELETE route |
| `Update Dashboard`, `HTTP Request`, `HTTP Request1` | **delete** — they existed only to mirror GHL writes back into Cadence; the app now writes directly |

Ten nodes become four calls. The workflow gets smaller.

**Response-shape constraint:** the conversation flow's respond nodes expect specific keys
(`is_available`, `is_available_summary`, `alt_time_1`, `summary`, `event_id`). The new
routes must either match these or the flow's respond nodes get updated in the same change.

---

## Dependencies

- **Depends on:** nothing external. Deliberately does *not* depend on a GHL sub-account.
- **Blocks:** White Rock taking a real booking; any future non-GHL studio.
- **Related:** the cross-studio lead-lookup bug in the voice workflow
  (`Get a row`, `Get a row2`, `Get Lead (ended)` match on phone/email with no `studio_id`
  filter). Not caused by this work, but the same code path — worth fixing together.

---

## Spec Validation

- [x] User flows documented — no new UI, permissions unchanged
- [x] Edge cases across the 8 categories
- [x] Backend requirements clear
- [x] Cross-studio isolation addressed (Edge 11, 12)
- [x] Acceptance criteria testable
- [x] Integration impact assessed (GHL, Retell, n8n)
- [x] Activity log coverage specified
- [x] Enum decision made (none needed)
- [x] Realtime specified (no change)
- [x] Migration scoped (one index, gated on OQ4)
- [ ] **UI states table — MISSING.** No new UI, but the calendar modals need an error
      state for "slot taken since you opened this form" that does not exist today.
- [ ] **Dark mode — N/A**, no new UI surfaces.
- [ ] **Filter persistence — N/A.**

---

## Open Questions

1. **Can a caller reschedule or cancel by phone?** Today the agent passes an `event_id`
   it received when booking, which only works within one call. A caller ringing back to
   move their lesson needs a lookup-by-phone/email endpoint. In scope, or defer?
2. **How should the API routes authorize per studio?** A single shared secret means any
   holder can act on any studio. Options: (a) accept it, since only our own n8n holds it;
   (b) per-studio secret; (c) derive the studio from the Retell agent ID in the payload.
   Recommend (a) for MVP with (c) as a hardening follow-up.
3. **Is `appointment_min_advance_weeks` meant to be days or weeks?** Code applies days
   (Defect 2). The agent will speak this rule aloud, so the intent must be settled.
4. **Can a studio run more than one lesson in the same slot?** Determines whether the
   unique index is correct. If capacity > 1 is ever needed, the constraint must be a
   count check instead, and `appointment_slots` needs a capacity concept.
5. **Do cancelled / no-show appointments free their slot?** Affects both the availability
   filter and the unique index predicate.
6. **Should GHL studios also get availability-minus-booked in the calendar UI?** They
   currently offer every configured slot regardless of bookings. Fixing it is a small
   bonus but widens the blast radius beyond non-GHL studios.

---

## Recommended Next Step

Settle Open Questions 3, 4 and 5 — they change the migration and the availability filter,
so they must be answered before code.

Then → `code-architect` for the implementation plan → `senior-software-engineer` to build
→ `qa-tester`, with the Lincolnshire regression test as the primary gate.
