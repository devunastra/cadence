-- Migration 058: user_preferences.hidden_columns
-- Per-user column visibility for the Leads table — the "Columns" dropdown in the
-- leads toolbar. Completes the trio of personal layout prefs on this row:
-- col_widths (how wide), col_order (what order), hidden_columns (what shows).
--
-- Shape: jsonb OBJECT keyed by lead view id, valued with the column keys that
-- user has hidden IN THAT VIEW:
--   {"all": ["old", "partnership"], "<lead_views.uuid>": ["email"]}
--
-- "all" is the permanent client-side Default View (lib/views.ts ALL_COLUMNS_VIEW),
-- which has no lead_views row — hence a plain text key rather than a FK.
--
-- WHY HIDDEN AND NOT VISIBLE — this is the load-bearing decision:
--   Storing what's HIDDEN means a column added to the app later (as `notes` was
--   in migration 052) shows up for everyone automatically, because it can't be
--   in a hidden list written before it existed. Storing what's VISIBLE would
--   silently bury every future column for anyone who had customised.
--
-- SEMANTICS:
--   hidden_columns = '{}'      → nothing hidden → the view's own column set shows.
--                                Default, so the column is purely additive.
--   key absent for a view      → same as above for that view.
--   stale keys (deleted view / removed column) are ignored on read, so nothing
--   has to clean up after a view delete.
--
-- SCOPE — personal, not studio-wide. `lead_views.columns` stays the SHARED
-- baseline a studio agrees on (edited via the view modal); this row only lets one
-- user drop columns from their own screen. A lightweight toolbar toggle must not
-- rearrange a colleague's table, which is exactly what writing to lead_views from
-- that toggle would do.
--
-- No RLS change needed — user_preferences policies already scope to auth.uid().
-- Idempotent: safe to re-run.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS hidden_columns jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN user_preferences.hidden_columns IS
  'Leads columns this user has hidden, per view: {"<view id>": ["col_key", ...]}. "all" = the permanent Default View. Stores hidden (not visible) keys so columns added to the app later appear by default. Personal — lead_views.columns remains the shared studio baseline.';
