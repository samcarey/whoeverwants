-- Stop deferring the prephase (suggestion / availability) countdown until the
-- first submission. Going forward, `polls.prephase_deadline` is computed at
-- create time from `prephase_deadline_minutes` (see routers/polls.py:
-- _insert_poll), and the per-vote "arm the timer on first submission" path is
-- gone (services/questions.py: _submit_vote_to_question).
--
-- This backfills polls that were created under the old behavior and are still
-- waiting (a duration was set but the absolute deadline was never armed because
-- no one had submitted yet). For those, start the countdown retroactively from
-- the poll's creation time — consistent with the new "counter starts right
-- away" rule. Polls whose computed deadline would land at/after the voting
-- deadline are capped to one minute before it.
--
-- Closed polls and polls that already have an armed deadline are left alone.
-- After this runs, the only remaining `prephase_deadline IS NULL` rows are
-- polls with no prephase configured at all.

BEGIN;

UPDATE polls
SET prephase_deadline = CASE
      WHEN response_deadline IS NOT NULL
           AND created_at + make_interval(mins => prephase_deadline_minutes) >= response_deadline
        THEN response_deadline - interval '1 minute'
      ELSE created_at + make_interval(mins => prephase_deadline_minutes)
    END
WHERE prephase_deadline IS NULL
  AND prephase_deadline_minutes IS NOT NULL;

COMMIT;
