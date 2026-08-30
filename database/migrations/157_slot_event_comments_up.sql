-- Comments on Playlist EVENTS: the poll-comments model (migrations 146/147),
-- keyed on the event's (day, LOWER(activity)) identity instead of a poll_id —
-- events are derived (no anchor row is guaranteed to exist), so the thread
-- anchors on the key itself. Identity mirrors poll_comments: browser_id +
-- resolved account user_id at post time, SET NULL on account deletion so the
-- comment survives on its captured name. No mentions column — event
-- candidates have no roster/push story yet (v1).

BEGIN;

CREATE TABLE IF NOT EXISTS slot_event_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    day DATE NOT NULL,
    activity TEXT NOT NULL,
    browser_id UUID,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    commenter_name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS slot_event_comments_key_idx
    ON slot_event_comments (day, LOWER(activity), created_at);

-- Reactions mirror poll_comment_reactions exactly (browser-keyed writes,
-- account-aware reads via COALESCE(user_id, browser_id)).
CREATE TABLE IF NOT EXISTS slot_event_comment_reactions (
    comment_id UUID NOT NULL REFERENCES slot_event_comments(id) ON DELETE CASCADE,
    browser_id UUID NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (comment_id, browser_id, emoji)
);

COMMIT;
