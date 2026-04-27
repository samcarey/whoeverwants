-- Phase 5: drop wrapper-level columns from polls.
--
-- Every poll has a multipoll wrapper since migration 094, and the multipolls
-- table already carries the canonical copies of these fields. The polls table
-- becomes the sub-poll table; wrapper-level state lives on multipolls only.
--
-- Drops (one-way, no FK preservation needed since FKs already cascade through
-- multipoll_id):
--   - short_id              → multipolls.short_id
--   - creator_secret        → multipolls.creator_secret
--   - creator_name          → multipolls.creator_name
--   - response_deadline     → multipolls.response_deadline
--   - is_closed             → multipolls.is_closed
--   - close_reason          → multipolls.close_reason
--   - follow_up_to          → multipolls.follow_up_to (chain walking already moved
--                             to multipoll-level in Phase 3.5)
--   - thread_title          → multipolls.thread_title
--   - suggestion_deadline   → multipolls.prephase_deadline (same value, set
--                             together at create / deferred to first vote)
--
-- KEPT on polls (per-sub-poll fields):
--   - suggestion_deadline_minutes (per-sub-poll deferral duration; the wrapper
--     also has prephase_deadline_minutes but per-sub-poll values take
--     precedence in vote-submission logic).
--
-- The down migration is best-effort: it re-adds the columns as NULLABLE but
-- cannot recover the original values once the up migration has run.

BEGIN;

-- 1. Drop the BEFORE INSERT/UPDATE trigger that auto-generates polls.short_id
--    from polls.sequential_id. The multipolls table has its own
--    generate_multipoll_short_id trigger (created in migration 092).
DROP TRIGGER IF EXISTS trigger_generate_short_id ON polls;
DROP FUNCTION IF EXISTS generate_short_id();

-- 2. Drop indexes that reference the columns we're about to drop.
DROP INDEX IF EXISTS idx_polls_creator_secret;
DROP INDEX IF EXISTS idx_polls_follow_up_to;
DROP INDEX IF EXISTS idx_polls_response_deadline;
DROP INDEX IF EXISTS idx_polls_short_id;
DROP INDEX IF EXISTS polls_close_reason_idx;

-- 3. Drop check constraints that reference these columns.
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_close_reason_check;

-- 4. Drop the FK on follow_up_to (self-reference) before dropping the column.
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_follow_up_to_fkey;

-- 5. Drop the wrapper-level columns.
ALTER TABLE polls
    DROP COLUMN IF EXISTS short_id,
    DROP COLUMN IF EXISTS creator_secret,
    DROP COLUMN IF EXISTS creator_name,
    DROP COLUMN IF EXISTS response_deadline,
    DROP COLUMN IF EXISTS is_closed,
    DROP COLUMN IF EXISTS close_reason,
    DROP COLUMN IF EXISTS follow_up_to,
    DROP COLUMN IF EXISTS thread_title,
    DROP COLUMN IF EXISTS suggestion_deadline;

-- 6. Drop sequential_id (was used only to generate short_id).
DROP SEQUENCE IF EXISTS polls_sequential_id_seq CASCADE;
ALTER TABLE polls DROP COLUMN IF EXISTS sequential_id;

COMMIT;
