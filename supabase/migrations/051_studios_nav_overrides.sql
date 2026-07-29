-- Migration 051: studios.nav_overrides
-- Per-studio sidebar tab visibility, toggled by super_admin in Settings → Studios.
--
-- Shape: jsonb map of nav href -> boolean, e.g. {"/conversations": false, "/test": true}.
-- Semantics: an EXPLICIT override. A missing key means the tab uses its built-in
-- default (see lib/nav.ts NAV_PAGES). Empty '{}' = every tab at its default, which
-- is how existing studios behave after backfill.
--   - Most tabs default visible (Conversations, Appointments, Call Analytics, ...).
--   - The dev /test tab defaults hidden; a studio can opt in with {"/test": true}.
--   - /leads is core (never in this map) and is always visible.
--
-- Only super_admin writes this (see setStudioNavOverrides in app/actions.ts).
-- Idempotent: safe to re-run. NOT NULL DEFAULT backfills existing rows to '{}'.

ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS nav_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN studios.nav_overrides IS
  'Sidebar tab visibility overrides: nav href -> boolean. Missing key = tab default (lib/nav.ts). Super-admin managed.';

-- Seed: Schaumburg and White Rock don't use Conversations yet — hide the tab.
-- Name-based lookup (matches migration 043). Merge (||) preserves any other
-- overrides. No-op where the name doesn't match. Idempotent.
UPDATE studios
SET nav_overrides = nav_overrides || '{"/conversations": false}'::jsonb
WHERE name IN ('Arthur Murray Schaumburg', 'Arthur Murray White Rock');
