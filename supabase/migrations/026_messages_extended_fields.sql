-- Email subject line (populated for Email message types)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS subject text;

-- Delivery error message (populated when GHL reports a send failure)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error text;

-- Links a message to an appointment when messageType indicates an appointment activity
-- Used to render appointment chips in the conversation thread
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS appointment_id text;
