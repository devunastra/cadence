-- Migration 047: per-studio "create lead from unmatched Notion page" toggle.
-- When true, the Notion→app pull (syncNotionToSupabase) will INSERT a new lead for any
-- Notion page that has no matching lead (insert-only). Off by default; enabled per studio.
-- Fully additive + idempotent. Does NOT modify any existing lead data.

ALTER TABLE studios ADD COLUMN IF NOT EXISTS notion_create_unmatched boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN studios.notion_create_unmatched IS 'When true, the Notion→app pull will INSERT a new lead for any Notion page that has no matching lead (insert-only). Off by default; enabled per studio.';

-- Enable ONLY for Arthur Murray Schaumburg. No other studio is touched.
UPDATE studios SET notion_create_unmatched = true WHERE id = 'aeefb977-5d03-4e40-994a-327cb51b7918';
