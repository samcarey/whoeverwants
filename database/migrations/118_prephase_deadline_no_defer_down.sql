-- Irreversible data backfill: the original "deferred, not yet armed" state
-- (prephase_deadline NULL while prephase_deadline_minutes is set) cannot be
-- distinguished after the fact from a deadline that was legitimately armed.
-- No-op down.

BEGIN;

COMMIT;
