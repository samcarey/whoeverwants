-- Check RLS status and policies
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('polls', 'poll_access');

-- Check policies on polls table
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies 
WHERE tablename = 'polls';

-- Check policies on poll_access table  
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies 
WHERE tablename = 'poll_access';

-- Test current_setting function
SELECT current_setting('app.current_client_fingerprint', true) as fingerprint;

-- Check if we have any data in poll_access
SELECT COUNT(*) as access_records FROM poll_access;