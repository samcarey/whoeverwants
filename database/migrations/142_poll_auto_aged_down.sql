-- Revert migration 142.
DROP INDEX IF EXISTS idx_polls_aging_candidates;
ALTER TABLE polls DROP COLUMN IF EXISTS auto_aged_at;
