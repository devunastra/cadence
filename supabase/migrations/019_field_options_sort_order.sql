-- Add sort_order column for drag-and-drop reordering
alter table studio_field_options
  add column if not exists sort_order integer;

-- Seed initial sort order per (studio_id, field) group using insertion order
with ranked as (
  select id,
         row_number() over (partition by studio_id, field order by id asc) as rn
  from studio_field_options
)
update studio_field_options sfo
set sort_order = r.rn
from ranked r
where sfo.id = r.id;
