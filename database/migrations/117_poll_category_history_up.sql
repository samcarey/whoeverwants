-- Per-(browser, group, category) record of which poll categories a user
-- has created, used to order the category bubble bar on group pages.
--
-- The bubble bar (BUBBLE_ENTRIES in app/create-poll/page.tsx) is ordered:
--   1. categories the user created polls for most recently IN THIS GROUP
--   2. categories the user created polls for most recently IN GENERAL
--   3. remaining categories in a per-app-start random order (FE-side)
--
-- This table backs (1) and (2). One row per (browser_id, group_id,
-- category); `last_created_at` is bumped on every create so the recency
-- ordering reflects the most recent poll of that category. Append-style
-- growth is bounded by the small built-in category set per group.
--
-- Cross-browser: a signed-in user has N browser_ids. The recency query
-- (services/poll_categories.py: load_category_recency) unions across every
-- browser linked to the user via `user_browsers`, mirroring the visibility
-- expansion in services/groups.py: load_user_visibility.
--
-- `category` stores the value used by the create-poll bubbles (yes_no,
-- time, restaurant, location, movie, video_game, custom, or any custom
-- text). Time questions are recorded as "time" even though their stored
-- `questions.category` is "custom" — the writer feeds `_category_for_title`
-- so the recorded value matches the bubble the user tapped.

BEGIN;

CREATE TABLE poll_category_history (
  browser_id UUID NOT NULL,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  last_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (browser_id, group_id, category)
);

-- General recency: scan a browser's rows newest-first.
CREATE INDEX poll_category_history_browser_idx
  ON poll_category_history (browser_id, last_created_at DESC);

-- Per-group recency: scan one group's rows for a browser newest-first.
CREATE INDEX poll_category_history_group_browser_idx
  ON poll_category_history (group_id, browser_id, last_created_at DESC);

COMMIT;
