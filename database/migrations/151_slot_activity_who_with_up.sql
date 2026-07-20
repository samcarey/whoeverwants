-- Per-activity "who with" entries on a Playlist slot's activities.
--
-- Each activity can carry MULTIPLE participant ranges, each with its own set
-- of groups and/or specific people the owner is willing to do it with
-- ("2–5 with Climbing Crew, or 2–3 with just Alex"), shown on the timeline's
-- activity cards. Stored as a JSONB array of
--   {min_people, max_people, groups: [names], people: [names]}
-- entries — display-name strings captured at write time (like
-- poll_comments.commenter_name / poll_comments.mentions' name capture) —
-- decoupled from the activity TEXT + emoji + the legacy activity-level range,
-- so the case-insensitive suggestion matching + blacklist (both keyed on
-- LOWER(activity)) stay unaffected. NULL/[] = the activity-level range with
-- "Anyone".

BEGIN;

ALTER TABLE slot_activities ADD COLUMN IF NOT EXISTS who_with JSONB;

COMMIT;
