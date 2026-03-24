-- Add auto-close fields to polls table
-- auto_close_mode: 'none', 'previous_respondents', 'num_responses'
-- auto_close_num: number of responses to trigger close (only for 'num_responses' mode)

ALTER TABLE polls ADD COLUMN IF NOT EXISTS auto_close_mode VARCHAR(20) DEFAULT 'none';
ALTER TABLE polls ADD COLUMN IF NOT EXISTS auto_close_num INTEGER;

-- Add check constraint for valid auto_close_mode values
ALTER TABLE polls ADD CONSTRAINT polls_auto_close_mode_check
  CHECK (auto_close_mode IN ('none', 'previous_respondents', 'num_responses'));

-- Add check constraint: auto_close_num must be positive when set
ALTER TABLE polls ADD CONSTRAINT polls_auto_close_num_check
  CHECK (auto_close_num IS NULL OR auto_close_num > 0);

INSERT INTO _migrations (name) VALUES ('067_add_auto_close_fields');
