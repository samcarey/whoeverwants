-- Poll variant evolution (the /explore feed's "natural selection" tree).
--
-- A user-submitted explore poll is the TRUNK of a binary spine. On submit it
-- spawns 2 LLM-generated variants (one rendered ABOVE it, one BELOW). Each
-- spawned variant, once it accrues enough votes, spawns ONE further variant in
-- its own direction (an up-variant grows further up, a down-variant further
-- down) — so the spine grows away from the trunk in both directions.
--
-- Lineage columns (all NULL/0/false for ordinary, non-explore polls):
--   variant_parent_id  the poll this was spawned FROM (NULL = a trunk / manual
--                      poll). FK SET NULL — polls are effectively never deleted,
--                      but stay defensive.
--   variant_root_id    the trunk this spine belongs to (NULL on the trunk
--                      itself; the FE groups a spine by `variant_root_id ?? id`).
--   variant_direction  'up' | 'down' — which way this variant grows from the
--                      trunk. NULL on the trunk.
--   variant_generation depth from the trunk: 0 = trunk, 1 = first variant, ...
--                      (drives the explore card's indentation).
--   variant_spawned    has this poll already produced its child variant(s)?
--                      Idempotency guard for the (background-task) spawner — the
--                      trunk spawns its 2 children once, a variant its 1 child
--                      once.
--
-- Everything else (which polls evolve, the vote threshold, the LLM prompt) is
-- application logic in services/poll_variants.py + services/variant_llm.py.

BEGIN;

ALTER TABLE polls
  ADD COLUMN variant_parent_id UUID REFERENCES polls(id) ON DELETE SET NULL,
  ADD COLUMN variant_root_id UUID REFERENCES polls(id) ON DELETE SET NULL,
  ADD COLUMN variant_direction TEXT,
  ADD COLUMN variant_generation INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN variant_spawned BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE polls
  ADD CONSTRAINT polls_variant_direction_check
  CHECK (variant_direction IS NULL OR variant_direction IN ('up', 'down'));

-- Group a spine by its trunk for the explore feed read.
CREATE INDEX IF NOT EXISTS polls_variant_root_idx ON polls(variant_root_id);

COMMIT;
