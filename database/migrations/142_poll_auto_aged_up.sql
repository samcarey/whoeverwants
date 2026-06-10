-- Migration 142: auto-age finished polls into the per-viewer "Old" list.
--
-- `polls.auto_aged_at` is the instant a poll became "done" (no outcome can
-- still arrive in the future) — set ONCE by the close path / cron tick, never
-- by user action. The follow-state read (`effective_follow_states`) treats an
-- aged poll as 'old' for every viewer UNLESS that viewer has a follow row
-- newer than `auto_aged_at` (their post-aging + re-add wins). So aging is a
-- one-time, for-everyone move that the viewer can undo with the green +.
--
-- "Done" =
--   * any non-time/showtime question type → as soon as the poll is closed, OR
--   * a time/showtime poll whose decided slot's end is fully past in every
--     timezone, OR the event was cancelled, OR no winner (tie / all-abstain).
-- A closed time/showtime poll whose winning slot is still UPCOMING is NOT aged
-- (it stays in Relevant so people see the upcoming event); the tick ages it
-- once the slot passes.
--
-- NULL = not yet aged. Reopening a poll clears it back to NULL.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS auto_aged_at TIMESTAMPTZ;

-- The cron tick scans `is_closed AND auto_aged_at IS NULL` each minute (tick
-- pass 6). A partial index keeps that to the live "closed but not yet aged"
-- set (which shrinks as polls age) instead of a full polls seq-scan.
CREATE INDEX IF NOT EXISTS idx_polls_aging_candidates
  ON polls (id)
  WHERE is_closed = true AND auto_aged_at IS NULL;
