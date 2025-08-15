-- Remove the complex RLS and fingerprinting system
-- Switch to simple browser-storage based access control

-- Drop all RLS policies
DROP POLICY IF EXISTS "polls_emergency_select" ON polls;
DROP POLICY IF EXISTS "polls_emergency_insert" ON polls;
DROP POLICY IF EXISTS "polls_emergency_update" ON polls;
DROP POLICY IF EXISTS "polls_emergency_delete" ON polls;

DROP POLICY IF EXISTS "poll_access_emergency_select" ON poll_access;
DROP POLICY IF EXISTS "poll_access_emergency_insert" ON poll_access;
DROP POLICY IF EXISTS "poll_access_emergency_update" ON poll_access;

-- Disable RLS on tables (makes them publicly accessible for queries)
ALTER TABLE polls DISABLE ROW LEVEL SECURITY;
ALTER TABLE poll_access DISABLE ROW LEVEL SECURITY;

-- Drop any dependent views first
DROP VIEW IF EXISTS poll_access_debug;

-- Drop the poll_access table entirely (no longer needed)
DROP TABLE IF EXISTS poll_access CASCADE;

-- Drop the RLS helper functions (no longer needed)
DROP FUNCTION IF EXISTS safe_set_config(text, text, boolean);
DROP FUNCTION IF EXISTS insert_poll_access(uuid, text, text);

-- Comment on the change
COMMENT ON TABLE polls IS 'Access control now handled by client-side browser storage, not RLS';

-- Verify the change
SELECT 'RLS system removed, polls table now publicly accessible' AS status;