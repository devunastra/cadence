-- Appointments table: populated by GHL webhook (AppointmentCreate/Update/Delete)
CREATE TABLE IF NOT EXISTS appointments (
  id                 text PRIMARY KEY,           -- GHL appointment id
  studio_id          uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  title              text,
  start_time         timestamptz NOT NULL,
  end_time           timestamptz NOT NULL,
  status             text,                       -- confirmed | cancelled | showed | noshow
  calendar_id        text,
  calendar_name      text,
  contact_id         text,
  contact_name       text,
  assigned_user_id   text,
  assigned_user_name text,
  notes              text,
  address            text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointments_studio_start ON appointments (studio_id, start_time);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "studio members can view appointments"
  ON appointments FOR SELECT
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_users WHERE user_id = auth.uid()
    )
  );
