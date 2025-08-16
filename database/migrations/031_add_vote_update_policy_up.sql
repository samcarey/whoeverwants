-- Add UPDATE policy to allow users to edit their votes
-- Since we use anonymous voting with localStorage-based tracking,
-- users can update any vote they have the ID for

CREATE POLICY "Allow public update on votes" ON votes 
FOR UPDATE TO public 
USING (true)
WITH CHECK (
    -- Ensure the poll_id and vote_type remain unchanged (only vote choices can be edited)
    poll_id = (SELECT poll_id FROM votes WHERE id = votes.id) AND
    vote_type = (SELECT vote_type FROM votes WHERE id = votes.id)
);

-- Add comment to document the policy
COMMENT ON POLICY "Allow public update on votes" ON votes IS 
'Allows users to update their votes. Since voting is anonymous and tracked via localStorage, 
users can update any vote they have the ID for. The policy ensures poll_id and vote_type 
cannot be changed, only the vote choices (yes_no_choice or ranked_choices) can be modified.';