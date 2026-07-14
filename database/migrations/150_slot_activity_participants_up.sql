-- Per-activity participant range on a Playlist slot's activities.
--
-- A user can tap an activity in the create-slot sheet to open a slide-in
-- editor and set a min and/or max number of people for it ("2–5 people").
-- Both are optional (nullable) and independent — decoupled from the activity
-- TEXT + emoji, so the case-insensitive suggestion matching + blacklist (both
-- keyed on LOWER(activity)) stay unaffected. Suggestions never carry a range;
-- it's a property the owner sets on their own slot's activity.

BEGIN;

ALTER TABLE slot_activities ADD COLUMN IF NOT EXISTS min_people INTEGER;
ALTER TABLE slot_activities ADD COLUMN IF NOT EXISTS max_people INTEGER;

COMMIT;
