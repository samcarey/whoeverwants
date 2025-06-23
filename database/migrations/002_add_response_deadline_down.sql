-- Remove response_deadline column from polls table
-- Migration: 002_add_response_deadline (rollback)

DROP INDEX IF EXISTS idx_polls_response_deadline;
ALTER TABLE polls DROP COLUMN IF EXISTS response_deadline;