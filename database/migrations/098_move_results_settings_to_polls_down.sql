-- Down migration for 098: move settings back from polls to questions.

BEGIN;

-- 1. Recreate the columns on questions with the same defaults.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS min_responses INTEGER DEFAULT 1;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS show_preliminary_results BOOLEAN DEFAULT TRUE;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS allow_pre_ranking BOOLEAN DEFAULT TRUE;

-- 2. Copy values from the parent poll back to every question.
UPDATE questions p
SET min_responses = mp.min_responses,
    show_preliminary_results = mp.show_preliminary_results,
    allow_pre_ranking = mp.allow_pre_ranking
FROM polls mp
WHERE p.poll_id = mp.id;

-- 3. Drop the columns from polls.
ALTER TABLE polls DROP COLUMN IF EXISTS min_responses;
ALTER TABLE polls DROP COLUMN IF EXISTS show_preliminary_results;
ALTER TABLE polls DROP COLUMN IF EXISTS allow_pre_ranking;

COMMIT;
