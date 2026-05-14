---
name: new-migration
description: Generate a properly named Supabase migration file with schema changes and RLS policies. Use when adding tables, columns, indexes, or policies.
---

# New Migration

Creates a properly structured Supabase migration file following AMLS conventions.

## Before You Start

Read `implementation_plan.md` for the existing schema to understand current tables and columns.

## Step 1: Determine the Change

Ask the user (or determine from context) what the migration needs:
- **New table** — schema + RLS policies + indexes
- **New columns** — ALTER TABLE + any policy updates
- **New RLS policies** — DROP IF EXISTS + CREATE POLICY
- **Index changes** — CREATE INDEX

## Step 2: Generate the Filename

Format: `YYYYMMDDHHMMSS_<descriptive_slug>.sql`

```bash
# Generate timestamp
date -u +"%Y%m%d%H%M%S"
```

Slug should be short and descriptive:
- `add_notes_to_leads`
- `create_notifications_table`
- `update_leads_rls_policies`
- `add_index_on_leads_studio_id`

## Step 3: Write the Migration

### For New Tables

Every new table MUST have:
1. `id` column (UUID, default `gen_random_uuid()`)
2. `studio_id` column (UUID, NOT NULL, FK to `studios.id`)
3. `created_at` column (timestamptz, default `now()`)
4. Row Level Security ENABLED
5. All four RLS policies (SELECT, INSERT, UPDATE, DELETE)

```sql
-- Create table
CREATE TABLE IF NOT EXISTS public.<table_name> (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  -- ... other columns ...
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.<table_name> ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- super_admin bypasses RLS, so policies only need to handle studio_owner and studio_staff

DROP POLICY IF EXISTS "<table_name>_select" ON public.<table_name>;
CREATE POLICY "<table_name>_select" ON public.<table_name>
  FOR SELECT USING (
    studio_id IN (
      SELECT su.studio_id FROM public.studio_users su
      WHERE su.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "<table_name>_insert" ON public.<table_name>;
CREATE POLICY "<table_name>_insert" ON public.<table_name>
  FOR INSERT WITH CHECK (
    studio_id IN (
      SELECT su.studio_id FROM public.studio_users su
      WHERE su.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "<table_name>_update" ON public.<table_name>;
CREATE POLICY "<table_name>_update" ON public.<table_name>
  FOR UPDATE USING (
    studio_id IN (
      SELECT su.studio_id FROM public.studio_users su
      WHERE su.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "<table_name>_delete" ON public.<table_name>;
CREATE POLICY "<table_name>_delete" ON public.<table_name>
  FOR DELETE USING (
    studio_id IN (
      SELECT su.studio_id FROM public.studio_users su
      WHERE su.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_<table_name>_studio_id ON public.<table_name>(studio_id);
```

### For New Columns

```sql
ALTER TABLE public.<table_name>
  ADD COLUMN IF NOT EXISTS <column_name> <type> <constraints>;
```

If the column affects RLS (e.g., a new role-gated field), update the relevant policies.

### For Policy Updates

Always DROP IF EXISTS before CREATE:

```sql
DROP POLICY IF EXISTS "<policy_name>" ON public.<table_name>;
CREATE POLICY "<policy_name>" ON public.<table_name>
  FOR <operation> USING (...);
```

## Step 4: Save the File

Write to `supabase/migrations/<timestamp>_<slug>.sql`

```bash
ls supabase/migrations/ | tail -5  # See recent migrations for naming convention
```

## Step 5: Validation Checklist

Before declaring the migration complete:

- [ ] Every new table has `studio_id` column with FK to `studios`
- [ ] RLS is ENABLED on every new table
- [ ] All four operations (SELECT/INSERT/UPDATE/DELETE) have policies
- [ ] Policies check `studio_users` membership via `auth.uid()`
- [ ] `DROP POLICY IF EXISTS` before every `CREATE POLICY`
- [ ] `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for idempotency
- [ ] Indexes on `studio_id` and any frequently filtered columns
- [ ] No raw data mutations (INSERT/UPDATE/DELETE of user data) — migrations are for schema only

## Step 6: Follow-Up

After the migration is written, remind the user:
1. Update `lib/types.ts` with any new TypeScript types
2. Add server actions to `app/actions.ts` if needed
3. Run the migration via Supabase dashboard or CLI
4. Test RLS policies with each role (super_admin, studio_owner, studio_staff)
