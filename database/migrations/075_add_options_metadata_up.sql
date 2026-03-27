-- Add options_metadata JSONB column to store thumbnail URLs and info links per option
-- Format: { "Option Label": { "imageUrl": "...", "infoUrl": "..." }, ... }
ALTER TABLE polls ADD COLUMN IF NOT EXISTS options_metadata JSONB;
