-- Reverse migration 092.

DROP INDEX IF EXISTS idx_polls_multipoll_id;
ALTER TABLE polls DROP COLUMN IF EXISTS sub_poll_index;
ALTER TABLE polls DROP COLUMN IF EXISTS multipoll_id;

DROP TRIGGER IF EXISTS trigger_generate_multipoll_short_id ON multipolls;
DROP TRIGGER IF EXISTS update_multipolls_updated_at ON multipolls;
DROP FUNCTION IF EXISTS generate_multipoll_short_id();

DROP TABLE IF EXISTS multipolls;
