-- Comment editing, @mentions, and emoji reactions (extends migration 146).
--
-- * `edited_at` — stamped on every author edit; NULL = never edited. Drives
--   the FE's "edited" marker.
-- * `mentions` — JSONB array of {user_id, name} captured at post time from
--   the FE's @-autocomplete (validated server-side to group members). Stored
--   so rendering can highlight "@Name" without re-resolving the roster, and
--   names survive account deletion.
-- * `poll_comment_reactions` — one row per (comment, browser, emoji), the
--   votes convention: browser-keyed WRITES, account-aware READS (counts
--   collapse rows via COALESCE(user_id, browser_id); "mine" unions across
--   caller_browser_ids). Toggling off deletes the account's rows.

BEGIN;

ALTER TABLE poll_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE poll_comments ADD COLUMN IF NOT EXISTS mentions JSONB;

CREATE TABLE IF NOT EXISTS poll_comment_reactions (
    comment_id UUID NOT NULL REFERENCES poll_comments(id) ON DELETE CASCADE,
    browser_id UUID NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (comment_id, browser_id, emoji)
);

COMMIT;
