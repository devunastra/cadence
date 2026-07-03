# Spec: Appointment → Lead `first_lesson` → Notion Sync

When an appointment is booked or rescheduled, set the linked lead's `first_lesson` to the earliest scheduled appointment for that contact, then let the existing lead→Notion push carry the value into the studio's Notion database.

---

## Decisions (locked)

| | Choice | Reason |
|---|---|---|
| **Scope** | Per-studio toggle | New `studios.notion_sync_appointments boolean DEFAULT false`. Mirrors Joshua's `notion_create_unmatched` pattern. Flip on for Lincolnshire to start. |
| **Events** | Created + Rescheduled | `AppointmentReschedule` and `AppointmentUpdate` where `start_time` changes both flow through the same recompute. Delete is out of scope. |
| **Overwrite policy** | Keep earliest `start_time` | `first_lesson` literally means "the first lesson." We recompute by querying the earliest non-deleted appointment for the contact, not by remembering history. |

---

## Trigger point

`app/api/webhooks/ghl-appointment/route.ts` — same convergence point as the notification fan-out.

Runs after the appointment upsert, on these branches:

| Branch | Run sync? |
|---|---|
| `verb === 'Created'` | ✅ |
| `payload.type === 'AppointmentReschedule'` | ✅ |
| `payload.type === 'AppointmentUpdate'` | ✅ (recompute is idempotent — safe even if `start_time` didn't change) |
| `payload.type === 'AppointmentStatusUpdate'` | ❌ status change doesn't affect time |
| `payload.type === 'AppointmentDelete'` | ❌ out of scope (see Open question #1) |

---

## Algorithm (recompute, not incremental)

The "keep earliest" semantic is cleanest expressed as a recompute. After every triggering write:

```
1. Read studios.notion_sync_appointments for this studio. If false → exit.
2. Look up lead where ghl_contact_id = appointment.contact_id AND studio_id = appointment.studio_id.
   If no lead → exit (skip; lead may not exist yet, esp. in Schaumburg's Notion-create flow).
3. Query the earliest non-deleted appointment with non-null start_time for (studio_id, contact_id).
4. If earliest.start_time === lead.first_lesson → exit (no change).
5. UPDATE leads SET first_lesson = earliest.start_time WHERE id = lead.id.
6. Call syncLeadUpdateToNotion with { first_lesson: earliest.start_time }.
   Already gated by notionSyncMode() and respects notion_page_id IS NULL.
```

**Why recompute beats incremental:** GHL webhook retries become free no-ops. Out-of-order delivery (e.g., reschedule before original create) self-heals. No need to track which appointment "owns" `first_lesson`.

---

## Data model

### Migration `048_notion_sync_appointments.sql` (new — choose this number to dodge the 047 collision)

```sql
ALTER TABLE studios
  ADD COLUMN notion_sync_appointments boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN studios.notion_sync_appointments IS
  'When true, the GHL appointment webhook updates the linked lead''s first_lesson to the earliest scheduled appointment for the contact, then pushes via the existing lead→Notion sync.';

-- Enable for Arthur Murray Lincolnshire only.
UPDATE studios SET notion_sync_appointments = true
  WHERE id = '71274499-7c29-4621-990f-b60669ed1de3';
```

No schema changes to `leads`, `appointments`, or `user_preferences`.

---

## Edge cases

| Case | Behavior |
|---|---|
| Contact has no linked lead in our DB | Skip silently. Lead may be created later by Notion sync; the next appointment touch will pick it up. |
| Multiple leads with the same `ghl_contact_id` in one studio | Update first match only (`.limit(1)`). Shouldn't happen given existing deduplication, but won't crash if it does. |
| `notionSyncMode()` is `'off'` | `syncLeadUpdateToNotion` no-ops. DB-side `first_lesson` still gets updated. Acceptable — the value is correct locally and will push when Notion sync is re-enabled. |
| `notionSyncMode()` is `'log'` | Logs a sync_log row, doesn't actually push. Existing behavior — we don't change it. |
| Studio has `notion_leads_db_id IS NULL` | Lead has no `notion_page_id` either → `syncLeadUpdateToNotion` no-ops. Same as above. |
| GHL webhook retries the same payload | Recompute returns the same value, exit at step 4. No duplicate writes. |
| Reschedule changes the appointment that *was* the earliest | New earliest gets picked; `first_lesson` updates to it. |
| Reschedule changes an appointment that was NOT the earliest | Earliest unchanged, exit at step 4. No-op. |
| Lead's `first_lesson` was manually edited in Notion | Existing rule (`lib/notion.ts:165` comment: `first_lesson → Supabase-authoritative`) means the next Notion→app pull would already overwrite the Notion edit. This spec doesn't change that — we're consistent with the existing direction-of-truth. |

---

## Out of scope (v1)

- **`AppointmentDelete` handling.** If the appointment that was the earliest gets deleted, `first_lesson` stays pointing at the deleted appointment's time. Not ideal but acceptable for v1. Adding it later means triggering the same recompute on delete — small change.
- **Backfilling existing appointments.** Lincolnshire has 8 leads with appointments and 7 of them have `first_lesson = NULL`. A one-shot script could rewrite history, but it's out of scope for this spec.
- **Updating `last_contacted` from appointment creation.** Out of scope — separate field, separate semantics.
- **Cross-studio appointments.** Each appointment is studio-scoped; one contact in two studios stays separate.
- **Activity log entry for the lead update.** The webhook already writes an `appointment_created`/`appointment_updated` activity_logs row. Adding a separate "lead first_lesson updated by appointment sync" row would be noise.

---

## Build order

| # | Task | Files |
|---|---|---|
| 1 | Migration — `notion_sync_appointments` column + flip Lincolnshire | `supabase/migrations/048_notion_sync_appointments.sql` |
| 2 | Helper `syncAppointmentFirstLesson` at the bottom of the webhook | `app/api/webhooks/ghl-appointment/route.ts` |
| 3 | Call it on the three triggering branches | same file |
| 4 | Settings UI toggle in Business Profile (super_admin only?) | `components/settings/business-profile-form.tsx` — *optional polish; not blocking* |
| 5 | QA |  — |

---

## QA matrix

| Scenario | Expected |
|---|---|
| Lincolnshire — new appointment booked, lead has `first_lesson = NULL` | `first_lesson` set to appointment's start_time; Notion First Lesson updated |
| Lincolnshire — second appointment booked later than the first | `first_lesson` unchanged (still earliest); Notion unchanged |
| Lincolnshire — second appointment booked **earlier** than the first | `first_lesson` updates to the new earlier time; Notion updated |
| Lincolnshire — appointment rescheduled to an even later time, was the earliest | `first_lesson` updates to the new (still-earliest) time; Notion updated |
| Lincolnshire — appointment rescheduled, was not the earliest | No-op |
| Lincolnshire — appointment booked but no matching lead | Silent skip, no error |
| Schaumburg — `notion_sync_appointments = false` by default | No sync, no Notion writes |
| Schaumburg flipped on later | Behaves like Lincolnshire |
| Notion sync mode off | DB updates, Notion does not |
| GHL retries same payload twice | One DB update on first attempt, no-op on retry |
| Lead has `notion_page_id = NULL` | DB updates, Notion sync no-ops cleanly |
| Appointment deleted (out of scope) | `first_lesson` stays — known limitation |

---

## Resolved decisions

1. **Lincolnshire + Schaumburg flipped on** in migration 048.
2. **No Settings UI** in v1 — super_admin can flip the column via SQL.
3. **Timezone is handled by existing helpers.** `syncLeadUpdateToNotion` fetches `studios.timezone` and passes it to `buildNotionProperties`. For a `first_lesson` ISO with time, `notionDateValue` converts to studio-local wall-clock and emits `{ start, time_zone }` so Notion shows the correct local time. The webhook helper writes a canonical UTC ISO via `new Date(start_time).toISOString()`.
4. **`leads.first_lesson` is `text` by design.** See `rules/architecture.md` § "Date columns stored as `text`". The helper produces canonical ISO strings to match the existing contract.
5. **n8n is not in the loop for this feature.** The webhook consumes existing GHL appointment events. The n8n reschedule relay (line 94 comment) already sends `AppointmentReschedule` for the existing chip feature; no new n8n work required.

---

## Addendum (2026-07-03): Action → "Scheduled" on booking

Client-reported gap (2026-07-01 booking): when the AI booked, the lead's **Action** stayed "AI Called" on the dash and in Notion — the client had to set "Scheduled" manually in Notion. Root cause: no system wrote Action on booking. n8n sets "AI Called" at dial time and "Did Not Answer" post-call, but the booking path (n8n `Update Dashboard` → this webhook) never touched Action.

**Fix** — `syncLeadActionScheduled` in the same webhook, called on `verb === 'Created'` only (not reschedules, not status updates, not deletes):

```
1. Look up lead by (studio_id, ghl_contact_id). No lead → skip.
2. Resolve the studio's studio_field_options row (field='action', value='Scheduled').
   Missing option → skip with console.warn (leads.action stores option UUIDs, not labels).
3. lead.action already that id → exit (GHL-retry no-op).
4. UPDATE leads SET action = <option id>  — NOT gated by notion_sync_appointments;
   the dash must be right even for studios with no Notion board.
5. Notion push via syncLeadUpdateToNotion({ action: 'Scheduled' }) — label per the
   NOTION_ENUM_FIELDS contract — gated by studios.notion_sync_appointments,
   same as the first_lesson sync.
```

Covers every booking source that reaches this webhook: AI bookings (n8n `Update Dashboard` sends no `type` → verb `Created`), in-app calendar bookings (GHL fires the webhook back), native GHL bookings.

**Open product questions (deliberately not built):** cancellation does not revert Action; booking overwrites any prior Action value (including "DO NOT CALL") — flagged to client, awaiting their call.
