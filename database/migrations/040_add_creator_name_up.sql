-- Add creator_name column to polls table for optional creator identification
ALTER TABLE polls ADD COLUMN IF NOT EXISTS creator_name TEXT;