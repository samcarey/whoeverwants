-- Per-activity "who with" on a Playlist slot's activities.
--
-- Each activity can carry the GROUPS and/or SPECIFIC PEOPLE the owner is
-- willing to do it with, shown on the timeline's activity cards. Stored as
-- JSONB arrays of display-name strings captured at write time (like
-- poll_comments.commenter_name / poll_comments.mentions' name capture) —
-- decoupled from the activity TEXT + emoji + range, so the case-insensitive
-- suggestion matching + blacklist (both keyed on LOWER(activity)) stay
-- unaffected. NULL/[] = "Anyone".

BEGIN;

ALTER TABLE slot_activities ADD COLUMN IF NOT EXISTS with_groups JSONB;
ALTER TABLE slot_activities ADD COLUMN IF NOT EXISTS with_people JSONB;

COMMIT;
