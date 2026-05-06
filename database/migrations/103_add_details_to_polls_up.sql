-- Add optional details (Notes) column to the polls wrapper table.
--
-- The Notes textarea on the poll create panel maps to polls.details. The
-- backend (server/routers/polls.py: _insert_poll, _row_to_poll) and the FE
-- (CreatePollRequest, PollResponse, lib/types.ts: Poll) already wire this
-- field through; this migration just adds the missing column so prod stops
-- failing with `column "details" of relation "polls" does not exist` on every
-- POST /api/polls.
--
-- Migration 068 added a `details` column to the OLD polls table (renamed to
-- `questions` by migration 097), so that column lives on questions today —
-- not on the wrapper. This is a fresh column on the wrapper.

ALTER TABLE polls ADD COLUMN IF NOT EXISTS details TEXT;
