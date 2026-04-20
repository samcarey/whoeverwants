-- Add thread_title column to polls table.
--
-- A thread's display title defaults to the deduplicated participant names
-- (see lib/threadUtils.ts:buildThreadFromPolls). Users can override it by
-- setting thread_title on the latest poll in the thread. New polls created
-- as follow-ups inherit the parent's thread_title, so the override persists
-- across future follow-ups in the thread.
--
-- NULL means "use the default participant-names title". Non-NULL overrides it.

ALTER TABLE polls ADD COLUMN IF NOT EXISTS thread_title TEXT;
