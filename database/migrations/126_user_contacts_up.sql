-- 126: user_contacts — per-account "people you've encountered" address book.
--
-- Backs the group "invite members" screen. owner_user_id has encountered
-- contact_user_id by sharing at least one group with them at some point.
-- The relationship is PERSISTED (it survives the two of them leaving the
-- shared group) so the invite screen can still surface someone you were
-- recently in groups with but no longer share any with.
--
-- `last_seen_at` is the recency watermark: bumped to NOW() each time the
-- pair is observed sharing a group (reconcile-on-/mine + reconcile when the
-- invite screen opens). It's what the invite list sorts the
-- "0 current shared groups" tier by — most recently seen first.
--
-- "How many groups we are CURRENTLY in together" is intentionally NOT stored
-- here — it's computed live at read time, since it changes as groups come
-- and go. This table only remembers the encounter + its recency.

BEGIN;

CREATE TABLE IF NOT EXISTS user_contacts (
    owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_user_id, contact_user_id)
);

CREATE INDEX IF NOT EXISTS user_contacts_owner_idx
    ON user_contacts (owner_user_id);

COMMIT;
