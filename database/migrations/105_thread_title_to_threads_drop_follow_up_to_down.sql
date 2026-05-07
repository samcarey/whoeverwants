-- Restore polls.thread_title (copy from threads.title to every poll) and
-- polls.follow_up_to (reconstruct chain by created_at order within each
-- thread). Reconstructed chain is "best-guess" — it preserves the linear
-- order but loses any historical divergence in thread_title across polls.

-- 1) Restore polls.thread_title.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS thread_title TEXT;
UPDATE polls
SET thread_title = threads.title
FROM threads
WHERE polls.thread_id = threads.id
  AND threads.title IS NOT NULL;

-- 2) Restore polls.follow_up_to (each non-root poll points to the
--    immediately-preceding poll by created_at within the same thread).
ALTER TABLE polls ADD COLUMN IF NOT EXISTS follow_up_to UUID;
ALTER TABLE polls
  ADD CONSTRAINT multipolls_follow_up_to_fkey
  FOREIGN KEY (follow_up_to) REFERENCES polls(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_polls_follow_up_to ON polls(follow_up_to);

WITH chain AS (
  SELECT
    id,
    LAG(id) OVER (PARTITION BY thread_id ORDER BY created_at, id) AS prev_id
  FROM polls
  WHERE thread_id IS NOT NULL
)
UPDATE polls
SET follow_up_to = chain.prev_id
FROM chain
WHERE polls.id = chain.id
  AND chain.prev_id IS NOT NULL;

-- 3) Drop threads.title.
ALTER TABLE threads DROP COLUMN IF EXISTS title;
