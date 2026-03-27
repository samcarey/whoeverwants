-- Add poll_content_type column to polls table
-- Values: 'custom' (default), 'location', 'movie'
-- Used by nomination and ranked_choice polls to enable autocomplete and rich display

ALTER TABLE polls ADD COLUMN IF NOT EXISTS poll_content_type VARCHAR(20) DEFAULT 'custom';

-- Add check constraint for valid values
ALTER TABLE polls ADD CONSTRAINT polls_poll_content_type_check
    CHECK (poll_content_type IN ('custom', 'location', 'movie'));
