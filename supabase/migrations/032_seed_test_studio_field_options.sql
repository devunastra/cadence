-- Seed field options for the "Test" studio by cloning Arthur Murray Lincolnshire's set.
-- Temporary stand-in for validating the n8n "AM Schaumburg Inquiries" workflow:
-- leads.status/level/action/source/reason are uuid FKs to studio_field_options, scoped per studio,
-- so a Test-studio lead needs Test-studio options to reference.
-- Depends on Lincolnshire's options already existing (seeded earlier). Idempotent via the
-- (studio_id, field, value) unique constraint from migration 020.

insert into studio_field_options (studio_id, field, value, bg, text, sort_order)
select
  'ff81ad9c-048d-4d79-944f-44d7df101b8b',  -- Test studio
  field, value, bg, text, sort_order
from studio_field_options
where studio_id = '71274499-7c29-4621-990f-b60669ed1de3'  -- Arthur Murray Lincolnshire
on conflict (studio_id, field, value) do nothing;
