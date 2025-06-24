-- Create a view that aggregates poll results without exposing individual votes
CREATE VIEW poll_results AS
SELECT 
    p.id as poll_id,
    p.title,
    p.poll_type,
    p.created_at,
    p.response_deadline,
    p.options,
    -- Yes/No poll aggregation
    CASE 
        WHEN p.poll_type = 'yes_no' THEN 
            COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END)
        ELSE NULL 
    END as yes_count,
    CASE 
        WHEN p.poll_type = 'yes_no' THEN 
            COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END)
        ELSE NULL 
    END as no_count,
    -- Total vote count for all poll types
    COUNT(v.id) as total_votes,
    -- Calculated percentages for yes/no polls
    CASE 
        WHEN p.poll_type = 'yes_no' AND COUNT(v.id) > 0 THEN 
            ROUND((COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END)::DECIMAL / COUNT(v.id)) * 100)
        ELSE NULL 
    END as yes_percentage,
    CASE 
        WHEN p.poll_type = 'yes_no' AND COUNT(v.id) > 0 THEN 
            ROUND((COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END)::DECIMAL / COUNT(v.id)) * 100)
        ELSE NULL 
    END as no_percentage,
    -- Winner determination for yes/no polls
    CASE 
        WHEN p.poll_type = 'yes_no' THEN
            CASE 
                WHEN COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END) > COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END) THEN 'yes'
                WHEN COUNT(CASE WHEN v.yes_no_choice = 'no' THEN 1 END) > COUNT(CASE WHEN v.yes_no_choice = 'yes' THEN 1 END) THEN 'no'
                ELSE 'tie'
            END
        ELSE NULL 
    END as winner
FROM polls p
LEFT JOIN votes v ON p.id = v.poll_id AND v.vote_type = p.poll_type
GROUP BY p.id, p.title, p.poll_type, p.created_at, p.response_deadline, p.options;

-- Grant access to the view
GRANT SELECT ON poll_results TO public;

-- Enable Row Level Security on the view
ALTER VIEW poll_results SET (security_invoker = true);

-- Create a policy to allow public access to poll results
-- (inherits from the polls table RLS policies since it's based on polls)