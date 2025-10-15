-- Fix poll_type constraint to include participation type
-- Drop all possible constraint names
ALTER TABLE polls DROP CONSTRAINT IF EXISTS poll_type_check;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_poll_type_check;

-- Recreate with correct values
ALTER TABLE polls ADD CONSTRAINT polls_poll_type_check
CHECK (poll_type IN ('yes_no', 'ranked_choice', 'nomination', 'participation'));
