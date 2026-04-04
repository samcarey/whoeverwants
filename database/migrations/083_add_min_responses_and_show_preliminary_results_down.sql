-- Remove min_responses and show_preliminary_results columns
ALTER TABLE polls DROP COLUMN IF EXISTS min_responses;
ALTER TABLE polls DROP COLUMN IF EXISTS show_preliminary_results;
