-- Phase F of the auth & access model (see docs/auth-access-model.md).
-- Adds `group_join_requests` so signed-in non-members of a private group
-- can request access, and the creator can approve or deny. Phase E's
-- "private = members-only" rule otherwise leaves no path into a private
-- group except via an invite link (Phase G).
--
-- One pending request per (group, requester) — enforced by a partial
-- unique index so the same user can re-request after a denial without a
-- dedupe error. Status walks 'pending' → 'approved' | 'denied' |
-- 'cancelled'; only `pending` rows occupy the unique slot.
--
-- `requester_user_id` is NOT NULL: only signed-in users can request.
-- Anonymous browsers can't request because there's no durable identity
-- to approve against (an anonymous request approved on Browser A would
-- be useless if the user wipes localStorage on Browser B and never
-- re-signed in). The endpoint enforces this; the FK + NOT NULL is the
-- backstop.
--
-- `message` is the optional "Hi, it's Alice from work" the requester
-- adds so the creator knows who's asking. NULL when blank.
--
-- ON DELETE behavior:
--   * `group_id` → CASCADE: deleting a group drops every pending and
--     historical request for it. There's no value to surface them
--     elsewhere; the data is gone with the group.
--   * `requester_user_id` → CASCADE: deleting a user (Phase I) drops
--     their requests; the creator has no remaining context to act on.
--   * `decided_by_user_id` → SET NULL: deleting the creator should NOT
--     blow away the historical record of approved/denied decisions;
--     the rows remain with `decided_by_user_id IS NULL` as
--     "decision by [deleted user]".

BEGIN;

CREATE TABLE group_join_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    decided_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Partial unique: only ONE pending request per (group, requester). A
-- denied or approved row doesn't occupy the slot, so the user can
-- re-request after a denial (or self-cancel and try again).
CREATE UNIQUE INDEX group_join_requests_pending_unique
    ON group_join_requests (group_id, requester_user_id)
    WHERE status = 'pending';

-- Creator-side "list pending for my group" lookup goes through
-- (group_id, status) — pending list, sorted by requested_at. Covered by
-- this index without scanning historical rows.
CREATE INDEX group_join_requests_group_status_idx
    ON group_join_requests (group_id, status, requested_at);

-- Requester-side "my pending requests" lookup (Phase F.future may
-- surface this as a "you have N pending requests" badge on the home
-- page). Cheap to maintain; rare to query without it.
CREATE INDEX group_join_requests_requester_idx
    ON group_join_requests (requester_user_id, status);

COMMIT;
