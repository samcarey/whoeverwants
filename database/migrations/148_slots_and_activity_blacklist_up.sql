-- Playlist "slots" + per-account activity blacklist.
--
-- A SLOT is a user's declared availability window (one or more day-time
-- windows) tagged with ACTIVITIES they'd be interested in during that
-- period. Slots are the data source for the create-slot sheet's activity
-- SUGGESTIONS: when a user is filling out a new slot we rank activities by
--   1) what OTHER users have picked for an OVERLAPPING time period,
--   2) what THIS user has picked before, then
--   3) what OTHER users have picked before (any time),
-- excluding anything on the user's blacklist.
--
-- The BLACKLIST is account-synced (mirrors the badge-settings /
-- vote-reminder preference pattern) and editable from the settings page;
-- blacklisted activities are never suggested.

BEGIN;

CREATE TABLE IF NOT EXISTS slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The slot's owner. An anonymous creator gets a browser-tied auto-account
    -- minted at save time (same as poll authorship), so this is always set.
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The availability window(s): [{day:'YYYY-MM-DD', windows:[{min,max}]}],
    -- the same shape polls use for voter_day_time_windows.
    day_time_windows JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS slots_user_id_idx ON slots(user_id);

-- One row per activity on a slot (normalized so the suggestion query can
-- GROUP BY activity across users + filter by time overlap).
CREATE TABLE IF NOT EXISTS slot_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
    activity TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS slot_activities_slot_id_idx ON slot_activities(slot_id);
-- Case-insensitive grouping/matching in the suggestion ranker.
CREATE INDEX IF NOT EXISTS slot_activities_lower_idx ON slot_activities(LOWER(activity));

-- Per-account "never suggest this activity" list.
CREATE TABLE IF NOT EXISTS activity_blacklist (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One entry per (account, activity), case-insensitive so "Hiking" can't be
-- blacklisted twice as "hiking".
CREATE UNIQUE INDEX IF NOT EXISTS activity_blacklist_user_activity_idx
    ON activity_blacklist(user_id, LOWER(activity));

COMMIT;
