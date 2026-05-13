-- Enable full replica identity on leads so Realtime can filter DELETE events
-- by studio_id. Without this, the old record only contains the primary key,
-- which means the studio_id filter cannot be applied to DELETE events.
ALTER TABLE leads REPLICA IDENTITY FULL;
