-- Revert migration 142.
ALTER TABLE polls DROP COLUMN IF EXISTS auto_aged_at;
