-- "Plus one/more" — one person submits a vote on behalf of additional people.
--
-- Poll-level toggle `polls.allow_plus_ones`: when on, voters can add extra
-- people (each with an optional name) that their single ballot counts for.
-- Default ON for polls containing a time question (the common "I'm bringing
-- my partner who isn't in the group" scheduling case), OFF otherwise — set at
-- create time by the server; the FE exposes a toggle to override.
--
-- Per-vote `votes.plus_one_names`: a JSON array with one entry per represented
-- person (name string; empty/"" = unnamed plus-one). The vote counts as
-- 1 + length(plus_one_names) voters everywhere (yes/no tallies, ranked-choice
-- IRV ballots, time availability/preferences). The array is poll-level — the
-- batch vote endpoint writes the same value onto every sibling question's row.

ALTER TABLE polls ADD COLUMN IF NOT EXISTS allow_plus_ones BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing polls with a time question default ON, matching the
-- create-time default for new polls.
UPDATE polls SET allow_plus_ones = true
WHERE id IN (
  SELECT DISTINCT poll_id FROM questions WHERE question_type = 'time'
);

ALTER TABLE votes ADD COLUMN IF NOT EXISTS plus_one_names JSONB;
