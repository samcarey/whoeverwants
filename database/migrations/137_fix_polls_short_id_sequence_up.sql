-- Fix the polls short_id sequence lag introduced by migration 093.
-- Migration: 137_fix_polls_short_id_sequence
--
-- Migration 093 backfilled a `multipolls` (now `polls`) wrapper per legacy
-- poll, copying each source poll's `short_id` onto the wrapper VERBATIM while
-- letting the wrapper's own `sequential_id` come fresh from
-- `polls_sequential_id_seq` (1, 2, 3, ...). So a backfilled wrapper's
-- short_id encodes the SOURCE poll's sequential_id (which can be large), but
-- its own sequential_id is small. The sequence therefore lags the short_id
-- keyspace: as new polls advance the sequence, `generate_poll_short_id`
-- (short_id = encode_base62(sequential_id)) eventually produces a value that
-- already exists on a backfilled wrapper and the INSERT fails on
-- `polls_short_id_key`.
--
-- Fix: advance the sequence past the highest base62-decoded short_id so every
-- future `nextval` lands in unused short_id space. Idempotent — on a DB where
-- the sequence already leads the short_id space (every fresh dev DB, where
-- 093's safety-net backfill assigned sequential_id and short_id in lockstep)
-- this is a no-op.
--
-- `decode_base62` is defined in migration 021. Poll short_ids are pure base62
-- (group short_ids are `~`-prefixed and live on a different table), but the
-- regex guard keeps decode_base62 from raising on any stray non-base62 char.

DO $$
DECLARE
  max_decoded BIGINT;
  seq_last BIGINT;
BEGIN
  SELECT COALESCE(MAX(decode_base62(short_id)), 0)
    INTO max_decoded
    FROM polls
    WHERE short_id IS NOT NULL
      AND short_id ~ '^[0-9A-Za-z]+$';

  SELECT last_value INTO seq_last FROM polls_sequential_id_seq;

  IF max_decoded > seq_last THEN
    PERFORM setval('polls_sequential_id_seq', max_decoded, true);
  END IF;
END $$;
