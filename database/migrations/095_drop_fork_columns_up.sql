-- Drop fork_of columns and their indexes from polls and multipolls.
--
-- The fork concept (a copy of an existing poll that starts a new thread) is
-- being removed entirely. Threads are now formed only via follow_up_to chains.
--
-- This migration is destructive: existing fork_of values cannot be recovered.
-- Per docs/multipoll-phasing.md, fork was a low-traffic feature; the prior
-- backfill (093) rewrote only 2 fork_of references in production.

ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_fork_of_fkey;
DROP INDEX IF EXISTS idx_polls_fork_of;
ALTER TABLE polls DROP COLUMN IF EXISTS fork_of;

ALTER TABLE multipolls DROP CONSTRAINT IF EXISTS multipolls_fork_of_fkey;
DROP INDEX IF EXISTS idx_multipolls_fork_of;
ALTER TABLE multipolls DROP COLUMN IF EXISTS fork_of;
