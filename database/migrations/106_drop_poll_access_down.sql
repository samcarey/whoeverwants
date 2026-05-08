-- Down migration for 106_drop_poll_access.
-- Recreates the table mirror-image of 102_create_membership_tables_up.sql.
-- Recreated rows are NOT backfilled — once 106 has been applied in prod
-- and the application code stops writing poll_access, there's no source
-- to restore from. Use as a rollback safety net only.

BEGIN;

CREATE TABLE IF NOT EXISTS poll_access (
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  browser_id UUID NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, browser_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_access_browser_id
  ON poll_access(browser_id);

ALTER TABLE poll_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on poll_access" ON poll_access;
CREATE POLICY "Allow public read access on poll_access" ON poll_access
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert access on poll_access" ON poll_access;
CREATE POLICY "Allow public insert access on poll_access" ON poll_access
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public delete access on poll_access" ON poll_access;
CREATE POLICY "Allow public delete access on poll_access" ON poll_access
  FOR DELETE USING (true);

COMMIT;
