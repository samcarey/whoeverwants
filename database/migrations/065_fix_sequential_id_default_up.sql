-- Migration: 065_fix_sequential_id_default
-- Fix: sequential_id column has no default, so short_id is never generated on new polls.
-- Re-link the existing polls_sequential_id_seq sequence to the column.

ALTER TABLE polls
    ALTER COLUMN sequential_id SET DEFAULT nextval('polls_sequential_id_seq');

ALTER SEQUENCE polls_sequential_id_seq OWNED BY polls.sequential_id;

-- Backfill any polls missing sequential_id / short_id
DO $$
DECLARE
    r RECORD;
    next_seq INTEGER;
BEGIN
    FOR r IN
        SELECT id FROM polls
        WHERE sequential_id IS NULL
        ORDER BY created_at
    LOOP
        next_seq := nextval('polls_sequential_id_seq');
        UPDATE polls
           SET sequential_id = next_seq,
               short_id = encode_base62(next_seq)
         WHERE id = r.id;
    END LOOP;
END $$;
