-- Attendance Leeway (exclusion tolerance) for time questions.
-- A slot is allowed through to the preference phase only if its effective
-- attendance is within `exclusion_tolerance` of the best-attended slot
-- (max_attendance - slot_attendance <= exclusion_tolerance). Default 0 means
-- only the best-attended slot(s) are considered; raising it lets a
-- slightly-less-attended-but-otherwise-preferable slot stay in the running.
ALTER TABLE questions
    ADD COLUMN exclusion_tolerance INTEGER NOT NULL DEFAULT 0;
