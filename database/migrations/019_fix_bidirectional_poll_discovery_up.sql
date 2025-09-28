-- Fix poll discovery to work bidirectionally
-- This replaces the existing function to find both ancestors and descendants

CREATE OR REPLACE FUNCTION get_all_related_poll_ids(input_poll_ids UUID[])
RETURNS TABLE(poll_id UUID) AS $$
WITH RECURSIVE poll_ancestors AS (
    -- Base case: Start with input poll IDs
    SELECT id as poll_id, follow_up_to, 0 as level
    FROM polls 
    WHERE id = ANY(input_poll_ids)
    
    UNION ALL
    
    -- Recursive case: Find ancestors (polls this one follows up to)
    SELECT p.id as poll_id, p.follow_up_to, pa.level - 1
    FROM polls p
    INNER JOIN poll_ancestors pa ON pa.follow_up_to = p.id
    WHERE pa.level > -10  -- Prevent infinite loops, max depth of 10 backwards
),
poll_descendants AS (
    -- Base case: All polls in the ancestor chain
    SELECT poll_id, 0 as level
    FROM poll_ancestors
    
    UNION ALL
    
    -- Recursive case: Find descendants (polls that follow up to any in the chain)
    SELECT p.id as poll_id, pd.level + 1
    FROM polls p
    INNER JOIN poll_descendants pd ON p.follow_up_to = pd.poll_id
    WHERE pd.level < 10  -- Prevent infinite loops, max depth of 10 forwards
)
SELECT DISTINCT poll_descendants.poll_id FROM poll_descendants;
$$ LANGUAGE SQL;

-- Update the comment for documentation
COMMENT ON FUNCTION get_all_related_poll_ids(UUID[]) IS 'Recursively finds all related polls (both ancestors and descendants) for given input poll IDs';