-- Explore feed (the "global group" surfaced at /explore).
--
-- An explore poll lives in a per-user "explore group" — a real `groups`
-- row marked `privacy = 'explore'`, owned by the creator. This reuses all
-- the existing group machinery (short_id, poll detail pages, category
-- recency keyed on group_id) while keeping explore polls OUT of the
-- regular surfaces:
--   * `/api/groups/mine` + `/empty` exclude `privacy = 'explore'` groups,
--     so an explore group never appears in the home list.
--   * `resolve_group_for_visit` treats 'explore' like 'private' (members
--     only, no auto-join), so the explore group's URL only resolves for
--     its creator — matching "for now, only see polls you created."
--   * category recency / options isolate 'explore' history from regular
--     groups (and vice versa) via the group's privacy.
--
-- This migration only widens the privacy CHECK constraint to admit the
-- new value; everything else is application logic.

BEGIN;

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_privacy_check;
ALTER TABLE groups
  ADD CONSTRAINT groups_privacy_check
  CHECK (privacy IN ('public', 'private', 'explore'));

COMMIT;
