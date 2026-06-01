-- Migration 039: temporary debug capture for the Notion webhook receiver.
-- Records every incoming POST to /api/webhooks/notion BEFORE/around the signature check so we can
-- see exactly what Notion sends (signature header, our computed expectation, parsed page id, sync
-- result). Used to diagnose why real Notion edits weren't reflecting. Safe to drop once verified.
create table if not exists notion_webhook_debug (
  id            uuid primary key default gen_random_uuid(),
  received_at   timestamptz not null default now(),
  kind          text,            -- 'verification' | 'event' | 'parse_error'
  sig_provided  text,            -- the X-Notion-Signature header value, verbatim
  sig_expected  text,            -- our computed 'sha256=<hex>' over the raw body
  sig_match     boolean,         -- did they match?
  body_type     text,            -- body.type (e.g. page.properties_updated)
  entity_id     text,            -- body.entity.id
  entity_type   text,            -- body.entity.type
  sync_status   text,            -- result of syncOneNotionPageToSupabase
  sync_detail   jsonb,
  headers       jsonb,           -- all request headers (lowercased)
  raw_body      text             -- the raw request body, verbatim
);

-- RLS on, NO policies -> only the service role can read/write (not exposed to app users).
alter table notion_webhook_debug enable row level security;
