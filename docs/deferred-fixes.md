# Deferred Fixes

Things that are known issues but intentionally left for a future pass.

---

## ~~Activity Log — Appointment `old_value` always null~~ ✅ Fixed 2026-07-02

`rescheduleAppointment`, `updateAppointmentDetails`, and `updateAppointmentStatus`
in `app/actions.ts` now select the pre-update columns and populate `old_value`
on their `activity_logs` writes.

---

## ~~Appointment webhook does not populate `leads.first_lesson` or sync to Notion~~ ✅ Fixed

`app/api/webhooks/ghl-appointment/route.ts` has a `syncAppointmentFirstLesson`
helper that recomputes `leads.first_lesson` as the earliest non-deleted
appointment for the contact and pushes it to Notion. Wired into the create,
`AppointmentUpdate`, `AppointmentReschedule`, and delete branches. Idempotent —
safe on GHL retries. Gated by `studios.notion_sync_appointments`.

**Related n8n fix (already done 2026-06-17):** the "Update Dashboard" HTTP
node in workflow `gcDhc61cSLTPXOKv` (Voice AI Functions, AMLS) now sends the
`x-ghl-secret` header. The same fix likely needs applying to
`Wgg5bQTPJYFsDSn8` (Voice AI Functions, AM Schaumburg) — tracked in
`docs/schaumburg-pending.md`.

**Chandler Myers backfill:** if not already run, still needed:

```sql
UPDATE leads SET first_lesson = (SELECT start_time FROM appointments WHERE id = 'MizaKOsMfZ1cmnD4kSBI')
WHERE id = '238b1c94-880a-49e9-ab16-ab2e7666e319';
```

Then trigger a Notion sync for her lead (manual edit + revert, or call
`syncLeadUpdateToNotion` directly).
