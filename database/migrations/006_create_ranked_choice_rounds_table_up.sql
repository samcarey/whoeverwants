-- Create table to store ranked choice elimination rounds
CREATE TABLE ranked_choice_rounds (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    round_number INT NOT NULL,
    option_name TEXT NOT NULL,
    vote_count INT NOT NULL,
    is_eliminated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(poll_id, round_number, option_name)
);

-- Create index for efficient querying
CREATE INDEX idx_ranked_choice_rounds_poll_round ON ranked_choice_rounds(poll_id, round_number);

-- Enable Row Level Security
ALTER TABLE ranked_choice_rounds ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access to results
CREATE POLICY "Allow public read access to ranked choice rounds" ON ranked_choice_rounds
    FOR SELECT USING (true);

-- Grant access to the table
GRANT SELECT ON ranked_choice_rounds TO public;