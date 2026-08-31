-- 159: contact-group nesting — a private contact group can contain other
-- contact groups (same owner) alongside friends. Matching flattens the
-- tree recursively (services/friends.py: contact_group_memberships); cycle
-- prevention is app-level at write time (the recursive reads use UNION so
-- a legacy cycle could not loop them anyway).
BEGIN;

CREATE TABLE IF NOT EXISTS contact_group_children (
    group_id UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
    child_group_id UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, child_group_id),
    CHECK (group_id <> child_group_id)
);
CREATE INDEX IF NOT EXISTS contact_group_children_child_idx
    ON contact_group_children (child_group_id);

COMMIT;
