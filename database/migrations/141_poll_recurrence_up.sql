-- Poll recurrence (server-side scheduling).
--
-- A recurring poll is an "anchor": the poll created with a `recurrence` rule.
-- Future instances are materialized by the cron tick (routers/internal.py) as
-- their open date arrives — each is a fresh copy of the anchor's questions in
-- the same group, linked back via `recurrence_anchor_id`.
--
-- Mutable series state lives on the anchor:
--   recurrence            JSONB  — {frequency, interval, weekdays, monthlyMode, end, start}
--                                  (the RecurrenceRule + start date). NULL = non-recurring.
--   recurrence_skip_dates JSONB  — array of 'YYYY-MM-DD' individually cancelled occurrences.
--   recurrence_until      DATE   — exclusive upper bound: occurrences with date >= this are
--                                  dropped (the "cancel this + remainder" cutoff). NULL = open-ended.
--   recurrence_last_run   DATE   — the latest occurrence date already materialized (starts at
--                                  the rule's start, since the anchor IS the first occurrence).
--   recurrence_anchor_id  UUID   — set on MATERIALIZED CHILD instances, pointing at the anchor.
--                                  NULL on anchors (they carry the rule themselves) and on
--                                  ordinary non-recurring polls.
ALTER TABLE polls
    ADD COLUMN recurrence JSONB,
    ADD COLUMN recurrence_skip_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN recurrence_until DATE,
    ADD COLUMN recurrence_last_run DATE,
    ADD COLUMN recurrence_anchor_id UUID REFERENCES polls(id) ON DELETE SET NULL;

-- Partial index so the scheduler's "find anchors with pending occurrences"
-- scan only touches recurring polls.
CREATE INDEX idx_polls_recurrence_anchor ON polls (id) WHERE recurrence IS NOT NULL;
