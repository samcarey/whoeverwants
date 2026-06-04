-- App-icon badge defaults to the to-do model.
--
-- Migration 121 introduced badge_todo_mode defaulting to FALSE (the unread /
-- "New"-since-last-view model). The owner wants the iOS app-icon badge to count
-- TO-DO polls instead (open, votable, not-yet-responded). This flips the column
-- default for new accounts AND migrates existing accounts to the to-do model so
-- the change is observable for current users (whose rows already hold FALSE).
--
-- The badge_on_voting_open / badge_on_results switches are unread-only and stay
-- as-is; they're inert while badge_todo_mode is ON. A user can switch back to
-- the unread model from Settings → "Stay unread until I respond".
--
-- NOTE: this UPDATE overwrites any account that had deliberately chosen the
-- unread model. The feature is recent and the behavior change is intentional;
-- such users can re-toggle. The down migration restores the FALSE default for
-- new rows but cannot recover per-account choices.

BEGIN;

ALTER TABLE users ALTER COLUMN badge_todo_mode SET DEFAULT TRUE;
UPDATE users SET badge_todo_mode = TRUE WHERE badge_todo_mode = FALSE;

COMMIT;
