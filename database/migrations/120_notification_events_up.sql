-- Notification events: poll-closed + phase-transition pushes, plus the
-- app-badge model. Adds the plumbing the cron tick (POST /api/internal/tick)
-- and the inline close/cutoff endpoints need to fire — and to fire each event
-- exactly once.
--
--   1. votes.browser_id      — link a vote to the browser that cast it, so the
--                              phase-transition skip-logic can ask "did THIS
--                              member prevote?". Nullable: historical votes
--                              predate the column.
--   2. poll_views            — per-(browser, poll) "last viewed" watermark. The
--                              transition notification skips a prevoter only
--                              when they've already seen the finalized option
--                              set, i.e. no option-adding contribution arrived
--                              after their last view.
--   3. polls.close_notified  — idempotency flag for the poll-closed push. ANY
--      polls.prephase_notified  close path (explicit / auto / deadline) flips
--                              is_closed; the tick claims un-notified rows and
--                              sends once. Same shape for the prephase→voting
--                              transition.
--
-- Backfill (steps 4-6) makes is_closed authoritative for already-past-deadline
-- polls and marks every already-closed / already-transitioned poll as notified,
-- so the first cron tick after deploy treats only NEW events as fresh and can't
-- fire a notification storm for historical polls.

BEGIN;

-- 1. Who cast each vote (for the "did they prevote?" check).
ALTER TABLE votes ADD COLUMN browser_id UUID;
CREATE INDEX votes_browser_id_idx ON votes(browser_id);

-- 2. Per-(browser, poll) last-viewed watermark.
CREATE TABLE poll_views (
    browser_id UUID NOT NULL,
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (browser_id, poll_id)
);
CREATE INDEX poll_views_poll_idx ON poll_views(poll_id);

-- 3. Notification idempotency flags on the poll wrapper.
ALTER TABLE polls ADD COLUMN close_notified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE polls ADD COLUMN prephase_notified BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Make is_closed authoritative for already-past-deadline polls. Previously
--    "closed" was computed lazily on the FE from is_closed AND response_deadline;
--    the server never flipped is_closed when the deadline passed (and the vote
--    endpoint only checks is_closed, so votes were technically still accepted).
--    Flipping here both fixes that latent bug and prevents the first tick from
--    treating every historical deadline crossing as a fresh close.
UPDATE polls
SET is_closed = true,
    close_reason = COALESCE(close_reason, 'deadline')
WHERE is_closed = false
  AND response_deadline IS NOT NULL
  AND response_deadline <= NOW();

-- 5. Every poll that's already closed counts as already-close-notified.
UPDATE polls SET close_notified = true WHERE is_closed = true;

-- 6. Every poll whose prephase has already ended counts as already-transition-
--    notified. Polls with a FUTURE prephase_deadline stay false so the tick
--    notifies them when the deadline passes.
UPDATE polls SET prephase_notified = true
WHERE prephase_deadline IS NOT NULL AND prephase_deadline <= NOW();

COMMIT;
