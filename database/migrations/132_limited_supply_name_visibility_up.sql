-- Migration 131: per-question "reveal claimant names" toggle for
-- limited-supply questions.
--
-- When true (default — current behavior), the claim roster shows everyone's
-- names to all viewers. When false, only the poll creator sees names; other
-- viewers see an anonymized roster (positions/counts only). The viewer always
-- sees their OWN secured/waitlist status regardless.

ALTER TABLE questions
    ADD COLUMN IF NOT EXISTS reveal_claimant_names BOOLEAN NOT NULL DEFAULT true;
