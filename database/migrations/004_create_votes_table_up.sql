-- Create votes table
CREATE TABLE votes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    vote_type TEXT NOT NULL CHECK (vote_type IN ('yes_no', 'ranked_choice')),
    yes_no_choice TEXT CHECK (yes_no_choice IN ('yes', 'no')),
    ranked_choices TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Constraints to ensure proper vote structure
    CONSTRAINT vote_yes_no_valid CHECK (
        (vote_type = 'yes_no' AND yes_no_choice IS NOT NULL AND ranked_choices IS NULL) OR
        (vote_type = 'ranked_choice' AND yes_no_choice IS NULL AND ranked_choices IS NOT NULL)
    )
);

-- Create index for efficient poll vote lookups
CREATE INDEX votes_poll_id_idx ON votes(poll_id);
CREATE INDEX votes_created_at_idx ON votes(created_at);

-- Enable Row Level Security
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert votes (anonymous voting)
CREATE POLICY "Allow public insert on votes" ON votes 
FOR INSERT TO public 
WITH CHECK (true);

-- Allow anyone to read votes (for results)
CREATE POLICY "Allow public read on votes" ON votes 
FOR SELECT TO public 
USING (true);