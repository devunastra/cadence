create table user_preferences (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  studio_id      uuid not null references studios(id) on delete cascade,
  col_widths     jsonb not null default '{}',
  field_options  jsonb not null default '{}',
  active_view_id text not null default 'all',
  theme          text not null default 'light',
  updated_at     timestamptz not null default now(),
  unique(user_id, studio_id)
);

alter table user_preferences enable row level security;

create policy "users can select own preferences"
  on user_preferences for select
  using (user_id = auth.uid());

create policy "users can insert own preferences"
  on user_preferences for insert
  with check (user_id = auth.uid());

create policy "users can update own preferences"
  on user_preferences for update
  using (user_id = auth.uid());
