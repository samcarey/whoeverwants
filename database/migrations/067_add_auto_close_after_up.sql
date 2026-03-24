-- Add auto_close_after column to polls table.
-- When set, the poll automatically closes after this many unique respondents.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS auto_close_after integer;
