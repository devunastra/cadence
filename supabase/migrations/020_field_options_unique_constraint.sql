-- Remove duplicate studio_field_options rows (keep the row with the lowest sort_order,
-- or the oldest created row if sort_order is NULL or tied).
DELETE FROM studio_field_options
WHERE id NOT IN (
  SELECT DISTINCT ON (studio_id, field, value) id
  FROM studio_field_options
  ORDER BY studio_id, field, value, sort_order ASC NULLS LAST, id ASC
);

-- Prevent future duplicates at the database level.
ALTER TABLE studio_field_options
  ADD CONSTRAINT studio_field_options_studio_field_value_unique
  UNIQUE (studio_id, field, value);
