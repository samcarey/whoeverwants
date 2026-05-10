-- Rename threads → groups across the entire schema.
--
-- The codebase's "thread" entity is being renamed to "group" everywhere
-- (API, FE, URLs, types). This migration renames the underlying schema
-- to match so we don't carry a permanent code↔DB naming mismatch.
--
-- Renames:
--   * threads               → groups
--   * thread_members        → group_members
--   * polls.thread_id       → polls.group_id
--   * thread_members.thread_id → group_members.group_id
--   * indexes, constraints, sequences, triggers, functions, policies
--
-- ALTER ... RENAME is metadata-only (no row rewrites) so this is fast and
-- safe to run on prod. Foreign key edges and indexes follow renames
-- automatically.

BEGIN;

-- 1. Rename tables (sequences and PK/UNIQUE indexes are auto-renamed by PG
--    based on the new table name; explicit renames below cover constraints
--    and ancillary indexes that PG won't auto-rename).
ALTER TABLE threads RENAME TO groups;
ALTER TABLE thread_members RENAME TO group_members;

-- 2. Rename columns.
ALTER TABLE polls RENAME COLUMN thread_id TO group_id;
ALTER TABLE group_members RENAME COLUMN thread_id TO group_id;

-- 3. Rename indexes. PG does NOT auto-rename the implicit PK/UNIQUE
--    indexes or the auto-named sequence when the table is renamed — they
--    keep their original names until renamed explicitly.
ALTER INDEX idx_threads_short_id RENAME TO idx_groups_short_id;
ALTER INDEX idx_polls_thread_id RENAME TO idx_polls_group_id;
ALTER INDEX idx_thread_members_browser_id RENAME TO idx_group_members_browser_id;

ALTER INDEX threads_pkey RENAME TO groups_pkey;
ALTER INDEX threads_short_id_key RENAME TO groups_short_id_key;
ALTER INDEX threads_sequential_id_key RENAME TO groups_sequential_id_key;
ALTER INDEX thread_members_pkey RENAME TO group_members_pkey;

ALTER SEQUENCE threads_sequential_id_seq RENAME TO groups_sequential_id_seq;

-- 4. Rename FK constraints that carry the old name.
ALTER TABLE polls RENAME CONSTRAINT polls_thread_id_fkey TO polls_group_id_fkey;
ALTER TABLE group_members RENAME CONSTRAINT thread_members_thread_id_fkey TO group_members_group_id_fkey;

-- 5. Replace the short_id minting function and trigger.
DROP TRIGGER IF EXISTS trigger_generate_thread_short_id ON groups;
DROP FUNCTION IF EXISTS generate_thread_short_id();

CREATE OR REPLACE FUNCTION generate_group_short_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.short_id IS NULL AND NEW.sequential_id IS NOT NULL THEN
    NEW.short_id := '~' || encode_base62(NEW.sequential_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_group_short_id
  BEFORE INSERT OR UPDATE ON groups
  FOR EACH ROW
  EXECUTE FUNCTION generate_group_short_id();

-- 6. Rename RLS policies.
ALTER POLICY "Allow public read access on threads" ON groups
  RENAME TO "Allow public read access on groups";
ALTER POLICY "Allow public insert access on threads" ON groups
  RENAME TO "Allow public insert access on groups";
ALTER POLICY "Allow public update access on threads" ON groups
  RENAME TO "Allow public update access on groups";

ALTER POLICY "Allow public read access on thread_members" ON group_members
  RENAME TO "Allow public read access on group_members";
ALTER POLICY "Allow public insert access on thread_members" ON group_members
  RENAME TO "Allow public insert access on group_members";
ALTER POLICY "Allow public delete access on thread_members" ON group_members
  RENAME TO "Allow public delete access on group_members";

COMMIT;
