-- Cache for the Integration Health Monitor.
--
-- One row per (studio, integration) — upserted by the live-probe path in the
-- app and (later, v3b) by a scheduled probe. Reads happen server-side via the
-- service client; the RLS policy exists mainly for defense in depth.
--
-- integration values: 'ghl', 'retell', 'n8n_callbacks'
-- status values: 'ok', 'warn', 'error', 'unknown', 'not_configured'
--   (kept as text with a CHECK constraint rather than a Postgres enum so the
--    app-side HealthStatus union stays authoritative and enum churn doesn't
--    require an ALTER TYPE dance.)

CREATE TABLE studio_integration_health (
  studio_id       uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  integration     text NOT NULL CHECK (integration IN ('ghl', 'retell', 'n8n_callbacks')),
  status          text NOT NULL CHECK (status IN ('ok', 'warn', 'error', 'unknown', 'not_configured')),
  message         text,
  checked_at      timestamptz NOT NULL DEFAULT now(),
  latency_ms      integer,
  PRIMARY KEY (studio_id, integration)
);

CREATE INDEX studio_integration_health_studio_idx
  ON studio_integration_health (studio_id);

ALTER TABLE studio_integration_health ENABLE ROW LEVEL SECURITY;

-- studio_owner can read their own studios' cache rows. super_admin reads
-- happen via the service client in fetchAllStudioHealth, so they don't need a
-- policy row here (matches the `project_super_admin_rls_gap` pattern where
-- super_admin views are server-fetched).
CREATE POLICY "studio_integration_health_select_own"
  ON studio_integration_health FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM studio_users
      WHERE studio_users.user_id = auth.uid()
        AND studio_users.studio_id = studio_integration_health.studio_id
        AND studio_users.role = 'studio_owner'
    )
  );

-- No INSERT/UPDATE/DELETE policies — writes come from the service client only
-- (probe path in app/actions.ts and, later, the scheduled probe function).
