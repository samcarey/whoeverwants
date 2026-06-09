DROP INDEX IF EXISTS idx_polls_recurrence_anchor;
ALTER TABLE polls
    DROP COLUMN IF EXISTS recurrence_anchor_id,
    DROP COLUMN IF EXISTS recurrence_last_run,
    DROP COLUMN IF EXISTS recurrence_until,
    DROP COLUMN IF EXISTS recurrence_skip_dates,
    DROP COLUMN IF EXISTS recurrence;
