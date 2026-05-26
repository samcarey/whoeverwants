-- Revert group_notification_preferences to per-browser keying (migration 125).
--
-- LOSSY: account-scoped rows (browser_id NULL) can't be remapped to a single
-- browser, so they're dropped. Browser-scoped rows are preserved.

BEGIN;

ALTER TABLE group_notification_preferences DROP CONSTRAINT IF EXISTS gnp_identity_check;
DROP INDEX IF EXISTS gnp_user_group_key;
DROP INDEX IF EXISTS gnp_browser_group_key;

DELETE FROM group_notification_preferences WHERE browser_id IS NULL;
ALTER TABLE group_notification_preferences DROP COLUMN IF EXISTS user_id;
ALTER TABLE group_notification_preferences ALTER COLUMN browser_id SET NOT NULL;
ALTER TABLE group_notification_preferences
  ADD PRIMARY KEY (browser_id, group_id);

COMMIT;
