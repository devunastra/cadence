-- Per-studio GHL Private Integration API Key (overrides the global env var when set)
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS ghl_api_key text;
