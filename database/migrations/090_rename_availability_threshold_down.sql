-- Revert to old availability_threshold semantics.

ALTER TABLE polls ALTER COLUMN min_availability_percent SET DEFAULT 5;

UPDATE polls
SET min_availability_percent = 100 - min_availability_percent
WHERE min_availability_percent IS NOT NULL;

ALTER TABLE polls RENAME COLUMN min_availability_percent TO availability_threshold;
