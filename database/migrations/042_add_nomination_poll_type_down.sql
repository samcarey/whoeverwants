-- Revert nomination poll type addition
-- Migration: 042_add_nomination_poll_type (down)
-- Description: Removes nomination from poll_type enum

-- Drop the existing constraint
ALTER TABLE polls DROP CONSTRAINT IF EXISTS poll_type_check;

-- Restore the original constraint without nomination
ALTER TABLE polls ADD CONSTRAINT poll_type_check CHECK (poll_type IN ('yes_no', 'ranked_choice'));