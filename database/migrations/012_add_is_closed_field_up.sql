-- Add is_closed field to polls table for manual poll closing
ALTER TABLE polls ADD COLUMN is_closed BOOLEAN DEFAULT FALSE;