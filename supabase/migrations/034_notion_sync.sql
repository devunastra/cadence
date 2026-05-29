-- Migration 034: Notion 2-way sync foundations
-- Adds: per-studio Notion DB id, per-lead Notion linkage + bookkeeping,
-- a soft "archived in Notion" flag (NO hard deletes), and a sync audit log.
-- Fully additive + idempotent. Does NOT modify any existing lead data.

-- ── Per-studio Notion leads database id (token itself lives in env NOTION_API_KEY) ──
ALTER TABLE studios ADD COLUMN IF NOT EXISTS notion_leads_db_id text;

-- ── Lead linkage + sync bookkeeping ──
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notion_page_id          text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notion_last_synced_at   timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notion_last_edited_time timestamptz;  -- mirror of Notion last_edited_time for conflict checks
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notion_archived_at      timestamptz;  -- set when the Notion page is archived/deleted (item 6: flag, never hard-delete)

-- One Notion page maps to at most one lead (the link key)
CREATE UNIQUE INDEX IF NOT EXISTS leads_notion_page_id_key
  ON leads (notion_page_id) WHERE notion_page_id IS NOT NULL;

-- ── Sync audit / outbox log (observability + retries; also backs webhook + polling) ──
CREATE TABLE IF NOT EXISTS notion_sync_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id      uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  lead_id        uuid REFERENCES leads(id) ON DELETE SET NULL,
  notion_page_id text,
  direction      text NOT NULL CHECK (direction IN ('app_to_notion','notion_to_app')),
  action         text NOT NULL CHECK (action IN ('create','update','archive','skip','error')),
  detail         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notion_sync_log_studio_id  ON notion_sync_log(studio_id);
CREATE INDEX IF NOT EXISTS idx_notion_sync_log_lead_id    ON notion_sync_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_notion_sync_log_created_at ON notion_sync_log(studio_id, created_at DESC);

-- RLS — scope reads to the user's studios; writes happen via service role (bypasses RLS)
ALTER TABLE notion_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view notion sync log for their studios" ON notion_sync_log;
CREATE POLICY "Users can view notion sync log for their studios"
  ON notion_sync_log FOR SELECT
  USING (
    studio_id IN (
      SELECT su.studio_id FROM studio_users su WHERE su.user_id = auth.uid()
    )
  );

-- ── Wire Lincolnshire (AMLS) to its Notion leads DB (config value, not lead PII) ──
UPDATE studios
   SET notion_leads_db_id = 'd7c79e10b0fc4553903cec554bc0a1f5'
 WHERE id = '71274499-7c29-4621-990f-b60669ed1de3'
   AND notion_leads_db_id IS DISTINCT FROM 'd7c79e10b0fc4553903cec554bc0a1f5';
