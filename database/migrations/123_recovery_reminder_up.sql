-- Account-recovery reminder flag.
--
-- Providing just a name now creates a real (recovery-less) account: a
-- `users` row + browser link + session, with no `user_identities` row. Such
-- an account can't be recovered if the device is lost, so the FE nudges the
-- user to add a sign-in method (email / Google / Apple / passkey) via a
-- home-page banner.
--
-- `recovery_reminder_dismissed` is the per-account "stop nagging me" flag the
-- banner's toggle sets. Default FALSE so name-only (and existing passkey-only)
-- accounts surface the banner until they add a recovery method OR dismiss it.
-- Accounts that already have an email/OAuth identity never see the banner
-- regardless of this flag (they have recovery), so the column is inert for
-- them.

BEGIN;

ALTER TABLE users ADD COLUMN recovery_reminder_dismissed BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
