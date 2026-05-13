-- Persist sidebar collapsed/expanded state per user per studio
ALTER TABLE user_preferences ADD COLUMN nav_collapsed boolean NOT NULL DEFAULT false;
