-- Phase G of the auth & access model (see docs/auth-access-model.md).
-- Adds `group_invites` so creators can mint shareable links that grant
-- private-group membership on redemption. Complements Phase F join
-- requests: invites are creator-initiated, push (creator → joiner);
-- join requests are joiner-initiated, pull (joiner → creator approves).
--
-- Storage shape mirrors `sessions` and `magic_link_tokens`: server
-- stores only `sha256(token)` (token_hash). The raw token is returned
-- exactly once at create time and embedded in the shareable URL — a DB
-- leak doesn't yield usable invite tokens.
--
-- Mode: 'single' = max_uses=1 enforced server-side; 'multi' = max_uses
-- can be NULL (unlimited) or any positive int. The check constraint
-- accepts both — the create endpoint normalizes max_uses to 1 for
-- 'single' regardless of what the client sent.
--
-- `target_poll_id` is the optional "land on this poll after joining"
-- pointer. ON DELETE SET NULL so deleting a poll doesn't blow away
-- the invite — the redirect just falls back to the group root.
--
-- `expires_at` is nullable (no expiry by default). `revoked_at` is the
-- creator's "kill this link" stamp; NULL means active. Both are
-- checked at redeem time; an invite is REDEEMABLE iff
-- (revoked_at IS NULL) AND (expires_at IS NULL OR expires_at > NOW())
-- AND (max_uses IS NULL OR use_count < max_uses).
--
-- ON DELETE behavior:
--   * `group_id` → CASCADE: deleting a group drops every invite for it.
--   * `created_by_user_id` → CASCADE: deleting a user drops their
--     issued invites. They're not redeemable anyway after the FK row
--     vanishes, so no value in preserving them.
--   * `target_poll_id` → SET NULL: deleting a poll falls back to the
--     group-root redirect on redeem.

BEGIN;

CREATE TABLE group_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('single', 'multi')),
    target_poll_id UUID REFERENCES polls(id) ON DELETE SET NULL,
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Creator-side "list my group's invites" — pulls all rows for one
-- group_id, sorted by created_at. Active-only filter happens in
-- application code (compound predicate over revoked_at + expires_at
-- + max_uses isn't worth a partial index for the expected row counts).
CREATE INDEX group_invites_group_id_idx
    ON group_invites (group_id, created_at DESC);

-- Redeem path: hash the inbound raw token, look up by token_hash.
-- The UNIQUE constraint already provides the index, but the explicit
-- name makes the lookup intent visible in EXPLAIN output.

COMMIT;
