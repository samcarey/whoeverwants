-- Retire `polls.creator_secret`.
--
-- Poll authorship is now identity-based: every poll records
-- `creator_user_id` (migration 122). For anonymous creators the server
-- auto-creates a lightweight `users` row at poll-create time and binds it
-- to the creating `browser_id` via `user_browsers` — so close/reopen/cutoff
-- authorize against the caller's resolved user_id (bearer session OR the
-- account linked to their browser_id), and the per-browser secret is no
-- longer needed.
--
-- DESTRUCTIVE: legacy polls that recorded only a `creator_secret` (and
-- never got a `creator_user_id`) become immutable — there's no creator
-- identity to authorize against. Accepted: the app is pre-production and
-- the secret could never be reliably re-homed onto an identity (the
-- creating browser_id was never stored on the poll, and group_members is
-- group-level, not poll-creator-level).

BEGIN;

ALTER TABLE polls DROP COLUMN IF EXISTS creator_secret;

COMMIT;
