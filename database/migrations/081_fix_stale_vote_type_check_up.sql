-- Drop stale vote_type_check constraint from migration 043 that doesn't include 'participation'.
-- Migration 051 added votes_vote_type_check (with participation) but didn't drop the old
-- vote_type_check, so both coexist and the old one rejects participation votes.
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_type_check;
