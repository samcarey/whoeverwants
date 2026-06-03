-- Per-user "remind me to vote" notification setting.
--
--   1. users.vote_reminder — RECIPIENT-side, account-synced preference. NOT a
--      per-poll / creator field. Controls when (relative to a poll's auto-close
--      deadline) this user gets a one-shot "you haven't voted yet" reminder
--      push for polls they can see but haven't acted on. Values:
--        'off'                  — never remind.
--        '0.5x' / '0.2x' / '0.1x' — fractional: fire when that fraction of the
--                                  poll's open window remains (0.2x = at 80%
--                                  elapsed). Default '0.2x'.
--        '1h' / '3h' / '1d'     — absolute lead time before the deadline.
--      Anonymous users have no row here; their preference lives in localStorage
--      and the column default applies to their server-side reminder selection.
--
--   2. vote_reminders_sent — per-(poll, browser) fire-once ledger. A row means
--      this browser already received the reminder for this poll, so the cron
--      tick won't re-send. Keyed on browser_id (per-device, matching the rest
--      of the push layer); CASCADE-deleted with the poll.

BEGIN;

ALTER TABLE users ADD COLUMN vote_reminder TEXT NOT NULL DEFAULT '0.2x';

CREATE TABLE vote_reminders_sent (
    poll_id    uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    browser_id uuid NOT NULL,
    sent_at    timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (poll_id, browser_id)
);

COMMIT;
