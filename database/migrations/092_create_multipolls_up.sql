-- Create multipolls table (Phase 1 of multipoll redesign).
-- Migration: 092_create_multipolls
--
-- Phase 1 stands up the wrapper table + new columns on `polls`. No data is
-- migrated; existing polls keep multipoll_id IS NULL and continue to use the
-- legacy single-poll codepath. Phase 4 will backfill.
--
-- See docs/multipoll-phasing.md for the full plan.

-- ---------------------------------------------------------------------------
-- multipolls: wrapper-level fields
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS multipolls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sequential_id SERIAL UNIQUE,
  short_id TEXT UNIQUE,
  creator_secret TEXT NOT NULL,
  creator_name TEXT,
  response_deadline TIMESTAMPTZ,
  prephase_deadline TIMESTAMPTZ,
  prephase_deadline_minutes INT,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  close_reason TEXT,
  follow_up_to UUID REFERENCES multipolls(id) ON DELETE SET NULL,
  fork_of UUID REFERENCES multipolls(id) ON DELETE SET NULL,
  thread_title TEXT,
  context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at via the existing project-wide trigger function.
DROP TRIGGER IF EXISTS update_multipolls_updated_at ON multipolls;
CREATE TRIGGER update_multipolls_updated_at
  BEFORE UPDATE ON multipolls
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-generate base62 short_id from sequential_id, mirroring the polls table.
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

CREATE INDEX IF NOT EXISTS idx_multipolls_short_id ON multipolls(short_id);
CREATE INDEX IF NOT EXISTS idx_multipolls_follow_up_to ON multipolls(follow_up_to);
CREATE INDEX IF NOT EXISTS idx_multipolls_fork_of ON multipolls(fork_of);

-- Match the existing polls RLS posture: anonymous read + write, with mutation
-- gated at the application layer via creator_secret.
ALTER TABLE multipolls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on multipolls" ON multipolls;
CREATE POLICY "Allow public read access on multipolls" ON multipolls
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert access on multipolls" ON multipolls;
CREATE POLICY "Allow public insert access on multipolls" ON multipolls
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update access on multipolls" ON multipolls;
CREATE POLICY "Allow public update access on multipolls" ON multipolls
  FOR UPDATE USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- polls: link sub-polls to their wrapper
-- ---------------------------------------------------------------------------
--
-- Both columns are nullable in Phase 1: existing rows have no wrapper. Phase 4
-- will backfill non-participation polls and the columns can be tightened then.
ALTER TABLE polls ADD COLUMN IF NOT EXISTS multipoll_id UUID
  REFERENCES multipolls(id) ON DELETE CASCADE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS sub_poll_index INT;

CREATE INDEX IF NOT EXISTS idx_polls_multipoll_id ON polls(multipoll_id);
