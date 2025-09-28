-- Add response_deadline column to polls table
-- Migration: 002_add_response_deadline
-- Description: Adds response deadline functionality to polls

ALTER TABLE polls ADD COLUMN response_deadline TIMESTAMP WITH TIME ZONE;

-- Create index for efficient querying of deadline-based polls
CREATE INDEX idx_polls_response_deadline ON polls(response_deadline);