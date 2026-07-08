-- Event layer Phase 1 (docs/event-layer-plan.md): per-viewer attendance
-- override for a decided poll's event.
--
-- Commitment is PRESUMED IN (docs/purpose.md decision, 2026-07-08): a voter
-- whose ballot matches the decided time slot is on the attendee list with NO
-- row here. Rows are the exceptions:
--   * status 'out'  — "can't make it" (back-out from a presumed-in state)
--   * status 'in'   — late opt-in from someone the derivation didn't presume
--                     (e.g. a member who never voted)
--
-- Keyed on browser_id with the usual `user_browsers` account-union on reads,
-- recency-wins across a person's linked browsers — mirrors poll_follow_state
-- (migration 134) exactly.

CREATE TABLE IF NOT EXISTS event_attendance (
  poll_id    UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  browser_id UUID NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('in', 'out')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, browser_id)
);

-- Phase 2's day-of reminder fan-out resolves "which events has this browser
-- backed out of?" — a browser_id-leading lookup, not covered by the PK.
CREATE INDEX IF NOT EXISTS idx_event_attendance_browser
  ON event_attendance (browser_id);
