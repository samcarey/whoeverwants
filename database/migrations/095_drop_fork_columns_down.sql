-- Re-add fork_of columns and indexes to polls and multipolls.
--
-- Down migration only restores the column shape — original fork_of values
-- are lost when the up migration runs. After running this, fork_of will be
-- NULL on every row.

ALTER TABLE polls ADD COLUMN IF NOT EXISTS fork_of UUID REFERENCES polls(id);
CREATE INDEX IF NOT EXISTS idx_polls_fork_of ON polls(fork_of);
COMMENT ON COLUMN polls.fork_of IS 'UUID of the poll this poll is forked from';

ALTER TABLE multipolls ADD COLUMN IF NOT EXISTS fork_of UUID
  REFERENCES multipolls(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_multipolls_fork_of ON multipolls(fork_of);
