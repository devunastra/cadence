-- Soft-delete support for appointments
-- Deleted appointments are kept for audit purposes and hidden from calendar views
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
