create table studio_field_options (
  id        uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios(id) on delete cascade,
  field     text not null,
  value     text not null,
  unique(studio_id, field, value)
);

alter table studio_field_options enable row level security;

create policy "studio members can read field options"
  on studio_field_options for select
  using (
    studio_id in (
      select studio_id from studio_users where user_id = auth.uid()
    )
  );

create policy "studio members can insert field options"
  on studio_field_options for insert
  with check (
    studio_id in (
      select studio_id from studio_users where user_id = auth.uid()
    )
  );

create policy "studio members can update field options"
  on studio_field_options for update
  using (
    studio_id in (
      select studio_id from studio_users where user_id = auth.uid()
    )
  );

create policy "studio members can delete field options"
  on studio_field_options for delete
  using (
    studio_id in (
      select studio_id from studio_users where user_id = auth.uid()
    )
  );
