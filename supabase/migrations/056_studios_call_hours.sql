-- Migration 056: studios.call_hours
-- Per-studio OUTBOUND call window, editable in Settings → Business Profile.
--
-- Replaces three hardcoded `WINDOW` constants that lived in n8n Code nodes:
--   Lincolnshire  "Improved Make Workflow v2"          → Get Central Time CST/CDT + Check Call Hours
--   Schaumburg    "AM Schaumburg Inquiries Workflow"   → Calc Schaumburg Call Window
--   White Rock    "AM White Rock Inquiries Workflow"   → Calc White Rock Call Window
--
-- Shape: jsonb map of day-of-week ("0" = Sunday … "6" = Saturday) to either
-- {"open": "HH:MM", "close": "HH:MM"} or null (closed that day). Day keys match
-- the existing studios.appointment_slots convention. Times are wall-clock in the
-- studio's OWN timezone (studios.timezone) — that column is the only source of
-- offset truth, which is what retires the hand-rolled DST arithmetic in the
-- White Rock node (it computed PDT/PST changeover dates by hand).
--
--   {"0": null, "1": {"open":"12:00","close":"20:00"}, ...}
--
-- SEMANTICS — read carefully, the two "empty" states are not the same:
--   call_hours IS NULL   → no window configured → outbound calls allowed 24/7.
--                          This is the default so the column is purely additive:
--                          studios that never had a window keep behaving as they do.
--   call_hours = '{}'    → same as NULL (no day has a window) → treated as 24/7.
--   every day explicitly null → studio never places outbound calls.
--
-- A window with close <= open is treated as CLOSED, not as an overnight wrap.
-- Overnight windows are deliberately unsupported; the UI validates open < close.
--
-- This gates OUTBOUND dialing only. Inbound calls are answered by Retell at the
-- phone-number level and are unaffected by this column.
--
-- Idempotent: safe to re-run.

ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS call_hours jsonb;

COMMENT ON COLUMN studios.call_hours IS
  'Outbound call window: day-of-week ("0"=Sun.."6"=Sat) -> {"open":"HH:MM","close":"HH:MM"} or null (closed). Wall-clock in studios.timezone. NULL/empty column = no restriction (24/7). Gates outbound dialing only; inbound is unaffected.';

-- ── Seed: mirror what is hardcoded in n8n TODAY, exactly ──────────────────────
--
-- The point of seeding is that deploying this migration changes NO behaviour.
-- Each studio's window below was read off its live n8n Code node on 2026-08-05.
-- Studios not listed here stay NULL (24/7), which is also what they do today —
-- their inquiry pipelines have no call-window node at all.
--
-- Name-based lookup matches migrations 043 and 051. No-op where a name doesn't
-- match. WHERE call_hours IS NULL keeps a re-run from stomping later UI edits.

-- Lincolnshire — 08:00–22:00 every day.
-- Source: "Improved Make Workflow v2" → Check Call Hours (hour >= 8 AND hour < 22,
-- America/Chicago), which applies no day-of-week condition.
UPDATE studios
SET call_hours = '{
  "0": {"open": "08:00", "close": "22:00"},
  "1": {"open": "08:00", "close": "22:00"},
  "2": {"open": "08:00", "close": "22:00"},
  "3": {"open": "08:00", "close": "22:00"},
  "4": {"open": "08:00", "close": "22:00"},
  "5": {"open": "08:00", "close": "22:00"},
  "6": {"open": "08:00", "close": "22:00"}
}'::jsonb
WHERE name = 'Arthur Murray Lincolnshire' AND call_hours IS NULL;

-- Schaumburg — Tue–Fri 13:00–21:00, Sat 10:00–15:00, closed Sun/Mon.
-- Source: "AM Schaumburg Inquiries Workflow" → Calc Schaumburg Call Window.
UPDATE studios
SET call_hours = '{
  "0": null,
  "1": null,
  "2": {"open": "13:00", "close": "21:00"},
  "3": {"open": "13:00", "close": "21:00"},
  "4": {"open": "13:00", "close": "21:00"},
  "5": {"open": "13:00", "close": "21:00"},
  "6": {"open": "10:00", "close": "15:00"}
}'::jsonb
WHERE name = 'Arthur Murray Schaumburg' AND call_hours IS NULL;

-- White Rock — Mon–Thu 12:00–20:00, Fri 12:00–19:00, closed Sat/Sun.
-- Source: "AM White Rock Inquiries Workflow" → Calc White Rock Call Window.
-- Friday closes earlier because the last lesson ends 19:30.
UPDATE studios
SET call_hours = '{
  "0": null,
  "1": {"open": "12:00", "close": "20:00"},
  "2": {"open": "12:00", "close": "20:00"},
  "3": {"open": "12:00", "close": "20:00"},
  "4": {"open": "12:00", "close": "20:00"},
  "5": {"open": "12:00", "close": "19:00"},
  "6": null
}'::jsonb
WHERE name = 'Arthur Murray White Rock' AND call_hours IS NULL;
