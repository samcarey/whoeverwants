-- Irreversible: the polluted thread_title values were derived from the
-- corresponding question titles, which are still intact. If a rollback is
-- ever required, re-derive by joining `polls.thread_title` to
-- `questions WHERE question_index = 0 AND poll_id = polls.id`. We don't
-- automate the down migration because it would re-introduce the original
-- bug's data shape.
SELECT 1;
