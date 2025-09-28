-- Create recursive function to discover all related poll IDs
-- Given a list of poll IDs, returns all polls that are follow-ups (recursively)

CREATE OR REPLACE FUNCTION get_all_related_poll_ids(input_poll_ids UUID[])
RETURNS TABLE(poll_id UUID) AS $$
WITH RECURSIVE poll_tree AS (
    -- Base case: Start with input poll IDs
    SELECT id as poll_id, 0 as level
    FROM polls 
    WHERE id = ANY(input_poll_ids)
    
    UNION ALL
    
    -- Recursive case: Find follow-ups to current level
    SELECT p.id as poll_id, pt.level + 1
    FROM polls p
    INNER JOIN poll_tree pt ON p.follow_up_to = pt.poll_id
    WHERE pt.level < 10  -- Prevent infinite loops, max depth of 10
)
SELECT DISTINCT poll_tree.poll_id FROM poll_tree;
$$ LANGUAGE SQL;

-- Add comment for documentation
COMMENT ON FUNCTION get_all_related_poll_ids(UUID[]) IS 'Recursively finds all follow-up polls for given input poll IDs';