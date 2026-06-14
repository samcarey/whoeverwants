-- Revert the explore privacy value. Any existing 'explore' groups are
-- flipped to 'private' first so the narrower CHECK can be re-applied
-- (they're members-only either way, so this is the closest equivalent).

BEGIN;

UPDATE groups SET privacy = 'private' WHERE privacy = 'explore';

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_privacy_check;
ALTER TABLE groups
  ADD CONSTRAINT groups_privacy_check
  CHECK (privacy IN ('public', 'private'));

COMMIT;
