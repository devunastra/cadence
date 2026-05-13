create table lead_views (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid references studios(id) on delete cascade not null,
  name        text not null,
  columns     jsonb not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);

alter table lead_views enable row level security;

create policy "studio members can read lead_views"
  on lead_views for select
  using (studio_id in (select studio_id from studio_users where user_id = auth.uid()));

create policy "studio members can insert lead_views"
  on lead_views for insert
  with check (studio_id in (select studio_id from studio_users where user_id = auth.uid()));

create policy "studio members can delete lead_views"
  on lead_views for delete
  using (studio_id in (select studio_id from studio_users where user_id = auth.uid()));

-- Trigger: seed 3 default views whenever a new studio is created
create or replace function seed_default_lead_views()
returns trigger as $$
begin
  insert into lead_views (studio_id, name, columns) values
    (NEW.id, 'Overview',          '["created_at","name","status","level","action","phone","last_contacted","comments"]'::jsonb),
    (NEW.id, 'Contact Details',   '["name","phone","email","status","source","available","comments"]'::jsonb),
    (NEW.id, 'Progress Tracker',  '["name","status","level","first_lesson","showed","bought","partnership","reason"]'::jsonb);
  return NEW;
end;
$$ language plpgsql security definer;

create trigger on_studio_created
  after insert on studios
  for each row execute function seed_default_lead_views();

-- Seed default views for studios that already exist
insert into lead_views (studio_id, name, columns)
select id, 'Overview', '["created_at","name","status","level","action","phone","last_contacted","comments"]'::jsonb
from studios;

insert into lead_views (studio_id, name, columns)
select id, 'Contact Details', '["name","phone","email","status","source","available","comments"]'::jsonb
from studios;

insert into lead_views (studio_id, name, columns)
select id, 'Progress Tracker', '["name","status","level","first_lesson","showed","bought","partnership","reason"]'::jsonb
from studios;
