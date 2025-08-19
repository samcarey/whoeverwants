-- Enable real-time replication for polls table
-- This allows Supabase to send real-time updates for poll changes

-- Enable real-time replication for the polls table
ALTER PUBLICATION supabase_realtime ADD TABLE polls;

-- Grant necessary permissions for real-time functionality
-- This ensures the realtime role can read poll changes
GRANT SELECT ON polls TO anon, authenticated;
GRANT SELECT ON polls TO supabase_realtime_replication_role;

-- Create a replica identity for better change tracking
-- This helps Supabase track which specific fields changed
ALTER TABLE polls REPLICA IDENTITY FULL;