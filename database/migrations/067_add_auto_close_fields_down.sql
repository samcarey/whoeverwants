-- Remove auto-close fields from polls table
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_auto_close_num_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_auto_close_mode_check;
ALTER TABLE polls DROP COLUMN IF EXISTS auto_close_num;
ALTER TABLE polls DROP COLUMN IF EXISTS auto_close_mode;

DELETE FROM _migrations WHERE name = '067_add_auto_close_fields';
