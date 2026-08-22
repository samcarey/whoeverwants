BEGIN;

-- Best-effort: collapsing back to one event per (day, activity) requires the
-- duplicates be removed first; keep the fullest party per key.
DELETE FROM slot_events e
 WHERE EXISTS (
        SELECT 1 FROM slot_events e2
         WHERE e2.day = e.day AND LOWER(e2.activity) = LOWER(e.activity)
           AND e2.id <> e.id
           AND (
                (SELECT COUNT(*) FROM slot_event_confirmations c WHERE c.event_id = e2.id)
                > (SELECT COUNT(*) FROM slot_event_confirmations c WHERE c.event_id = e.id)
                OR (
                    (SELECT COUNT(*) FROM slot_event_confirmations c WHERE c.event_id = e2.id)
                    = (SELECT COUNT(*) FROM slot_event_confirmations c WHERE c.event_id = e.id)
                    AND e2.id < e.id
                )
           )
       );

DROP INDEX IF EXISTS slot_events_day_activity_idx;
CREATE UNIQUE INDEX IF NOT EXISTS slot_events_day_activity_key
    ON slot_events (day, LOWER(activity));

COMMIT;
