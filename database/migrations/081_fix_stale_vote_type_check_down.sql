-- Re-add the old constraint (without participation) for rollback
ALTER TABLE votes ADD CONSTRAINT vote_type_check
  CHECK (vote_type IN ('yes_no', 'ranked_choice', 'nomination'));
