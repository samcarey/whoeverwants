-- Migration: Enable Row Level Security on polls table
-- This migration MUST be applied after poll_access table is created and populated

-- Enable RLS on polls table (this will block all queries until policies are created)
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;

-- Drop any existing permissive policies that allow unrestricted access
DROP POLICY IF EXISTS "polls_select_policy" ON polls;
DROP POLICY IF EXISTS "Enable read access for all users" ON polls;

-- CRITICAL SECURITY POLICY: Only allow poll access through specific conditions
CREATE POLICY "polls_secure_select" ON polls FOR SELECT USING (
    -- Condition 1: User has explicit access record in poll_access table
    EXISTS (
        SELECT 1 FROM poll_access 
        WHERE poll_access.poll_id = polls.id 
        AND poll_access.client_fingerprint = current_setting('app.current_client_fingerprint', true)
    )
    OR
    -- Condition 2: Direct access by specific ID (for initial poll viewing)
    -- This allows first-time access when user has the exact poll ID/short_id
    (
        polls.id::text = current_setting('app.requested_poll_id', true)
        OR 
        polls.short_id = current_setting('app.requested_poll_short_id', true)
    )
);

-- Policy for poll creation (INSERT) - allow anyone to create polls
-- The creator will be recorded in poll_access table immediately after creation
CREATE POLICY "polls_insert" ON polls FOR INSERT WITH CHECK (true);

-- Policy for poll updates - only allow updates by poll creators
CREATE POLICY "polls_update" ON polls FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM poll_access 
        WHERE poll_access.poll_id = polls.id 
        AND poll_access.client_fingerprint = current_setting('app.current_client_fingerprint', true)
        AND poll_access.access_type = 'creator'
    )
) WITH CHECK (
    EXISTS (
        SELECT 1 FROM poll_access 
        WHERE poll_access.poll_id = polls.id 
        AND poll_access.client_fingerprint = current_setting('app.current_client_fingerprint', true)
        AND poll_access.access_type = 'creator'
    )
);

-- Policy for poll deletion - only allow deletion by poll creators
CREATE POLICY "polls_delete" ON polls FOR DELETE USING (
    EXISTS (
        SELECT 1 FROM poll_access 
        WHERE poll_access.poll_id = polls.id 
        AND poll_access.client_fingerprint = current_setting('app.current_client_fingerprint', true)
        AND poll_access.access_type = 'creator'
    )
);

-- Add comments explaining the security model
COMMENT ON POLICY "polls_secure_select" ON polls IS 
'Secure access policy: allows poll access only if user has access record OR is accessing by specific ID';

COMMENT ON POLICY "polls_update" ON polls IS 
'Update policy: only poll creators can update polls';

COMMENT ON POLICY "polls_delete" ON polls IS 
'Delete policy: only poll creators can delete polls';

-- Create function to validate client fingerprint format
CREATE OR REPLACE FUNCTION is_valid_client_fingerprint(fingerprint TEXT) RETURNS BOOLEAN AS $$
BEGIN
    -- Fingerprint should be 20-40 character alphanumeric string
    RETURN fingerprint IS NOT NULL 
           AND length(fingerprint) BETWEEN 20 AND 40
           AND fingerprint ~ '^[a-zA-Z0-9]+$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create security function to log suspicious access attempts
CREATE OR REPLACE FUNCTION log_suspicious_poll_access() RETURNS TRIGGER AS $$
BEGIN
    -- Log if someone tries to access polls without proper fingerprint
    IF NOT is_valid_client_fingerprint(current_setting('app.current_client_fingerprint', true)) THEN
        RAISE LOG 'Suspicious poll access attempt without valid fingerprint from %', 
                  coalesce(current_setting('app.current_client_fingerprint', true), 'NULL');
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Note: We don't create the trigger yet to avoid breaking existing queries
-- The trigger can be enabled after all code is updated to use fingerprints

-- Create view for debugging poll access (only in development)
CREATE OR REPLACE VIEW poll_access_debug AS
SELECT 
    p.id as poll_id,
    p.title,
    p.short_id,
    pa.client_fingerprint,
    pa.access_type,
    pa.first_accessed_at,
    pa.last_accessed_at
FROM polls p
LEFT JOIN poll_access pa ON p.id = pa.poll_id
ORDER BY p.created_at DESC;

COMMENT ON VIEW poll_access_debug IS 'Debug view for poll access - shows all polls and their access records';

-- Add constraint to ensure poll_access references valid polls
ALTER TABLE poll_access ADD CONSTRAINT fk_poll_access_poll_id 
    FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE;

-- Final verification query (commented out - for manual testing)
/*
-- Test query that should work after migration:
-- SELECT set_config('app.current_client_fingerprint', 'test123456789', true);
-- SELECT * FROM polls LIMIT 1;
*/