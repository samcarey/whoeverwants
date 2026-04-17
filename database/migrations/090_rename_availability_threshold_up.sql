-- Rework time poll availability threshold semantics.
--
-- Old semantic: availability_threshold = "% slack below the most-available slot"
--   (filter kept slots with count >= max_avail * (1 - threshold/100))
-- New semantic: min_availability_percent = "% of the most-available slot's count required"
--   (filter keeps slots with count >= max_avail * percent/100)
--
-- New = 100 - old, so existing polls keep the same effective filter.
-- Default changes from 5 → 95 to match.

ALTER TABLE polls RENAME COLUMN availability_threshold TO min_availability_percent;

UPDATE polls
SET min_availability_percent = 100 - min_availability_percent
WHERE min_availability_percent IS NOT NULL;

ALTER TABLE polls ALTER COLUMN min_availability_percent SET DEFAULT 95;
