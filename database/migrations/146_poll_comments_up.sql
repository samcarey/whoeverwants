-- Poll comments: a lightweight discussion thread on each poll.
--
-- One row per comment. Identity mirrors votes (migration 120): the writer's
-- browser_id + resolved account user_id are recorded so "is this mine?" reads
-- are account-aware (`caller_browser_ids` union), while `commenter_name` is
-- the display string captured at post time (same name-required policy as
-- voting — validate_user_name is the server backstop).
--
-- Comments are poll-level (the poll is the addressable unit — never
-- per-question) and flat (no threading in v1). Deletion is a hard DELETE by
-- the author; there's no edit path yet.

BEGIN;

CREATE TABLE IF NOT EXISTS poll_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    -- Writer identity: browser always (when the header was present), account
    -- when one resolves. SET NULL keeps the comment visible after account
    -- deletion (the name string stands on its own).
    browser_id UUID,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    commenter_name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The only read path is "this poll's comments, oldest first".
CREATE INDEX IF NOT EXISTS poll_comments_poll_created_idx
    ON poll_comments(poll_id, created_at);

COMMIT;
