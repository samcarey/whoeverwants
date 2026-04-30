-- Move three settings from the question level to the poll level:
--   - min_responses
--   - show_preliminary_results
--   - allow_pre_ranking
--
-- These were originally per-question, but conceptually they describe how the
-- whole poll behaves (when can voters see results, can ranked-choice voters
-- pre-rank during the suggestion phase). Lifting them to the wrapper makes
-- them a single configuration the user sets once per poll.

BEGIN;

-- 1. Add columns to polls with the same defaults the questions columns use.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS min_responses INTEGER DEFAULT 1;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS show_preliminary_results BOOLEAN DEFAULT TRUE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS allow_pre_ranking BOOLEAN DEFAULT TRUE;

-- 2. Backfill from the first question of each poll (question_index=0 if set,
--    else lowest created_at). For multi-question polls we pick a single
--    representative value; in practice every existing poll has 1 question
--    (Phase 4 backfill), and even multi-question polls created since
--    Phase 2.4 share these values across questions because the form state
--    was shared at the UI layer.
UPDATE polls mp
SET min_responses = sub.min_responses,
    show_preliminary_results = sub.show_preliminary_results,
    allow_pre_ranking = sub.allow_pre_ranking
FROM (
    SELECT DISTINCT ON (poll_id)
           poll_id,
           min_responses,
           show_preliminary_results,
           allow_pre_ranking
      FROM questions
     WHERE poll_id IS NOT NULL
     ORDER BY poll_id,
              question_index NULLS LAST,
              created_at
) AS sub
WHERE mp.id = sub.poll_id;

-- 3. Drop the columns from questions now that polls owns them.
ALTER TABLE questions DROP COLUMN IF EXISTS min_responses;
ALTER TABLE questions DROP COLUMN IF EXISTS show_preliminary_results;
ALTER TABLE questions DROP COLUMN IF EXISTS allow_pre_ranking;

COMMIT;
