ALTER TABLE polls DROP COLUMN IF EXISTS suggestion_deadline_minutes;
DELETE FROM _migrations WHERE name = '085_add_suggestion_deadline_minutes';
