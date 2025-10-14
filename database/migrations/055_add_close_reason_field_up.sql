-- Add close_reason field to track why a poll was closed
-- Possible values: 'manual', 'deadline', 'max_capacity'

ALTER TABLE polls ADD COLUMN IF NOT EXISTS close_reason TEXT;

-- Add constraint to validate close_reason values
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_close_reason_check;
ALTER TABLE polls ADD CONSTRAINT polls_close_reason_check
  CHECK (close_reason IS NULL OR close_reason IN ('manual', 'deadline', 'max_capacity'));

-- Create index for efficient querying by close_reason
CREATE INDEX IF NOT EXISTS polls_close_reason_idx ON polls(close_reason) WHERE close_reason IS NOT NULL;
