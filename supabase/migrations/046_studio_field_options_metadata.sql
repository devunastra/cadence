-- Per-source detail capture for lead sources (client onboarding v2).
-- Stores the typed-prompt value for known source kinds — e.g. the email address
-- behind an "Email" source, the URL behind a "Facebook" source, etc. The
-- application owns the shape; this column is intentionally a free-form jsonb
-- because different source kinds carry different fields.
--
-- Shape (mirrors lib/source-kinds.ts):
--   { kind: 'email' | 'url' | 'tel' | 'text' | 'none', value?: string }
--
-- Nullable + additive — safe on the live DB. Existing rows keep metadata = NULL
-- and continue to render with no detail field until edited.

ALTER TABLE studio_field_options
  ADD COLUMN IF NOT EXISTS metadata jsonb;
