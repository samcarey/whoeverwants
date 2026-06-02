-- Gap 1: per-poll follow/ignore state ("To Do · New · Old" tabs).
--
-- Every viewer "follows" every poll by default (no row = 'new'). On the group
-- page a viewer can tap a red ✕ on a To Do/New row to IGNORE a poll (writes
-- 'old') or a green + on an Old row to RE-FOLLOW it (writes 'new'). This is a
-- per-viewer follow/ignore archive — NOT open/closed, NOT decided, and
-- orthogonal to group membership (✕ ≠ leaving the group).
--
-- Keyed on browser_id with the usual `user_browsers` account-union on reads
-- (mirrors group_members / load_user_visibility): the effective state for a
-- caller is the most-recently-updated row across every browser linked to their
-- account, so ✕ on one device syncs to the same account on another. Anonymous
-- viewers key on the current browser_id alone (in-app filtering + notification
-- suppression still apply).
--
-- 'old' polls are excluded from that viewer's app-icon badge count and from the
-- poll-closed / phase-transition / outcome push notifications — "ignore this
-- poll" means it goes quiet everywhere.

CREATE TABLE IF NOT EXISTS poll_follow_state (
  poll_id    UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  browser_id UUID NOT NULL,
  state      TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'old')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, browser_id)
);

-- The notification fan-out / badge path resolves "which polls has this browser
-- ignored?" — a browser_id-leading lookup, not covered by the (poll_id, *) PK.
CREATE INDEX IF NOT EXISTS idx_poll_follow_state_browser
  ON poll_follow_state (browser_id);
