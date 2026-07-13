-- Per-activity emoji on a Playlist slot's activities.
--
-- When a user types an activity "from scratch" in the create-slot sheet they
-- can pick an emoji for it (reusing the poll category-emoji picker). Stored
-- in its OWN column — decoupled from the activity TEXT — so the case-
-- insensitive suggestion matching + blacklist (both keyed on LOWER(activity))
-- stay unaffected. The suggestion ranker surfaces the freshest row's emoji
-- alongside each suggested activity.

BEGIN;

ALTER TABLE slot_activities ADD COLUMN IF NOT EXISTS emoji TEXT;

COMMIT;
