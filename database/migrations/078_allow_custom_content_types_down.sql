-- Restore poll_content_type check constraint
-- Note: any rows with custom values will need to be updated to 'custom' first
UPDATE polls SET poll_content_type = 'custom'
  WHERE poll_content_type NOT IN ('custom', 'location', 'movie', 'video_game');
ALTER TABLE polls ALTER COLUMN poll_content_type TYPE VARCHAR(20);
ALTER TABLE polls ADD CONSTRAINT polls_poll_content_type_check
    CHECK (poll_content_type IN ('custom', 'location', 'movie', 'video_game'));
