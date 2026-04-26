-- Phase 4: backfill existing polls into the multipolls system.
-- Migration: 093_backfill_multipolls
--
-- For every non-participation poll that doesn't already have a multipoll
-- wrapper (i.e. multipoll_id IS NULL — pre-Phase-2.2 polls), create a
-- 1-sub-poll multipoll wrapper. Then rewrite the wrapper's follow_up_to /
-- fork_of to point to the parent's wrapper (or NULL when the parent is a
-- participation poll).
--
-- Participation polls are skipped: they keep multipoll_id = NULL forever, per
-- CLAUDE.md → "Participation Polls (Deprecated)".
--
-- Idempotent: re-running this migration is a no-op (the WHERE multipoll_id
-- IS NULL filter excludes polls that already have a wrapper).
--
-- See docs/multipoll-phasing.md for the broader plan.

BEGIN;

-- ---------------------------------------------------------------------------
-- Schema-drift safety net.
--
-- Migration 030 dropped polls.short_id and polls.sequential_id; the
-- production DB still has them (it was bootstrapped from Supabase before 030
-- and the columns survived), but freshly-built dev DBs (per-user dev_*
-- schemas built by replaying migrations from scratch) don't. We need
-- polls.short_id to exist so we can copy it onto the multipoll wrapper. Add
-- the columns + sequence + back-fill if they are missing. No-op on prod.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'polls' AND column_name = 'sequential_id'
  ) THEN
    EXECUTE 'CREATE SEQUENCE IF NOT EXISTS polls_sequential_id_seq';
    EXECUTE 'ALTER TABLE polls ADD COLUMN sequential_id INTEGER UNIQUE DEFAULT nextval(''polls_sequential_id_seq'')';
    EXECUTE 'ALTER SEQUENCE polls_sequential_id_seq OWNED BY polls.sequential_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'polls' AND column_name = 'short_id'
  ) THEN
    EXECUTE 'ALTER TABLE polls ADD COLUMN short_id TEXT UNIQUE';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_polls_short_id ON polls(short_id)';
  END IF;

  -- Backfill any rows missing sequential_id / short_id (encode_base62 is
  -- defined in migration 021).
  IF EXISTS (
    SELECT 1 FROM polls WHERE sequential_id IS NULL OR short_id IS NULL LIMIT 1
  ) THEN
    UPDATE polls
    SET sequential_id = COALESCE(sequential_id, nextval('polls_sequential_id_seq'))
    WHERE sequential_id IS NULL;
    UPDATE polls
    SET short_id = encode_base62(sequential_id)
    WHERE short_id IS NULL AND sequential_id IS NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Pass 1: insert one multipoll per legacy non-participation poll.
--
-- Each wrapper inherits the source poll's short_id so existing share URLs
-- still resolve (the multipolls.short_id auto-generation trigger is bypassed
-- by providing an explicit value). polls.short_id <-> multipolls.short_id
-- becomes a 1:1 mapping we can use as the join key in Pass 2.
-- ---------------------------------------------------------------------------

INSERT INTO multipolls (
  short_id,
  creator_secret,
  creator_name,
  response_deadline,
  prephase_deadline,
  prephase_deadline_minutes,
  is_closed,
  close_reason,
  thread_title,
  context,
  created_at,
  updated_at
)
SELECT
  p.short_id,
  p.creator_secret,
  p.creator_name,
  p.response_deadline,
  p.suggestion_deadline,
  p.suggestion_deadline_minutes,
  COALESCE(p.is_closed, false),
  p.close_reason,
  p.thread_title,
  p.details,
  p.created_at,
  p.updated_at
FROM polls p
WHERE p.multipoll_id IS NULL
  AND p.poll_type != 'participation'
  AND p.short_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Pass 2: update polls.multipoll_id to point at the new wrapper (joining on
-- short_id) and set sub_poll_index = 0.
-- ---------------------------------------------------------------------------

UPDATE polls p
SET multipoll_id = m.id,
    sub_poll_index = 0
FROM multipolls m
WHERE p.short_id = m.short_id
  AND p.multipoll_id IS NULL
  AND p.poll_type != 'participation';

-- ---------------------------------------------------------------------------
-- Pass 3: rewrite follow_up_to on the new multipolls.
--
-- Each multipoll.follow_up_to should point to the multipoll wrapping the
-- parent poll. If the parent poll is a participation poll (no wrapper) it
-- stays NULL. Mixed-mode threads work because thread aggregation in
-- lib/threadUtils.ts walks polls.follow_up_to (still populated).
-- ---------------------------------------------------------------------------

UPDATE multipolls m
SET follow_up_to = parent_p.multipoll_id
FROM polls p
JOIN polls parent_p ON parent_p.id = p.follow_up_to
WHERE p.multipoll_id = m.id
  AND parent_p.multipoll_id IS NOT NULL
  AND m.follow_up_to IS NULL
  AND p.follow_up_to IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Pass 4: rewrite fork_of analogously.
-- ---------------------------------------------------------------------------

UPDATE multipolls m
SET fork_of = parent_p.multipoll_id
FROM polls p
JOIN polls parent_p ON parent_p.id = p.fork_of
WHERE p.multipoll_id = m.id
  AND parent_p.multipoll_id IS NOT NULL
  AND m.fork_of IS NULL
  AND p.fork_of IS NOT NULL;

COMMIT;
