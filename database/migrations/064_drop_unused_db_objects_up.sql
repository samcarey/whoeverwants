-- Migration 064: Drop unused Supabase-specific DB objects
-- All business logic (results, algorithms, auto-close, RLS) is now in the Python API.
-- Only short_id generation and updated_at triggers are kept (still used by the app).

-- 1. Drop trigger that called auto_close (Python handles this now)
DROP TRIGGER IF EXISTS check_participation_capacity ON votes;

-- 2. Drop the poll_results view (results computed in Python)
DROP VIEW IF EXISTS poll_results;

-- 3. Drop unused functions (all logic ported to Python)
DROP FUNCTION IF EXISTS auto_close_participation_poll();
DROP FUNCTION IF EXISTS calculate_borda_count_winner(UUID);
DROP FUNCTION IF EXISTS calculate_participating_voters(UUID);
DROP FUNCTION IF EXISTS calculate_ranked_choice_winner(UUID);
DROP FUNCTION IF EXISTS calculate_valid_participation_votes(UUID);
DROP FUNCTION IF EXISTS cleanup_old_poll_access();
DROP FUNCTION IF EXISTS get_all_related_poll_ids(UUID[]);
DROP FUNCTION IF EXISTS has_poll_access(UUID, TEXT);
DROP FUNCTION IF EXISTS is_valid_client_fingerprint(TEXT);
DROP FUNCTION IF EXISTS log_suspicious_poll_access();

-- 4. Drop all RLS policies (Python API handles access control)
DROP POLICY IF EXISTS "Allow public insert access on polls" ON polls;
DROP POLICY IF EXISTS "Allow public read access on polls" ON polls;
DROP POLICY IF EXISTS "Allow public update access on polls" ON polls;
DROP POLICY IF EXISTS "Allow public read access to ranked choice rounds" ON ranked_choice_rounds;
DROP POLICY IF EXISTS "Allow public insert on votes" ON votes;
DROP POLICY IF EXISTS "Allow public read on votes" ON votes;
DROP POLICY IF EXISTS "Allow public update on votes" ON votes;
DROP POLICY IF EXISTS "Users can insert their own votes" ON votes;

-- 5. Disable RLS on tables (no longer needed)
ALTER TABLE votes DISABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_choice_rounds DISABLE ROW LEVEL SECURITY;
