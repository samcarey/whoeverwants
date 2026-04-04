-- Add min_responses and show_preliminary_results columns for preference/suggestion polls
ALTER TABLE polls ADD COLUMN IF NOT EXISTS min_responses integer DEFAULT 1;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS show_preliminary_results boolean DEFAULT true;
