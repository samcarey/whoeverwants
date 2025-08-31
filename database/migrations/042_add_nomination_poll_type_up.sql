-- Add nomination poll type to existing poll_type constraint
-- Migration: 042_add_nomination_poll_type
-- Description: Extends poll_type enum to include nomination type

-- Drop the existing constraint
ALTER TABLE polls DROP CONSTRAINT IF EXISTS poll_type_check;

-- Add the updated constraint including nomination
ALTER TABLE polls ADD CONSTRAINT poll_type_check CHECK (poll_type IN ('yes_no', 'ranked_choice', 'nomination'));