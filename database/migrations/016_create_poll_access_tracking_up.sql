-- Migration: Create poll access tracking table for secure access control
-- This table tracks which users (by browser fingerprint) have access to which polls

CREATE TABLE poll_access (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    client_fingerprint TEXT NOT NULL,
    access_type TEXT NOT NULL CHECK (access_type IN ('creator', 'viewer')),
    first_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one record per client per poll
    UNIQUE(poll_id, client_fingerprint)
);

-- Indexes for efficient lookups
CREATE INDEX idx_poll_access_lookup ON poll_access (client_fingerprint, poll_id);
CREATE INDEX idx_poll_access_poll_id ON poll_access (poll_id);
CREATE INDEX idx_poll_access_fingerprint ON poll_access (client_fingerprint);
CREATE INDEX idx_poll_access_type ON poll_access (access_type);
CREATE INDEX idx_poll_access_last_accessed ON poll_access (last_accessed_at);

-- Create function for safe config setting (prevents injection)
CREATE OR REPLACE FUNCTION safe_set_config(
    setting_name TEXT,
    new_value TEXT,
    is_local BOOLEAN DEFAULT false
) RETURNS TEXT AS $$
BEGIN
    -- Validate setting name to prevent injection
    IF setting_name !~ '^app\.[a-zA-Z_]+$' THEN
        RAISE EXCEPTION 'Invalid setting name: %', setting_name;
    END IF;
    
    PERFORM set_config(setting_name, new_value, is_local);
    RETURN new_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS on poll_access table
ALTER TABLE poll_access ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own access records
CREATE POLICY "poll_access_select" ON poll_access 
FOR SELECT USING (
    client_fingerprint = current_setting('app.current_client_fingerprint', true)
);

-- Policy: Users can only insert their own access records
CREATE POLICY "poll_access_insert" ON poll_access 
FOR INSERT WITH CHECK (
    client_fingerprint = current_setting('app.current_client_fingerprint', true)
);

-- Policy: Users can update their own access records (last_accessed_at)
CREATE POLICY "poll_access_update" ON poll_access 
FOR UPDATE USING (
    client_fingerprint = current_setting('app.current_client_fingerprint', true)
) WITH CHECK (
    client_fingerprint = current_setting('app.current_client_fingerprint', true)
);

-- Note: current_setting is a built-in PostgreSQL function, no need to override

-- Add comment explaining the security model
COMMENT ON TABLE poll_access IS 'Tracks poll access by client browser fingerprint. Used for RLS policies to control poll visibility.';
COMMENT ON COLUMN poll_access.client_fingerprint IS 'Browser fingerprint - unique per browser session';
COMMENT ON COLUMN poll_access.access_type IS 'Type of access: creator (created poll) or viewer (viewed poll)';
COMMENT ON FUNCTION safe_set_config(TEXT, TEXT, BOOLEAN) IS 'Safe config setting function that prevents SQL injection';

-- Create cleanup function for old access records
CREATE OR REPLACE FUNCTION cleanup_old_poll_access() RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete access records older than 90 days
    DELETE FROM poll_access 
    WHERE last_accessed_at < NOW() - INTERVAL '90 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_poll_access() IS 'Cleanup function to remove poll access records older than 90 days';

-- Note: RLS policies for polls table will be created in a separate migration
-- to avoid breaking existing functionality during staged deployment