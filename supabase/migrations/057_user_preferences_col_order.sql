-- Migration 057: user_preferences.col_order
-- Per-user, per-studio column order for the Leads table (drag a column header
-- left/right to rearrange). Sits alongside col_widths, which is already a
-- per-user layout preference — order is the same kind of personal setting, so
-- it lives in the same row rather than on the shared `lead_views` rows.
--
-- Shape: jsonb ARRAY of lead column keys, in display order:
--   ["name", "phone", "status", "created_at", ...]
--
-- SEMANTICS:
--   col_order = '[]'  → never reordered → canonical order (lib/views.ts
--                       ALL_COLUMN_KEYS). This is the default, so the column is
--                       purely additive: every existing row keeps today's layout.
--   otherwise         → the listed keys lead, in the order given. Keys the app
--                       no longer knows are ignored; columns added to the app
--                       after the preference was saved append at the end
--                       (resolveColumnOrder in lib/views.ts owns both rules).
--
-- The array holds EVERY column, not just the ones a view shows. Views decide
-- which columns are visible; this decides the order they appear in. That keeps
-- the order stable when the user switches view tabs.
--
-- No RLS change needed — the existing user_preferences policies already scope
-- select/insert/update to `user_id = auth.uid()` (migration 004).
--
-- Idempotent: safe to re-run.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS col_order jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN user_preferences.col_order IS
  'Leads table column order for this user + studio: jsonb array of column keys in display order, e.g. ["name","phone","status"]. Empty array = canonical order. Holds every column, not just the visible ones — views control visibility, this controls order.';
