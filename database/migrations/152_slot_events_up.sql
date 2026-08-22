-- Playlist slot EVENTS: confirmations on a system-proposed gathering.
--
-- An event is NOT authored — it is derived on read from the slots themselves:
-- everyone whose availability overlaps on a day and who tagged the same
-- activity is a candidate for one event (identity = (day, LOWER(activity))).
-- What needs persistence is only each user's CONFIRMATION ("I'm in"), so the
-- event row exists purely to anchor confirmation rows and is minted lazily by
-- the first confirm. All the matching/viability math (party-size bounds,
-- include/exclude who-with sets, common time windows) lives in
-- services/slot_events.py and is recomputed on every read — nothing derived
-- is stored, so slot edits can never leave a stale event behind.

BEGIN;

CREATE TABLE IF NOT EXISTS slot_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The day the gathering would happen (the slots' day_time_windows day).
    day DATE NOT NULL,
    -- Display casing of the activity at mint time; identity is the LOWER()ed
    -- form (the same case-insensitive key slot_activities matching uses).
    activity TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One event per (day, activity) — the lazy mint upserts against this.
CREATE UNIQUE INDEX IF NOT EXISTS slot_events_day_activity_key
    ON slot_events (day, LOWER(activity));

CREATE TABLE IF NOT EXISTS slot_event_confirmations (
    event_id UUID NOT NULL REFERENCES slot_events(id) ON DELETE CASCADE,
    -- Account-keyed (slots always have an owner account), so a confirmation
    -- follows the user across devices like the slots themselves.
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS slot_event_confirmations_user_idx
    ON slot_event_confirmations (user_id);

COMMIT;
