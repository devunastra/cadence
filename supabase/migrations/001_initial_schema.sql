-- Studios table
CREATE TABLE studios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  location        text NOT NULL,
  logo_url        text,
  ghl_account_id  text NOT NULL DEFAULT '',
  retell_agent_id text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Studio users (maps auth.users → studios with a role)
CREATE TABLE studio_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id   uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('super_admin', 'studio_owner', 'studio_staff')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(studio_id, user_id)
);

-- Leads table
CREATE TABLE leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id       uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  name            text NOT NULL DEFAULT '',
  status          text,
  level           text,
  action          text,
  phone           text,
  email           text,
  last_contacted  timestamptz,
  first_lesson    timestamptz,
  comments        text,
  source          text,
  tick            boolean NOT NULL DEFAULT false,
  reason          text,
  available       text,
  showed          boolean NOT NULL DEFAULT false,
  bought          boolean NOT NULL DEFAULT false,
  partnership     text,
  old             boolean NOT NULL DEFAULT false,
  ghl_contact_id  text UNIQUE
);

-- Indexes for common queries
CREATE INDEX leads_studio_id_idx ON leads(studio_id);
CREATE INDEX leads_created_at_idx ON leads(studio_id, created_at DESC);
CREATE INDEX leads_status_idx ON leads(studio_id, status);
CREATE INDEX studio_users_user_id_idx ON studio_users(user_id);
