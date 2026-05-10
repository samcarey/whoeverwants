-- Rollback for 107_rename_threads_to_groups_up.sql
-- Reverse-renames groups → threads, group_members → thread_members, etc.

BEGIN;

ALTER POLICY "Allow public read access on group_members" ON group_members
  RENAME TO "Allow public read access on thread_members";
ALTER POLICY "Allow public insert access on group_members" ON group_members
  RENAME TO "Allow public insert access on thread_members";
ALTER POLICY "Allow public delete access on group_members" ON group_members
  RENAME TO "Allow public delete access on thread_members";

ALTER POLICY "Allow public read access on groups" ON groups
  RENAME TO "Allow public read access on threads";
ALTER POLICY "Allow public insert access on groups" ON groups
  RENAME TO "Allow public insert access on threads";
ALTER POLICY "Allow public update access on groups" ON groups
  RENAME TO "Allow public update access on threads";

DROP TRIGGER IF EXISTS trigger_generate_group_short_id ON groups;
DROP FUNCTION IF EXISTS generate_group_short_id();

CREATE OR REPLACE FUNCTION generate_thread_short_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.short_id IS NULL AND NEW.sequential_id IS NOT NULL THEN
    NEW.short_id := '~' || encode_base62(NEW.sequential_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_thread_short_id
  BEFORE INSERT OR UPDATE ON groups
  FOR EACH ROW
  EXECUTE FUNCTION generate_thread_short_id();

ALTER TABLE group_members RENAME CONSTRAINT group_members_group_id_fkey TO thread_members_thread_id_fkey;
ALTER TABLE polls RENAME CONSTRAINT polls_group_id_fkey TO polls_thread_id_fkey;

ALTER SEQUENCE groups_sequential_id_seq RENAME TO threads_sequential_id_seq;

ALTER INDEX group_members_pkey RENAME TO thread_members_pkey;
ALTER INDEX groups_sequential_id_key RENAME TO threads_sequential_id_key;
ALTER INDEX groups_short_id_key RENAME TO threads_short_id_key;
ALTER INDEX groups_pkey RENAME TO threads_pkey;

ALTER INDEX idx_group_members_browser_id RENAME TO idx_thread_members_browser_id;
ALTER INDEX idx_polls_group_id RENAME TO idx_polls_thread_id;
ALTER INDEX idx_groups_short_id RENAME TO idx_threads_short_id;

ALTER TABLE group_members RENAME COLUMN group_id TO thread_id;
ALTER TABLE polls RENAME COLUMN group_id TO thread_id;

ALTER TABLE group_members RENAME TO thread_members;
ALTER TABLE groups RENAME TO threads;

COMMIT;
