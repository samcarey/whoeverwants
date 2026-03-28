-- Revert close_reason check constraint
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_close_reason_check;
ALTER TABLE polls ADD CONSTRAINT polls_close_reason_check
  CHECK (close_reason IS NULL OR close_reason IN ('manual', 'deadline', 'max_capacity'));
