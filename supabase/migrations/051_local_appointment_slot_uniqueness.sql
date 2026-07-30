-- Migration 051: prevent double-booking for studios that have no GHL calendar.
--
-- Studios with GHL let GHL arbitrate slot contention — it rejects a conflicting
-- appointment before we ever write a row. Studios without GHL (White Rock is the
-- first) book straight into `appointments`, so nothing stops two callers taking
-- the same slot in the same second.
--
-- The index is deliberately scoped to LOCAL appointments only:
--
--   calendar_id IS NULL  -> row was created by us, not mirrored from GHL
--   deleted_at  IS NULL  -> cancelled/deleted appointments free their slot
--
-- Scoping it this way means GHL studios are completely unaffected. At the time
-- of writing all 43 existing rows carry a calendar_id, so this index matches
-- zero existing rows and applies without any data cleanup.
--
-- Capacity is assumed to be one lesson per studio per start time. That matches
-- every real booking in the data — the only same-slot duplicates were repeated
-- test bookings by a single contact. If a studio ever needs concurrent lessons,
-- this index must be replaced by a capacity-aware check and
-- `studios.appointment_slots` needs a capacity concept.
-- See docs/specs/local-appointment-booking.md, Open Question 4.

CREATE UNIQUE INDEX IF NOT EXISTS appointments_local_slot_unique
  ON public.appointments (studio_id, start_time)
  WHERE deleted_at IS NULL AND calendar_id IS NULL;

COMMENT ON INDEX public.appointments_local_slot_unique IS
  'One appointment per studio per start_time for locally-booked (non-GHL) studios. GHL-backed rows (calendar_id NOT NULL) are excluded — GHL arbitrates those.';
