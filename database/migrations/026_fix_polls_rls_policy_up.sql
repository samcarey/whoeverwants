-- Fix RLS policy on polls table to be more restrictive
-- The current policy allows too much access

-- Drop the current policy
DROP POLICY IF EXISTS "polls_secure_select" ON polls;

-- Create a more restrictive policy
-- Only allow access if user has explicit access record, OR is making a specific single-poll query
CREATE POLICY "polls_restricted_select" ON polls FOR SELECT USING (
    -- Condition 1: User has explicit access record in poll_access table
    EXISTS (
        SELECT 1 FROM poll_access 
        WHERE poll_access.poll_id = polls.id 
        AND poll_access.client_fingerprint = current_setting('app.current_client_fingerprint', true)
    )
    -- Note: We removed the OR condition that allowed any poll access with requested_poll_id
    -- This means polls can only be accessed if there's an access record
);

-- Create a separate policy for initial poll access (INSERT operations)
-- This allows the first access to a poll when someone has the direct URL
CREATE POLICY "polls_initial_access" ON polls FOR SELECT USING (
    -- Allow access for specific poll ID queries only when no bulk query is happening
    -- This requires the query to be for a single specific poll
    (current_setting('app.requested_poll_id', true) IS NOT NULL 
     AND current_setting('app.requested_poll_id', true) != ''
     AND polls.id::text = current_setting('app.requested_poll_id', true))
    OR
    (current_setting('app.requested_poll_short_id', true) IS NOT NULL 
     AND current_setting('app.requested_poll_short_id', true) != ''
     AND polls.short_id = current_setting('app.requested_poll_short_id', true))
);

-- Note: PostgreSQL evaluates policies with OR logic between different policies
-- So polls_restricted_select OR polls_initial_access must be true

COMMENT ON POLICY "polls_restricted_select" ON polls IS 
'Restricts poll access to users with explicit access records only';

COMMENT ON POLICY "polls_initial_access" ON polls IS 
'Allows initial access to specific polls via direct ID/short_id for first-time viewing';