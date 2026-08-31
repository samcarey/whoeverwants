-- 158: friends system — mutual friendships via requests, block lists,
-- private contact groups (personal labels over friends), and a stable
-- public friend_code per user backing the shareable profile link (/f/<code>).
BEGIN;

-- Public, shareable profile-link code. Minted lazily server-side on first
-- need (services/friends.py: ensure_friend_code); not a secret — the owner
-- still has to accept any request that arrives through it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_friend_code_uidx
    ON users (friend_code) WHERE friend_code IS NOT NULL;

-- One row per request; an accepted row IS the friendship (either direction).
CREATE TABLE IF NOT EXISTS friend_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    CHECK (from_user_id <> to_user_id)
);
-- One live pending edge per ordered pair (re-requests after a rejection are
-- new rows), and one accepted friendship per unordered pair.
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_uidx
    ON friend_requests (from_user_id, to_user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_accepted_uidx
    ON friend_requests (LEAST(from_user_id, to_user_id), GREATEST(from_user_id, to_user_id))
    WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS friend_requests_to_idx ON friend_requests (to_user_id);
CREATE INDEX IF NOT EXISTS friend_requests_from_idx ON friend_requests (from_user_id);

-- Directed block edges; matching + visibility treat them symmetrically
-- (either direction partitions the pair).
CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_user_id, blocked_user_id),
    CHECK (blocker_user_id <> blocked_user_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks (blocked_user_id);

-- Private contact groups: personal labels over the owner's friends. Only the
-- owner ever sees them; members are not notified and need not consent.
CREATE TABLE IF NOT EXISTS contact_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS contact_groups_owner_name_uidx
    ON contact_groups (owner_user_id, LOWER(name));

CREATE TABLE IF NOT EXISTS contact_group_members (
    group_id UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
    member_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, member_user_id)
);
CREATE INDEX IF NOT EXISTS contact_group_members_member_idx
    ON contact_group_members (member_user_id);

COMMIT;
