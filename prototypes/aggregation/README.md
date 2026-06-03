# Ranked-choice headline aggregation — Layer 2 comparison prototype

**Status: decision artifact, owner-in-the-loop. Production is NOT changed.**

This prototype exists to satisfy the CLAUDE.md Layer-2 TODO:

> reconsider the headline aggregation … Do NOT change the headline method
> silently … Prototype variants and have the owner compare on real scenarios
> before converging.

Layer 1 (the plain-language result gloss behind the grey ⓘ icon) already
shipped. This is Layer 2: *should the headline winner itself change?*

## What it does

Runs the **same ballots** through three aggregation methods and shows where
they diverge — reusing the real production IRV + Borda code
(`server/algorithms/ranked_choice.py`), so the numbers match what already rides
every result (`borda_scores`). Touches no DB, no network, no production winner.

```bash
# full report (console table + self-contained report.html)
cd server && uv run python ../prototypes/aggregation/compare.py

# regression tests (locks the divergence claims)
cd prototypes/aggregation && ../../server/.venv/bin/python -m pytest test_compare.py
```

## The two intents, in plain words

| Lens | Method | "What does the winner mean?" |
|---|---|---|
| **Favorite** (current) | Instant-Runoff (IRV) | the option with the strongest *core* support — most first-choice energy. Each round drops the fewest-#1s option. Fixes vote-splitting; but a broadly-liked compromise with few #1s is eliminated early. |
| **Consensus** | Borda / Condorcet | the option the most people are *okay with* / nobody hates. Rewards breadth across the whole ballot. |

## Finding (6 documented scenarios)

**4 of 6 agree** across all three methods — when there's a genuinely-liked
option, the method choice is irrelevant (consensus pick, vote-split/spoiler,
3-way tie, 10-cuisine).

**2 of 6 diverge** — and they're exactly the friend-group cases
`social_tests/testing_strategy.md` #7 flagged:

| Scenario | IRV (now) | Borda | Condorcet |
|---|---|---|---|
| Movie genre (polarized + a compromise everyone ranks #2) | **Romantic Comedy** | Dramedy | **Dramedy** (true Condorcet winner, beats both 4–3) |
| Dinner (two cliques + a safe middle) | **Sushi Bar** | Thai Place | **Thai Place** |

In both divergent cases **Borda and Condorcet agree with each other**, so
"consensus" is unambiguous — the real decision is only **favorite vs
consensus**, not Borda-vs-Condorcet.

## Forward options for the owner (no code written for any of these yet)

1. **Keep IRV; rely on the shipped Layer-1 gloss.** Lowest surprise; the ⓘ
   already explains "a broadly-acceptable option lost" when it happens.
2. **Per-poll create-time choice: "Pick the group favorite" vs "Pick what
   everyone's okay with"** (plain words, no algorithm names). Same ballots,
   creator picks the lens. The owner's own suggested framing.
3. **Change the default headline to a consensus method** (Borda or Condorcet).
   Highest surprise to existing users — "correct" voting method is genuinely
   contested.
4. **Show both** — keep IRV as the headline but surface a secondary
   "broadest-acceptance pick" line when it differs (an escalation of Layer 1).

Next step is the owner comparing `report.html` on these real scenarios and
choosing a direction before any production change lands.
