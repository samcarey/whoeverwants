-- AI-powered poll suggestions cache (the create-poll search box's "ready to go"
-- predicted next polls, tailored per user + per group by an LLM).
--
-- One row per (user, group). The structured suggestions are generated in the
-- background (a BackgroundTask) when a poll is created in the group, and lazily
-- on a cache-miss read, so by the time the user opens the new-poll box the rows
-- are already cached. `suggestions` is a JSONB array of structured draft objects
-- ({category, title?, options?, context?}); the FE re-derives each title from
-- those fields and re-ranks/filters them in real time with the on-device model.
--
-- Account-keyed (NOT browser-keyed): suggestions follow the user across devices,
-- exactly like display_name / the profile photo. The generator resolves the
-- creator's account at create time; reads resolve the actor's account.

BEGIN;

CREATE TABLE IF NOT EXISTS poll_suggestions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, group_id)
);

-- Read path filters by group for a resolved actor; the PK covers (user, group)
-- lookups. A standalone group index helps the ON DELETE CASCADE + any future
-- "regenerate everyone in this group" sweep.
CREATE INDEX IF NOT EXISTS poll_suggestions_group_idx ON poll_suggestions(group_id);

COMMIT;
