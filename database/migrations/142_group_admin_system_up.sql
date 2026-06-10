-- 142: Group admin system.
--
-- Generalizes the single `groups.creator_user_id` into a multi-admin role.
--   * `group_admins` — account-keyed admin roster (membership is browser-keyed,
--     but admin powers require a real account). The original creator is admin #1.
--   * `group_members.joined_via_invite_id` — which invite a member joined through,
--     so booting that member can revoke the specific link they used.
--   * DESTRUCTIVE: wipes legacy NULL-creator groups. These are pre-account
--     anonymous-era groups with no account anywhere to administer them; per the
--     owner's decision (CLAUDE.md group-admin design) this data is disposable.
--     Cascades to polls/questions/votes/members/invites/... (verified FK chain).
--   * Backfills the surviving groups' creators as admin #1.
--
-- The "every group has an admin" invariant lives in `group_admins` (seeded on
-- create, auto-promoted on vacancy), NOT a NOT NULL on `groups.creator_user_id`:
-- that column's FK is ON DELETE SET NULL, so a creator deleting their account
-- legitimately nulls it while `group_admins` keeps the real (auto-promoted)
-- admin. `creator_user_id` is now vestigial historical data — authorization
-- reads `group_admins`, not it.

BEGIN;

-- 1. Admin roster.
CREATE TABLE group_admins (
    group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_admins_user_id_idx ON group_admins (user_id);

-- 2. Track the invite a member joined through (NULL when they joined via a
--    join-request approval, "add people", or a plain public-link visit).
ALTER TABLE group_members
    ADD COLUMN joined_via_invite_id UUID REFERENCES group_invites(id) ON DELETE SET NULL;

-- 3. Destructive wipe of legacy NULL-creator groups. The down-migration CANNOT
--    restore these rows.
DELETE FROM groups WHERE creator_user_id IS NULL;

-- 4. Seed every surviving group's creator as admin #1.
INSERT INTO group_admins (group_id, user_id)
SELECT id, creator_user_id FROM groups WHERE creator_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
