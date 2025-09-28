-- EMERGENCY: Fix RLS policies that are not working

-- First, ensure RLS is enabled on both tables
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_access ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "polls_secure_select" ON polls;
DROP POLICY IF EXISTS "polls_restricted_select" ON polls;
DROP POLICY IF EXISTS "polls_initial_access" ON polls;
DROP POLICY IF EXISTS "polls_insert" ON polls;
DROP POLICY IF EXISTS "polls_update" ON polls;
DROP POLICY IF EXISTS "polls_delete" ON polls;

-- Drop poll_access policies
DROP POLICY IF EXISTS "poll_access_select" ON poll_access;
DROP POLICY IF EXISTS "poll_access_insert" ON poll_access;
DROP POLICY IF EXISTS "poll_access_update" ON poll_access;

-- Create VERY RESTRICTIVE policies for polls table
-- NO ACCESS unless user has explicit access record
CREATE POLICY "polls_emergency_select" ON polls FOR SELECT USING (
    -- Only allow if user has access record in poll_access table
    EXISTS (
        SELECT 1 FROM poll_access 
        WHERE poll_access.poll_id = polls.id 
        AND poll_access.client_fingerprint = current_setting('app.current_client_fingerprint', true)
    )
);

-- Allow poll creation (needed for new polls)
CREATE POLICY "polls_emergency_insert" ON polls FOR INSERT WITH CHECK (true);

-- Only creators can update/delete
CREATE POLICY "polls_emergency_update" ON polls FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM poll_access 
        WHERE poll_access.poll_id = polls.id 
        AND poll_access.client_fingerprint = current_setting('app.current_client_fingerprint', true)
        AND poll_access.access_type = 'creator'
    )
);

CREATE POLICY "polls_emergency_delete" ON polls FOR DELETE USING (
    EXISTS (
        SELECT 1 FROM poll_access 
        WHERE poll_access.poll_id = polls.id 
        AND poll_access.client_fingerprint = current_setting('app.current_client_fingerprint', true)
        AND poll_access.access_type = 'creator'
    )
);

-- Restrictive policies for poll_access table
CREATE POLICY "poll_access_emergency_select" ON poll_access FOR SELECT USING (
    client_fingerprint = current_setting('app.current_client_fingerprint', true)
);

CREATE POLICY "poll_access_emergency_insert" ON poll_access FOR INSERT WITH CHECK (
    client_fingerprint = current_setting('app.current_client_fingerprint', true)
);

CREATE POLICY "poll_access_emergency_update" ON poll_access FOR UPDATE USING (
    client_fingerprint = current_setting('app.current_client_fingerprint', true)
) WITH CHECK (
    client_fingerprint = current_setting('app.current_client_fingerprint', true)
);

-- Add comments
COMMENT ON POLICY "polls_emergency_select" ON polls IS 'EMERGENCY FIX: Only allow access with poll_access record';
COMMENT ON POLICY "poll_access_emergency_select" ON poll_access IS 'EMERGENCY FIX: Only own access records';

-- Test the policies by checking current user
SELECT 'RLS policies applied for user: ' || current_user AS status;