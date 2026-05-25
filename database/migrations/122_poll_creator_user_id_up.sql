-- Account-owned poll authorship.
--
-- Adds `polls.creator_user_id` — the user_id of the signed-in creator,
-- mirroring `groups.creator_user_id` (migration 114). NULL for
-- anonymous-created polls (those keep authorizing close/reopen/cutoff via
-- the per-browser `creator_secret`). When set, poll mutations may be
-- authorized against the session's user_id instead of the secret, so a
-- signed-in creator can manage their poll from any device they're signed
-- in on (the secret never followed them across browsers).
--
-- The signed-in / anonymous split lives in `_insert_poll`
-- (`server/routers/polls.py`): signed-in → creator_user_id = session
-- user_id, anonymous → NULL. `creator_secret` is still written on every
-- poll regardless, so the secret path remains the fallback authority.
--
-- ON DELETE SET NULL so deleting a user (Phase I) reverts their polls to
-- secret-only authorization rather than cascading the rows away.

BEGIN;

ALTER TABLE polls
  ADD COLUMN creator_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
