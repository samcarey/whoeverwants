-- Per-user preference ORDER over their confirmed events (migration 160).
-- When someone confirms several events that land in the same time slot, they
-- drag them into a fallback order: rank 1 = the one they mean to attend,
-- rank 2 = the backup if it falls through, etc. EQUAL ranks = the user
-- LINKED those events — they intend to attend both regardless of overlap.
-- NULL = no preference recorded (single event, or never ordered).
ALTER TABLE slot_event_confirmations ADD COLUMN IF NOT EXISTS pref_rank INTEGER;
