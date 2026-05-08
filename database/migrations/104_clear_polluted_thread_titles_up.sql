-- Clear `polls.thread_title` values that were polluted by the create-poll
-- bug: `req.title` (the poll's display title — e.g. a user-typed yes_no
-- prompt) was being written into `polls.thread_title` (the thread-name
-- override). The FE consults `polls.thread_title` to compute Thread.title,
-- so the user-reported symptom was "the name of a thread sometimes changes
-- to a poll's title".
--
-- The bug fired when `req.title` was non-null (single yes_no polls where
-- the user typed the prompt — `is_auto_title=false`). The polluted value
-- then propagated to every follow-up poll in the thread via the COALESCE
-- inheritance in `_insert_poll`.
--
-- Heuristic: identify threads whose ROOT poll has
-- `thread_title == questions[0].title` AND `questions[0].is_auto_title=false`.
-- That's exactly the polluted-by-bug shape. Clear `thread_title` for every
-- poll in those threads — the inherited value on follow-ups is wrong too.
--
-- Safe-by-design false-negative trade: a user who later set their thread
-- title (via /edit-title) to something other than the question prompt is
-- preserved — `thread_title` won't equal `questions[0].title` anymore.
-- False-positive trade (per user direction): a user who DID type a thread
-- title that happens to equal their question prompt verbatim will lose
-- it. That's rare and recoverable via /edit-title.

WITH polluted_root_threads AS (
  SELECT DISTINCT p.thread_id
  FROM polls p
  JOIN questions q
    ON q.poll_id = p.id
   AND q.question_index = 0
  WHERE p.follow_up_to IS NULL
    AND p.thread_title IS NOT NULL
    AND p.thread_title = q.title
    AND q.is_auto_title = FALSE
)
UPDATE polls
SET thread_title = NULL,
    updated_at = now()
WHERE thread_id IN (SELECT thread_id FROM polluted_root_threads)
  AND thread_title IS NOT NULL;
