-- Add poll_type and options columns to polls table
-- Migration: 003_add_poll_type_and_options
-- Description: Adds poll type selection and poll options functionality

-- Add poll_type column with enum constraint
ALTER TABLE polls ADD COLUMN poll_type VARCHAR(20) NOT NULL DEFAULT 'yes_no';
ALTER TABLE polls ADD CONSTRAINT poll_type_check CHECK (poll_type IN ('yes_no', 'ranked_choice'));

-- Add options column for storing poll choices as JSON
ALTER TABLE polls ADD COLUMN options JSONB;

-- Create index for efficient querying of poll types
CREATE INDEX idx_polls_poll_type ON polls(poll_type);

-- Create index for options queries
CREATE INDEX idx_polls_options ON polls USING GIN(options);