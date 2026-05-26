-- Make the per-group notification ("mute") preference follow the account.
--
-- Migration 111 keyed `group_notification_preferences` by (browser_id,
-- group_id), so muting a group on one device left it un-muted on the user's
-- other devices. The pref is now keyed by (user_id, group_id) for users with
-- an account, falling back to (browser_id, group_id) for account-less callers.
-- Default is still "ON when no row exists".
--
-- A row carries EITHER user_id (account-scoped) or browser_id (account-less),
-- never both. Existing rows are backfilled to the account linked to their
-- browser; rows now colliding on (user_id, group_id) keep the most recently
-- updated value.

BEGIN;

ALTER TABLE group_notification_preferences
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- A pref belongs to the account linked to the browser that set it.
UPDATE group_notification_preferences p
   SET user_id = ub.user_id
  FROM user_browsers ub
 WHERE ub.browser_id = p.browser_id
   AND p.user_id IS NULL;

-- Dedup rows that now share (user_id, group_id): keep the newest toggle.
DELETE FROM group_notification_preferences a
 USING group_notification_preferences b
 WHERE a.user_id IS NOT NULL
   AND a.user_id = b.user_id
   AND a.group_id = b.group_id
   AND (a.updated_at < b.updated_at
        OR (a.updated_at = b.updated_at AND a.ctid < b.ctid));

-- Account rows are keyed by user_id; clear browser_id so they don't also
-- satisfy the browser-scoped lookup.
UPDATE group_notification_preferences SET browser_id = NULL WHERE user_id IS NOT NULL;

ALTER TABLE group_notification_preferences
  DROP CONSTRAINT IF EXISTS group_notification_preferences_pkey;
ALTER TABLE group_notification_preferences ALTER COLUMN browser_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gnp_user_group_key
  ON group_notification_preferences (user_id, group_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gnp_browser_group_key
  ON group_notification_preferences (browser_id, group_id) WHERE browser_id IS NOT NULL;

ALTER TABLE group_notification_preferences
  ADD CONSTRAINT gnp_identity_check
  CHECK (user_id IS NOT NULL OR browser_id IS NOT NULL);

COMMIT;
