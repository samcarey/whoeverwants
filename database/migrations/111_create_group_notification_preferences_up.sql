-- Per-(browser, group) notification preferences.
--
-- Today there is exactly one knob: `notify_new_poll`. A missing row is
-- treated as the default for the feature, NOT as "off" — current default
-- is ON for every group the browser is a member of (see CLAUDE.md). The
-- row exists once the user has explicitly toggled, recording the override.
-- That keeps the "default ON for created/joined groups" UX free: we never
-- need to write a row at join/create time.
--
-- Fan-out query (in services/push.py) is:
--   SELECT gm.browser_id
--   FROM group_members gm
--   LEFT JOIN group_notification_preferences pref
--     ON pref.browser_id = gm.browser_id AND pref.group_id = gm.group_id
--   WHERE gm.group_id = :gid
--     AND gm.browser_id != :creator
--     AND COALESCE(pref.notify_new_poll, TRUE) = TRUE;

BEGIN;

CREATE TABLE group_notification_preferences (
  browser_id UUID NOT NULL,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  notify_new_poll BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (browser_id, group_id)
);

-- Secondary index for the fan-out scan from a group_id.
CREATE INDEX group_notification_preferences_group_idx
  ON group_notification_preferences (group_id);

COMMIT;
