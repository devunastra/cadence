-- Per-user toggles for lead table banner notifications (default on)
ALTER TABLE user_preferences
  ADD COLUMN notify_lead_created boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_lead_updated boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_lead_deleted boolean NOT NULL DEFAULT true;
