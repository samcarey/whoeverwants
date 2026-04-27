-- Reverse: polls -> multipolls, questions -> polls.
-- Order matters: rename `polls` (was multipolls) -> `multipolls` FIRST so the
-- `polls` name is free, then rename `questions` -> `polls`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rename `polls` (wrapper) back to `multipolls`
-- ---------------------------------------------------------------------------

ALTER TABLE polls RENAME TO multipolls;

ALTER INDEX polls_pkey RENAME TO multipolls_pkey;
ALTER INDEX polls_sequential_id_key RENAME TO multipolls_sequential_id_key;
ALTER INDEX polls_short_id_key RENAME TO multipolls_short_id_key;
ALTER INDEX idx_polls_short_id RENAME TO idx_multipolls_short_id;
ALTER INDEX idx_polls_follow_up_to RENAME TO idx_multipolls_follow_up_to;

ALTER SEQUENCE polls_sequential_id_seq RENAME TO multipolls_sequential_id_seq;

ALTER TRIGGER update_polls_updated_at ON multipolls RENAME TO update_multipolls_updated_at;
ALTER TRIGGER trigger_generate_poll_short_id ON multipolls RENAME TO trigger_generate_multipoll_short_id;

CREATE OR REPLACE FUNCTION generate_multipoll_short_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.short_id IS NULL AND NEW.sequential_id IS NOT NULL THEN
    NEW.short_id := encode_base62(NEW.sequential_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_multipoll_short_id ON multipolls;
CREATE TRIGGER trigger_generate_multipoll_short_id
  BEFORE INSERT OR UPDATE ON multipolls
  FOR EACH ROW
  EXECUTE FUNCTION generate_multipoll_short_id();

DROP FUNCTION IF EXISTS generate_poll_short_id();

DROP POLICY IF EXISTS "Allow public read access on polls" ON multipolls;
DROP POLICY IF EXISTS "Allow public insert access on polls" ON multipolls;
DROP POLICY IF EXISTS "Allow public update access on polls" ON multipolls;

CREATE POLICY "Allow public read access on multipolls" ON multipolls
  FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on multipolls" ON multipolls
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access on multipolls" ON multipolls
  FOR UPDATE USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. Rename `questions` back to `polls`
-- ---------------------------------------------------------------------------

ALTER TABLE questions RENAME TO polls;

ALTER TABLE polls RENAME COLUMN poll_id TO multipoll_id;
ALTER TABLE polls RENAME COLUMN question_index TO sub_poll_index;
ALTER TABLE polls RENAME COLUMN question_type TO poll_type;

ALTER INDEX questions_pkey RENAME TO polls_pkey;
ALTER INDEX idx_questions_poll_id RENAME TO idx_polls_multipoll_id;
ALTER INDEX idx_questions_options RENAME TO idx_polls_options;
ALTER INDEX idx_questions_question_type RENAME TO idx_polls_poll_type;

ALTER TRIGGER update_questions_updated_at ON polls RENAME TO update_polls_updated_at;

ALTER TABLE votes RENAME COLUMN question_id TO poll_id;
ALTER INDEX votes_question_id_idx RENAME TO votes_poll_id_idx;

ALTER TABLE ranked_choice_rounds RENAME COLUMN question_id TO poll_id;
ALTER INDEX idx_ranked_choice_rounds_question_round RENAME TO idx_ranked_choice_rounds_poll_round;
ALTER INDEX ranked_choice_rounds_question_id_round_number_option_name_key
  RENAME TO ranked_choice_rounds_poll_id_round_number_option_name_key;

DROP POLICY IF EXISTS "Allow public read access on questions" ON polls;
DROP POLICY IF EXISTS "Allow public insert access on questions" ON polls;
DROP POLICY IF EXISTS "Allow public update access on questions" ON polls;

CREATE POLICY "Allow public read access on polls" ON polls
  FOR SELECT USING (true);
CREATE POLICY "Allow public insert access on polls" ON polls
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access on polls" ON polls
  FOR UPDATE USING (true) WITH CHECK (true);

COMMIT;
