-- Poll OPTIONS for a Playlist activity (migration 161).
--
-- Migration 156 gave an activity an attached poll DRAFT (what to ask). These
-- are the settings that apply to EVERY poll the activity starts — when voting
-- closes, whether voters may suggest options first, and how a ranked choice
-- picks its winner. They live beside the draft rather than inside it so they
-- survive detaching/reattaching a poll, and so a future second draft inherits
-- the same rules.
--
-- Shape, sanitized on write by services/slots._clean_poll_options:
--   {"deadline":    "event_start" | "1h"|"2h"|"8h"|"1d"|"2d"|"4d",
--    "suggestions": "none" | "deadline:<k>" | "event:<k>",
--    "winner_method": "favorite" | "consensus",
--    "timezone":    IANA name, e.g. "America/Chicago"}
--
-- `deadline` / `suggestions` are LEAD TIMES off the event's start; `timezone`
-- is what makes them computable. A slot's day + times are wall clock with no
-- zone (see PAST_GRACE_HOURS), so the attacher's zone — captured by the
-- browser when they saved the activity — is the only honest anchor for
-- turning "2 hours before the event" into an instant. NULL column, or a row
-- with no usable zone, keeps the pre-161 behavior: the poll starts with no
-- deadline and no suggestion phase.

BEGIN;

ALTER TABLE slot_activities ADD COLUMN IF NOT EXISTS poll_options JSONB;

COMMIT;
