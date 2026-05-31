-- Migration 038: capture Notion webhook verification tokens during subscription setup.
-- When the workspace owner creates the webhook subscription, Notion POSTs a one-time
-- verification_token to our endpoint. We store it here so it can be retrieved (service-role
-- only) and pasted back into Notion to confirm the subscription.
create table if not exists notion_webhook_verifications (
  id         uuid primary key default gen_random_uuid(),
  token      text not null,
  created_at timestamptz not null default now()
);

-- RLS on, NO policies -> only the service role can read/write (not exposed to app users).
alter table notion_webhook_verifications enable row level security;
