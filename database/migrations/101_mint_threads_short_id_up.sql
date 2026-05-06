-- Phase B.4 of the thread routing redesign.
-- Migration: 101_mint_threads_short_id
--
-- Phase B.1 created `threads` with a nullable `short_id`, backfilled from
-- the chain-root poll's short_id. New threads created post-B.1 had
-- `short_id = NULL` (the FE was still using the root poll's short_id as the
-- thread route id, so threads.short_id was unused).
--
-- Phase B.4 starts using `threads.short_id` as the URL keyspace on the
-- server resolver and the FE URL builders. We need:
--   1. A separate keyspace so fresh thread short_ids never collide with the
--      backfilled root-poll-short-id values (or with any future poll
--      short_ids — `polls.sequential_id` and `threads.sequential_id` are
--      independent SERIALs whose base62 encodings would otherwise overlap).
--   2. Trigger-driven minting on every thread INSERT so the application
--      code stays simple (`INSERT INTO threads DEFAULT VALUES` keeps working).
--
-- Approach: prefix every freshly-minted thread short_id with `~`. The
-- character is URL-safe (RFC 3986 unreserved) and not in the base62
-- alphabet (`0-9 A-Z a-z`), guaranteeing zero overlap with poll short_ids.
-- Backfilled thread short_ids from B.1 are left untouched so existing
-- `/t/<root-poll-short-id>` URLs continue to resolve via the same
-- `threads.short_id` lookup the new URLs use — no fallback path needed
-- for the legacy form.
--
-- See docs/thread-routing-redesign.md for the full plan.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. threads.sequential_id
-- ---------------------------------------------------------------------------
--
-- BIGSERIAL on ALTER ADD COLUMN populates existing rows with sequential
-- values from the new sequence at add time (Postgres 10+), and the column's
-- DEFAULT keeps the sequence in play for new inserts. UNIQUE backstops the
-- short_id uniqueness invariant.

ALTER TABLE threads ADD COLUMN IF NOT EXISTS sequential_id BIGSERIAL UNIQUE;

-- ---------------------------------------------------------------------------
-- 2. Trigger to mint short_id from sequential_id on insert (or update where
--    short_id is NULL, mirroring polls' generate_short_id pattern).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION generate_thread_short_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.short_id IS NULL AND NEW.sequential_id IS NOT NULL THEN
    NEW.short_id := '~' || encode_base62(NEW.sequential_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_thread_short_id ON threads;
CREATE TRIGGER trigger_generate_thread_short_id
  BEFORE INSERT OR UPDATE ON threads
  FOR EACH ROW
  EXECUTE FUNCTION generate_thread_short_id();

-- ---------------------------------------------------------------------------
-- 3. Backfill: mint short_ids for any threads that don't have one yet.
-- ---------------------------------------------------------------------------
--
-- B.1's backfill set `threads.short_id = root_poll.short_id` for every chain
-- root present at migration time. New threads created in the window between
-- B.1 and B.4 were inserted with `INSERT INTO threads DEFAULT VALUES`,
-- leaving short_id NULL. Mint those now using the same `~`-prefix scheme
-- the trigger uses.

UPDATE threads
   SET short_id = '~' || encode_base62(sequential_id)
 WHERE short_id IS NULL;

COMMIT;
