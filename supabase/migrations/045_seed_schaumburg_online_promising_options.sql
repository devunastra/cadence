-- Seed two field options for Arthur Murray Schaumburg (aeefb977-5d03-4e40-994a-327cb51b7918)
-- needed by the one-time historical Notion -> Supabase lead import.
-- 730 historical Notion leads carry source "Online" and 17 carry action "Promising"; neither value
-- existed in Schaumburg's seeded options, so the import would otherwise null those columns. Joshua
-- approved seeding both: it preserves the real Notion values AND keeps the 2-way Notion<->Supabase
-- sync free of mismatch churn (Notion "Online"/"Promising" now resolve to a real option uuid).
-- leads.source/action are uuid FKs to studio_field_options (migration 006), scoped per studio.
-- bg/text/sort_order left null to match every other Schaumburg option (the app applies default colors).
-- Idempotent via the (studio_id, field, value) unique constraint from migration 020.

insert into studio_field_options (studio_id, field, value, bg, text, sort_order)
values
  ('aeefb977-5d03-4e40-994a-327cb51b7918', 'source', 'Online',    null, null, null),
  ('aeefb977-5d03-4e40-994a-327cb51b7918', 'action', 'Promising', null, null, null)
on conflict (studio_id, field, value) do nothing;
