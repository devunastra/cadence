-- ─── conversations ───────────────────────────────────────────────────────────

create table if not exists public.conversations (
  id                text        primary key,            -- GHL conversation ID
  studio_id         uuid        not null references public.studios(id) on delete cascade,
  contact_id        text,
  contact_name      text,
  email             text,
  phone             text,
  last_message_body text,
  last_message_date timestamptz,
  unread_count      integer     not null default 0,
  type              text,
  updated_at        timestamptz not null default now()
);

alter table public.conversations enable row level security;

create policy "studio members can select conversations"
  on public.conversations for select
  using (
    studio_id in (
      select studio_id from public.studio_users where user_id = auth.uid()
    )
  );

-- ─── messages ────────────────────────────────────────────────────────────────

create table if not exists public.messages (
  id              text        primary key,              -- GHL message ID
  conversation_id text        not null references public.conversations(id) on delete cascade,
  studio_id       uuid        not null references public.studios(id) on delete cascade,
  direction       text        not null,                 -- 'inbound' | 'outbound'
  body            text,
  date_added      timestamptz,
  message_type    text,
  status          text,
  created_at      timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "studio members can select messages"
  on public.messages for select
  using (
    studio_id in (
      select studio_id from public.studio_users where user_id = auth.uid()
    )
  );

-- ─── Helper: atomically increment unread_count ───────────────────────────────

create or replace function public.increment_conversation_unread(conv_id text)
returns void language plpgsql security definer as $$
begin
  update public.conversations
  set unread_count = unread_count + 1
  where id = conv_id;
end;
$$;

-- ─── Realtime ────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
