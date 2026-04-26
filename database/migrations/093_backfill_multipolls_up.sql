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
-- Pass 1: insert one multipoll per legacy non-participation poll.
--
-- We need a deterministic 1:1 join between the inserted multipoll rows and
-- the source polls so we can update polls.multipoll_id afterwards. The trick:
-- we explicitly carry the source poll.id through as multipolls.id is a fresh
-- uuid, but we also write each poll's short_id onto the multipoll. After the
-- INSERT, polls.short_id <-> multipolls.short_id is unique (polls.short_id is
-- unique by construction), so we can use that as the join key in Pass 2.
--
-- The multipolls.short_id auto-generation trigger fires only when short_id
-- IS NULL, so providing an explicit short_id here bypasses it.
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
  -- Polls without short_id are unreachable via URL anyway; leave them alone.

-- ---------------------------------------------------------------------------
-- Pass 2: update polls.multipoll_id to point at the new wrapper (joining on
-- short_id) and set sub_poll_index = 0. This is unambiguous because each
-- legacy poll has a unique short_id and we only inserted one multipoll per
-- legacy poll.
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
