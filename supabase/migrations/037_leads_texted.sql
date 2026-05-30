-- Migration 037: add leads.texted (maps 1:1 to Notion "Texted" checkbox) for 2-way sync.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS texted boolean NOT NULL DEFAULT false;
