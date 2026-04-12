-- Revert: remove ranked_choice_tiers column.
ALTER TABLE votes DROP COLUMN IF EXISTS ranked_choice_tiers;
