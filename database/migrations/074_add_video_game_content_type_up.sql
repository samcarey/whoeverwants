-- Add 'video_game' to poll_content_type check constraint
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_content_type_check;
ALTER TABLE polls ADD CONSTRAINT polls_poll_content_type_check
    CHECK (poll_content_type IN ('custom', 'location', 'movie', 'video_game'));
