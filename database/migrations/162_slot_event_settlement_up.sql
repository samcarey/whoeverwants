-- Deferred SETTLEMENT of slot-event parties (migration 162).
--
-- Before this, tapping "I'm In" bound you to a specific PARTY at once, and a
-- late joiner was gated against the people already in it — so whoever tapped
-- first froze the constraint envelope. One early confirmer with a tight
-- maximum could squeeze everyone after them into fragments, purely by
-- arrival order, even when a better split of the same people existed.
--
-- Now a confirmation commits you to the ACTIVITY on that day, not to a
-- party. While a key is UNSETTLED every confirmation sits on one INTAKE row
-- (settled_at IS NULL); the engine partitions the confirmed set into parties
-- only when it's safe — the settlement deadline, or earlier once no
-- undecided candidate could change the split. Keys whose whole candidate
-- pool fits one party never defer (growth is monotone there, so there is
-- nothing to decide later) — that is today's instant behaviour, unchanged.
--
--   settled_at  NULL = the key's intake row (confirmations still pooled);
--               set  = a settled party (today's semantics apply).
--   settle_tz   the IANA zone the deadline is read in — a slot's day/times
--               are wall clock with no zone, so the first confirmer's browser
--               zone is the anchor (the poll_options.timezone precedent).
--
-- Every existing row predates deferral: mark it settled so nothing changes
-- for parties already in flight.

BEGIN;

ALTER TABLE slot_events ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE slot_events ADD COLUMN IF NOT EXISTS settle_tz TEXT;

UPDATE slot_events SET settled_at = created_at WHERE settled_at IS NULL;

COMMIT;
