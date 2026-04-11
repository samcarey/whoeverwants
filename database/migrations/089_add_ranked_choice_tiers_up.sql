-- Add ranked_choice_tiers column for equal (tied) rankings support.
--
-- This column stores a tiered ballot as JSONB: a list of tiers, where each
-- tier is a list of option names ranked equally. Example:
--   [["A"], ["B", "C"], ["D"]]
-- means A is 1st, B and C are tied for 2nd, and D is 4th.
--
-- For backwards compatibility, the existing flat ranked_choices column is
-- still populated (with a tier-flattened version of the ballot). Votes with
-- no ties leave ranked_choice_tiers NULL and the backend falls back to
-- treating ranked_choices as singleton tiers.

ALTER TABLE votes ADD COLUMN IF NOT EXISTS ranked_choice_tiers JSONB;

-- No CHECK constraint changes needed: the existing vote_structure_valid
-- constraint from migration 084 only requires that ranked_choices is
-- populated (or is_abstain/is_ranking_abstain is set) — ranked_choice_tiers
-- is purely additive metadata.
