-- Add per-studio color columns to studio_field_options
alter table studio_field_options
  add column if not exists bg   text,
  add column if not exists text text;

-- Rename enum values across all studios
update studio_field_options set value = 'Lost'   where field = 'level'  and value = 'Loss';
update studio_field_options set value = 'Guest'  where field = 'source' and value = 'Guests';
update studio_field_options set value = 'Event'  where field = 'source' and value = 'Events';

-- Add new enum options for all existing studios
insert into studio_field_options (studio_id, field, value)
select id, 'status', 'Wrong Location'
from studios
on conflict (studio_id, field, value) do nothing;

insert into studio_field_options (studio_id, field, value)
select id, 'action', 'AI Called'
from studios
on conflict (studio_id, field, value) do nothing;
