-- Slot events become PARTIES: several gatherings of the SAME (day, activity)
-- may coexist. When a party fills up (someone's who-with maximum, an
-- exclusion), the people left out can start another one — the proposal
-- engine's "fresh event" card is the same rule that proposed the very first
-- gathering, re-applied to whoever is not yet attached. So the event row
-- stops being unique per (day, activity); each row is one party's anchor.
--
-- Each user holds at most ONE confirmation per (day, activity) — confirming a
-- different party moves them (enforced in services/slot_events.py, not by a
-- constraint: the key is LOWER(activity)-derived, awkward as a table-level
-- uniqueness target across rows of another table).

BEGIN;

DROP INDEX IF EXISTS slot_events_day_activity_key;
CREATE INDEX IF NOT EXISTS slot_events_day_activity_idx
    ON slot_events (day, LOWER(activity));

COMMIT;
