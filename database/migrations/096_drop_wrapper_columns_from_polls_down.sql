-- Down migration for 096: restore wrapper-level columns on polls.
--
-- Best-effort. Re-creates the columns as NULLABLE; original values are NOT
-- recoverable. Backfills from the multipoll wrapper where possible so that
-- legacy code paths can still read these fields after rollback.

BEGIN;

ALTER TABLE polls
    ADD COLUMN IF NOT EXISTS short_id TEXT,
    ADD COLUMN IF NOT EXISTS creator_secret VARCHAR(64),
    ADD COLUMN IF NOT EXISTS creator_name TEXT,
    ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS close_reason TEXT,
    ADD COLUMN IF NOT EXISTS follow_up_to UUID,
    ADD COLUMN IF NOT EXISTS thread_title TEXT,
    ADD COLUMN IF NOT EXISTS suggestion_deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sequential_id INTEGER;

CREATE SEQUENCE IF NOT EXISTS polls_sequential_id_seq;

ALTER TABLE polls
    ALTER COLUMN sequential_id SET DEFAULT nextval('polls_sequential_id_seq'::regclass);

-- Backfill from multipolls so reads work after rollback.
UPDATE polls p
   SET short_id = mp.short_id,
       creator_secret = mp.creator_secret,
       creator_name = mp.creator_name,
       response_deadline = mp.response_deadline,
       is_closed = COALESCE(mp.is_closed, FALSE),
       close_reason = mp.close_reason,
       thread_title = mp.thread_title,
       suggestion_deadline = mp.prephase_deadline
  FROM multipolls mp
 WHERE p.multipoll_id = mp.id;

ALTER TABLE polls
    ADD CONSTRAINT polls_close_reason_check
    CHECK (close_reason IS NULL OR close_reason = ANY (ARRAY['manual'::text, 'deadline'::text, 'max_capacity'::text, 'uncontested'::text]));

CREATE INDEX IF NOT EXISTS idx_polls_creator_secret ON polls(creator_secret);
CREATE INDEX IF NOT EXISTS idx_polls_follow_up_to ON polls(follow_up_to);
CREATE INDEX IF NOT EXISTS idx_polls_response_deadline ON polls(response_deadline);
CREATE INDEX IF NOT EXISTS idx_polls_short_id ON polls(short_id);
CREATE INDEX IF NOT EXISTS polls_close_reason_idx ON polls(close_reason) WHERE close_reason IS NOT NULL;

ALTER TABLE polls
    ADD CONSTRAINT polls_follow_up_to_fkey
    FOREIGN KEY (follow_up_to) REFERENCES polls(id);

-- Re-create the short_id trigger (mirrors migration 021).
CREATE OR REPLACE FUNCTION generate_short_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.short_id IS NULL AND NEW.sequential_id IS NOT NULL THEN
        NEW.short_id := encode_base62(NEW.sequential_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_short_id
    BEFORE INSERT OR UPDATE ON polls
    FOR EACH ROW
    EXECUTE FUNCTION generate_short_id();

COMMIT;
