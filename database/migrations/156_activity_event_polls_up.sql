-- Polls as an optional add-on to Playlist activities.
--
-- A slot activity can carry a POLL DRAFT — a small, server-replayable
-- question spec ({title, question}) the owner attached in the activity
-- editor's Poll card. When the events engine finds a viable gathering for
-- that (day, activity) key, the server creates a REAL poll from the draft
-- (via the same insert helpers the create endpoint uses) and records the
-- link here, one poll per key, so every candidate's event card/page can
-- surface it. The poll itself lives in a fresh public group whose members
-- are the key's candidates.

BEGIN;

-- The attached draft: {"title": str, "question": {question_type, category,
-- category_icon, options, context, winner_method, is_auto_title}} — sanitized
-- on write by services/slots._clean_poll_draft (bounded strings, yes_no or
-- fixed-options ranked_choice only). NULL = no poll attached.
ALTER TABLE slot_activities ADD COLUMN IF NOT EXISTS poll_draft JSONB;

-- One started poll per (day, LOWER(activity)) key. ON DELETE CASCADE: if the
-- poll is ever deleted the key frees up and a draft can start a fresh one.
CREATE TABLE IF NOT EXISTS slot_event_polls (
    day DATE NOT NULL,
    activity TEXT NOT NULL,
    poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    -- Display title snapshot (the poll's own question title) so the events
    -- payload doesn't need a questions join on every read.
    title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS slot_event_polls_key_idx
    ON slot_event_polls (day, LOWER(activity));
CREATE INDEX IF NOT EXISTS slot_event_polls_poll_idx
    ON slot_event_polls (poll_id);

COMMIT;
