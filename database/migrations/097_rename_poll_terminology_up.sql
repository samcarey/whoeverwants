-- Rename terminology: multipolls -> polls, polls -> questions.
-- Migration: 097_rename_poll_terminology
--
-- The old `polls` table represented the inner ballot section ("sub-poll").
-- The old `multipolls` table represented the wrapper that users actually
-- share. We're renaming so that the wrapper is called a "poll" and the
-- inner section is called a "question".
--
-- Order matters: rename old `polls` -> `questions` FIRST to free up the
-- `polls` name, THEN rename `multipolls` -> `polls`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rename old `polls` table -> `questions`
-- ---------------------------------------------------------------------------

ALTER TABLE polls RENAME TO questions;

-- Rename columns on questions:
--   multipoll_id    -> poll_id        (FK to wrapper)
--   sub_poll_index  -> question_index (sibling order within wrapper)
--   poll_type       -> question_type  (ballot kind; matches new "Question" naming)
ALTER TABLE questions RENAME COLUMN multipoll_id TO poll_id;
ALTER TABLE questions RENAME COLUMN sub_poll_index TO question_index;
ALTER TABLE questions RENAME COLUMN poll_type TO question_type;

-- Rename indexes on questions
ALTER INDEX polls_pkey RENAME TO questions_pkey;
ALTER INDEX idx_polls_multipoll_id RENAME TO idx_questions_poll_id;
ALTER INDEX idx_polls_options RENAME TO idx_questions_options;
ALTER INDEX idx_polls_poll_type RENAME TO idx_questions_question_type;

-- Rename trigger on questions
ALTER TRIGGER update_polls_updated_at ON questions RENAME TO update_questions_updated_at;

-- Rename FK columns on dependent tables that referenced old polls.id
ALTER TABLE votes RENAME COLUMN poll_id TO question_id;
ALTER INDEX votes_poll_id_idx RENAME TO votes_question_id_idx;

ALTER TABLE ranked_choice_rounds RENAME COLUMN poll_id TO question_id;
ALTER INDEX idx_ranked_choice_rounds_poll_round RENAME TO idx_ranked_choice_rounds_question_round;
ALTER INDEX ranked_choice_rounds_poll_id_round_number_option_name_key
  RENAME TO ranked_choice_rounds_question_id_round_number_option_name_key;

-- Update RLS policies on `questions` table.
DROP POLICY IF EXISTS "Allow public read access on polls" ON questions;
DROP POLICY IF EXISTS "Allow public insert access on polls" ON questions;
DROP POLICY IF EXISTS "Allow public update access on polls" ON questions;

CREATE POLICY "Allow public read access on questions" ON questions
  FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on questions" ON questions
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access on questions" ON questions
  FOR UPDATE USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. Rename `multipolls` table -> `polls`
-- ---------------------------------------------------------------------------

ALTER TABLE multipolls RENAME TO polls;

-- Rename indexes
ALTER INDEX multipolls_pkey RENAME TO polls_pkey;
ALTER INDEX multipolls_sequential_id_key RENAME TO polls_sequential_id_key;
ALTER INDEX multipolls_short_id_key RENAME TO polls_short_id_key;
ALTER INDEX idx_multipolls_short_id RENAME TO idx_polls_short_id;
ALTER INDEX idx_multipolls_follow_up_to RENAME TO idx_polls_follow_up_to;

-- Rename sequence
ALTER SEQUENCE multipolls_sequential_id_seq RENAME TO polls_sequential_id_seq;

-- Rename triggers
ALTER TRIGGER update_multipolls_updated_at ON polls RENAME TO update_polls_updated_at;
ALTER TRIGGER trigger_generate_multipoll_short_id ON polls RENAME TO trigger_generate_poll_short_id;

-- Rename trigger function and rebind the trigger.
CREATE OR REPLACE FUNCTION generate_poll_short_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.short_id IS NULL AND NEW.sequential_id IS NOT NULL THEN
    NEW.short_id := encode_base62(NEW.sequential_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_poll_short_id ON polls;
CREATE TRIGGER trigger_generate_poll_short_id
  BEFORE INSERT OR UPDATE ON polls
  FOR EACH ROW
  EXECUTE FUNCTION generate_poll_short_id();

DROP FUNCTION IF EXISTS generate_multipoll_short_id();

-- Update RLS policies on the renamed `polls` (was multipolls) table.
DROP POLICY IF EXISTS "Allow public read access on multipolls" ON polls;
DROP POLICY IF EXISTS "Allow public insert access on multipolls" ON polls;
DROP POLICY IF EXISTS "Allow public update access on multipolls" ON polls;

CREATE POLICY "Allow public read access on polls" ON polls
  FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on polls" ON polls
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access on polls" ON polls
  FOR UPDATE USING (true) WITH CHECK (true);

COMMIT;
