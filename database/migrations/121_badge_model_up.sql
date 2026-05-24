-- App-icon badge model + viewed tracking.
--
--   1. users.badge_*         — per-account, synced badge-model preferences.
--      badge_todo_mode         OFF (default) = unread model (badge = polls with
--                              unseen notification activity; opening clears).
--                              ON = to-do model (badge = open votable polls you
--                              haven't voted/abstained on; only voting clears).
--      badge_on_voting_open    Unread-only: a prephase→voting transition
--                              re-lights the poll. Default ON.
--      badge_on_results        Unread-only: a poll closing re-lights the poll.
--                              Default ON.
--      Anonymous users have no row here — their preference lives in localStorage
--      and shapes only the client-side badge; their server push badge uses these
--      column defaults until they sign in.
--
--   2. poll_views.first_viewed_at — stable "first opened" clock (set on insert,
--      NOT bumped on re-view, unlike last_viewed_at). A viewer is "ignored"
--      (seen-but-no-action) once first_viewed_at is >5 min old with no vote/
--      abstain — derived at read time for the "Viewed (N)" roster.

BEGIN;

-- 1. Account-synced badge preferences.
ALTER TABLE users ADD COLUMN badge_todo_mode    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN badge_on_voting_open BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN badge_on_results   BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Stable first-view clock. Backfill existing rows from last_viewed_at so the
--    5-minute "ignored" derivation doesn't treat every pre-existing view as
--    brand-new on deploy.
ALTER TABLE poll_views ADD COLUMN first_viewed_at TIMESTAMPTZ;
UPDATE poll_views SET first_viewed_at = last_viewed_at WHERE first_viewed_at IS NULL;
ALTER TABLE poll_views ALTER COLUMN first_viewed_at SET DEFAULT NOW();
ALTER TABLE poll_views ALTER COLUMN first_viewed_at SET NOT NULL;

COMMIT;
