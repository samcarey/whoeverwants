-- Time-poll viability gate: "Minimum Participants".
--
-- A time slot counts only if at least this many people are available for it.
-- At the availability cutoff, slots with fewer than `time_min_participants`
-- available are dropped; if NO slot clears the bar the poll resolves to an
-- explicit "event's off" state (time_event_cancelled = true) rather than a
-- thin/empty ballot.
--
-- Replaces the relative `min_availability_percent` filter for new polls. The
-- old column is retained for back-compat but no longer drives finalization.

ALTER TABLE questions ADD COLUMN IF NOT EXISTS time_min_participants INTEGER;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS time_event_cancelled BOOLEAN NOT NULL DEFAULT false;
