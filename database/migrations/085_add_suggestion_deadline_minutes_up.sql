-- Add suggestion_deadline_minutes to store the original duration.
-- The suggestion_deadline timestamp is now set when the first suggestion is submitted,
-- not at poll creation time.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS suggestion_deadline_minutes INT;

-- Record in migrations table
INSERT INTO _migrations (name) VALUES ('085_add_suggestion_deadline_minutes') ON CONFLICT DO NOTHING;
