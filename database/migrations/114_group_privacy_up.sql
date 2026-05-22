-- Phase E of the auth & access model (see docs/auth-access-model.md).
-- Adds the two columns that drive group-level privacy:
--
--   `privacy`         — 'public' | 'private'. Default 'private' for new
--                       INSERTs; existing rows are backfilled to 'public'
--                       below so shared links to pre-Phase-E groups keep
--                       working (grandfathering).
--   `creator_user_id` — user_id of the signed-in creator. NULL for
--                       anonymous-created groups (those are forced
--                       public; see `services/groups.py`). Phase F/G
--                       use this to authorize "approve a join request"
--                       and "create an invite link". ON DELETE SET NULL
--                       so deleting a user (Phase I) doesn't cascade
--                       through every group they ever created.
--
-- Visibility consequences (enforced in `services/groups.py`):
--   * Public groups: existing behavior (Phase C.3) — `?p=` link grants
--     membership inline on visit, legacy `accessible_question_ids`
--     bridge applies, etc.
--   * Private groups: ONLY explicit `group_members` rows grant visibility.
--     The Phase C.3 inline grant is skipped, the legacy bridge is
--     filtered to public-only, and `/by-route-id` returns 404 to
--     non-members. Joining requires an explicit invite (Phase G) or
--     approved join request (Phase F).
--
-- The signed-in / anonymous split lives in the create endpoints
-- (`POST /api/groups`, `POST /api/polls` when minting a new group):
-- anonymous → public, signed-in → private. This migration's column
-- default of 'private' governs only fall-through inserts that don't
-- specify privacy; the application code in Phase E always specifies it.

BEGIN;

ALTER TABLE groups
  ADD COLUMN privacy TEXT NOT NULL DEFAULT 'private'
    CHECK (privacy IN ('public', 'private')),
  ADD COLUMN creator_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Grandfather every existing group to public so shared URLs from
-- before Phase E keep resolving for non-members. The column default
-- 'private' applies to new INSERTs going forward.
UPDATE groups SET privacy = 'public';

-- "Groups I own" lookups in Phase F/G (approve join request, list
-- invites the creator issued) will scan by creator_user_id.
CREATE INDEX groups_creator_user_id_idx ON groups (creator_user_id);

COMMIT;
