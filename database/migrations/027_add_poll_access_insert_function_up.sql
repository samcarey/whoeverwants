-- Create a secure function to insert poll access records
-- This bypasses RLS by using SECURITY DEFINER

CREATE OR REPLACE FUNCTION insert_poll_access(
    p_poll_id UUID,
    p_client_fingerprint TEXT,
    p_access_type TEXT
) RETURNS VOID AS $$
BEGIN
    -- Validate input parameters
    IF p_poll_id IS NULL OR p_client_fingerprint IS NULL OR p_access_type IS NULL THEN
        RAISE EXCEPTION 'All parameters are required';
    END IF;
    
    -- Validate access_type
    IF p_access_type NOT IN ('creator', 'viewer') THEN
        RAISE EXCEPTION 'Invalid access_type. Must be creator or viewer';
    END IF;
    
    -- Validate client_fingerprint format (20-40 alphanumeric chars)
    IF NOT is_valid_client_fingerprint(p_client_fingerprint) THEN
        RAISE EXCEPTION 'Invalid client fingerprint format';
    END IF;
    
    -- Insert or update the access record
    -- This function runs with SECURITY DEFINER, so it bypasses RLS
    INSERT INTO poll_access (
        poll_id,
        client_fingerprint,
        access_type,
        first_accessed_at,
        last_accessed_at
    ) VALUES (
        p_poll_id,
        p_client_fingerprint,
        p_access_type,
        NOW(),
        NOW()
    )
    ON CONFLICT (poll_id, client_fingerprint)
    DO UPDATE SET
        last_accessed_at = NOW(),
        access_type = CASE 
            -- Upgrade viewer to creator if needed
            WHEN EXCLUDED.access_type = 'creator' THEN 'creator'
            ELSE poll_access.access_type
        END;
        
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to check if user has access to a poll
CREATE OR REPLACE FUNCTION has_poll_access(
    p_poll_id UUID,
    p_client_fingerprint TEXT
) RETURNS BOOLEAN AS $$
BEGIN
    -- Check if access record exists
    RETURN EXISTS (
        SELECT 1 FROM poll_access
        WHERE poll_id = p_poll_id
        AND client_fingerprint = p_client_fingerprint
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments
COMMENT ON FUNCTION insert_poll_access(UUID, TEXT, TEXT) IS 'Securely insert poll access record bypassing RLS';
COMMENT ON FUNCTION has_poll_access(UUID, TEXT) IS 'Check if user has access to a specific poll';