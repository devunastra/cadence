-- Per-studio gate for the appointment → lead.first_lesson → Notion push.
-- When true, the GHL appointment webhook recomputes the linked lead's first_lesson
-- on Create/Reschedule/Update events as the earliest non-deleted appointment for
-- that contact, then pushes via the existing syncLeadUpdateToNotion helper (which
-- already handles studio timezone conversion when emitting the Notion datetime).
--
-- Off by default. Additive + idempotent. Spec:
-- docs/specs/appointment-first-lesson-notion-sync-spec.md

ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS notion_sync_appointments boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN studios.notion_sync_appointments IS
  'When true, the GHL appointment webhook updates the linked lead''s first_lesson to the earliest scheduled appointment for the contact, then pushes via the existing lead→Notion sync. Off by default.';

-- Enable for Arthur Murray Lincolnshire and Arthur Murray Schaumburg.
UPDATE studios SET notion_sync_appointments = true
  WHERE id IN (
    '71274499-7c29-4621-990f-b60669ed1de3', -- Lincolnshire
    'aeefb977-5d03-4e40-994a-327cb51b7918'  -- Schaumburg
  );
