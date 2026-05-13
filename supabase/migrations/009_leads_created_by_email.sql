-- Store the email of the user who created a lead so Realtime INSERT events
-- can display the creator's identity in the notification banner.
ALTER TABLE leads ADD COLUMN created_by_email text;
