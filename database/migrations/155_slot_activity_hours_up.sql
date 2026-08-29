-- Per-activity duration bounds (migration 155).
--
-- How long the owner wants the activity to run: min_hours / max_hours
-- (nullable = unconstrained, e.g. legacy rows or raw-API callers). The
-- events engine enforces both when composing gatherings:
--   * a set is only viable when max(members' minimums) <= min(members'
--     maximums) — someone wanting >=3h can't gather with someone capping
--     at 2h;
--   * an event can only START where the binding minimum still FITS the
--     shared window (start + max(min_hours) <= window end), so nothing is
--     proposed that would outlast someone's availability.
-- The preferred-start-times ballot filters its bubbles the same way.
ALTER TABLE slot_activities ADD COLUMN IF NOT EXISTS min_hours NUMERIC;
ALTER TABLE slot_activities ADD COLUMN IF NOT EXISTS max_hours NUMERIC;
