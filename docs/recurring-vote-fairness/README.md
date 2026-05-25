# Recurring-Vote Fairness — Design Exploration

**Status:** exploration / research log. Nothing here is implemented in the app yet.
This documents a scheme (and the variants considered, with simulation evidence) for
letting chronically-outvoted minorities occasionally get their way in *recurring*
group decisions. A future session can develop or critique this.

**Reproduce the numbers:** `python3 sim_scenarios.py` and `python3 sim_robustness.py`
(plain Python 3, no deps). Both scripts live in this directory and are the source of
every table below.

---

## 1. The problem

Recurring low-stakes group picks — the canonical case is *"4 friends vote on a lunch
or movie every week."* Three friends keep voting the same way; the fourth is
perpetually outvoted and never gets their pick. We want the minority to win
**occasionally and deterministically** (not by coin flip), with a roughly
proportional cadence (majority wins a few times, then the minority once, repeat).

**Scope / values (decided during the exploration):**
- This is for **low-stakes, variety-desirable decisions** (entertainment, food),
  **not** important decisions that should be optimized for the best outcome. For
  important decisions you *want* the majority/compromise to win; here variety is a
  feature.
- **Goals:** (1) don't waste votes, (2) proportional / varied influence over time,
  (3) **no strategic burden** — honest ranking should be the only input, low
  cognitive load, (4) decent overall satisfaction subject to variety.
- **Non-goal:** maximizing single-round utility.

**Prior art** this resembles (for a future session to mine): *perpetual voting*
(Lackner 2020), *storable votes*, and proportional-representation-over-time. We
arrived at the scheme below from first principles but it sits in that family.

---

## 2. Recommended scheme — "clear-all banked IRV"

A normal ranked-choice (IRV) vote each round, with a per-voter, per-option **bank**
of points that carries across rounds and gives perennial losers growing weight.

**Mechanism:**
- **Bank:** `bank[(voter, option)]`, integer, starts at 0.
- **Ballot weight:** a ballot resting on option `o` counts as `w·bank[(v,o)] + 1`
  (the `+1` is this round's live vote). On an IRV transfer, the weight is
  **recomputed from the new option's bank**, *not* carried from the eliminated
  candidate. Use `w = 1`.
- **Accrual (flat):** at the end of each round, every option a voter ranked that
  did **not** win gains `+1` in that voter's bank.
- **Consumption (clear-all):** when an option wins, every voter in the winning
  **coalition** (ballots resting on the winner at the end) loses **all** their
  banked points for that winning option (reset to 0). Losers keep their banks.
- **Saving points** for a future round = simply *don't rank* the option (an unranked
  option can't draw your points) or abstain (risks none). No separate "spend / hold"
  decision — the system applies banks automatically, so there is **nothing to
  strategize**.
- **Memory bound (optional, hygiene only):** banks may be capped or decayed so they
  don't grow unbounded, but the cap must be **generous** (see §4) or it
  re-introduces starvation.

**Why this shape:**
- **No manufactured support.** Banks only amplify an option a voter *ranks this
  round*; an option nobody currently ranks scores 0 regardless of history. History
  can boost real current support, never invent it.
- **Eventual-win guarantee.** A perennial loser's bank grows every round until it
  overcomes the majority; clearing it on the win resets the cycle. This yields a
  stable, ~proportional cadence (see Scenario A: `AAAC AAAC …`).
- **Automatic ⇒ no strategy.** The voter never decides when to "cash in"; the system
  spends optimally for them. This was the decisive reason we abandoned the
  manual-boost / storable-votes direction (see §3).
- **Variety auto-scales to genuine disagreement** (see §4, EXP4): when people mostly
  agree it forces little variety; when tastes truly differ it spreads wins widely.
  It surfaces the diversity that majoritarian IRV suppresses rather than randomizing.

---

## 3. Variants considered (and why rejected / kept)

| Idea | Verdict | Reason |
|---|---|---|
| **clear-minimal** consumption (spend only the *pivotal* points to win, refund the rest) | **Rejected** | Unstable. Lets winners keep a reserve, so popular options trade cheaply and **starve a lone minority** (Scenario B: C wins **0%**), or a primed minority **over-wins** (Scenario A: 50%). |
| **clear-all** consumption | **Kept (recommended)** | Forces every winner back to zero, so slow accumulators reliably break through → proportional, stable, no starvation. |
| Clear the **resting coalition** vs **everyone who ranked** the winner | Keep coalition | ~Identical in sim (within noise); coalition is simpler. |
| **Bank weight `w`** as a variety dial | Keep `w=1`, don't expose | It's a **switch, not a dial**: any `w>0` flips to high-variety/no-starvation, then saturates (EXP2). |
| **Cap / decay** on banks | Optional, hygiene only | Bounds memory without changing behavior *if generous*; **the cap is the real variety dial** but it's coupled to starvation (§4, EXP5). |
| **Accrual rule** (flat vs regret-/rank-weighted) | **Kept flat** (deliberately not changed) | Flat = no incentive to misrank. Position-based accrual (e.g. "bank options ranked above the winner") sharpens fairness but **re-introduces a bury-your-favorite incentive**. Left as an open question; not simulated in depth. |
| **Manual boosting / storable votes** (voter chooses when to spend banked points) | **Rejected** | Makes spending a human decision → strategic timing, a free-rider / volunteer's-dilemma among co-supporters, and cognitive load. Violates goal (3). Automating the spend dissolves all of it. |
| **Original idea: accumulate ranked ballots across cycles, cross off the winner** | **Rejected** | Cadence uncontrollable; crossing-off destroys information (old ballots exhaust); majority's transferred lower-prefs distort outcomes; rewards strategic burying; opaque. |

---

## 4. Key findings (simulation evidence)

Metrics: **variety** = normalized entropy of the win distribution (0 = one option
always wins, 1 = uniform); **shut-out** = fraction of voters whose top choice
*never* wins (starvation); **worst-drought** = longest run of rounds the
most-neglected voter waits for a #1 win; **tot_sat** = total Borda satisfaction;
**gini** = inequality of per-voter satisfaction.

### 4.1 Three hand-built scenarios (`sim_scenarios.py`)

**Scenario A — 3 love A, 1 loves C (shared 2nd choice B):**

| variant | win shares | total sat | worst-off voter | cadence |
|---|---|---|---|---|
| plain IRV | A 100% | 3.00 | 0.00 | `AAAA…` |
| **clear-all** | **A 75% / C 25%** | 2.50 | 0.25 | `AAAC` (clean, proportional) |
| clear-minimal | A 50% / C 50% | 2.01 | 0.50 | `→ ACAC` (over-shoots) |

**Scenario B — two blocs (2×A, 2×B) + lone C:**

| variant | win shares | total sat | worst-off |
|---|---|---|---|
| plain IRV | A 100% | 3.50 | 0.50 |
| **clear-all** | A 43% / B 43% / **C 14%** | 2.94 | 0.35 |
| clear-minimal | A 50% / B 50% / **C 0%** | 3.25 | 0.25 |

**Scenario C — dominant 3×P bloc + lonely Q, R, S:**

| variant | win shares | total sat | worst-off |
|---|---|---|---|
| plain IRV | P 100% | 3.67 | 0.00 |
| **clear-all** | P 40 / Q 20 / R 20 / S 20 | 3.13 | 0.40 |
| clear-minimal | P 50 / Q 10 / R 20 / S 20 | 3.14 | 0.36 |

Takeaways: clear-all un-starves the minority everywhere; clear-minimal is erratic
(B starves the lone C entirely). Both initial worries ("clear-all over-equalizes" /
"clear-minimal starves") turned out to attach to the *opposite* variant from
intuition — clear-minimal is the dangerous one.

### 4.2 Robustness battery (`sim_robustness.py`, ensembles of random profiles)

- **EXP1 — variant comparison (8 voters, 5 options, random ballots):** baseline
  starves **44%** of voters; all clear-all variants → **0%** shut-out, variety
  0.25 → ~0.85, gini 0.22 → 0.07, at a ~12% total-satisfaction cost. coalition /
  rankers / +cap=8 / +decay=0.9 are all within noise.
- **EXP2 — `w` saturates:** w=0.5 already gives variety 0.83 & 0% shut-out; w=1/2/4
  are indistinguishable. `w` is a switch, not a dial.
- **EXP3 — scale (4→50 voters × 3→8 options):** **shut-out = 0% in every cell.**
  Variety rises with more voters (0.56 → 0.99). Worst-drought stays bounded
  (3–16 rounds) even at N=20, M=8.
- **EXP4 — ballot styles (N=10, M=6):** clear-all drives shut-out 30–53% → **0%**
  across random, Mallows (popular-favorite), high-noise, and partial top-3 ballots.
  **Variety auto-scales to real disagreement:** Mallows low-noise (everyone mostly
  agrees) → clear-all adds only 0.38 variety and largely respects the consensus;
  random tastes → 0.86.
- **EXP5 — cap sweep = the actual variety dial, but coupled to starvation:**

  | cap | variety | shut-out | worst drought |
  |---|---|---|---|
  | 1 | 0.59 | 17% | 319 |
  | 3 | 0.76 | 7% | 175 |
  | 5 | 0.83 | 1% | 48 |
  | 10 | 0.85 | 0% | 8 |
  | none | 0.86 | 0% | 8 |

  **Structural fact:** guaranteeing everyone *eventually* wins requires banks that
  can grow large enough to overcome any majority. Cap the memory too tightly and a
  lopsided minority is permanently locked out again. If you cap, set it generously
  (≈ several × group size).

---

## 5. Recommended configuration

> **clear-all + coalition-clear + `w = 1` + uncapped** (or a generous cap ≈ 5–10× the
> typical group size, purely so banks don't grow without bound — it won't change
> behavior). One mechanism, essentially zero tunable parameters, no starvation, and
> variety that tracks genuine disagreement.

If a particular group/decision-type wants *less* variety (more majoritarian), the
**cap** is the single dial — but keep it ≥ ~group size or lopsided minorities start
getting starved again.

---

## 6. Important cautions

- **"How often someone gets their #1" ≠ satisfaction.** In Scenario B the lone
  minority's top-choice rate rose (0% → 14%) while their *actual* satisfaction
  **fell** (0.50 → 0.35), because rotation also inflicts their *worst* option (B,
  popular with others) on them, where plain IRV had given everyone a quiet
  compromise (A). This is acceptable — even desirable — for low-stakes, variety-first
  decisions, but it is exactly why this scheme should **not** be used for important
  decisions.
- **No-starvation requires large banks** (see EXP5). Bounded memory ⇒ possible
  permanent starvation for sufficiently lopsided splits.
- **Flat accrual is slightly odd but harmless:** you accrue "want" even for options
  you ranked *last*, and 46–88% of accrued points are never spent. It works and is
  gaming-safe; sharpening it is an open question (§7).

---

## 7. Open questions / next steps

For a future session to develop or critique:

1. **Preference drift.** Every simulation here used **fixed** preferences for the
   whole run. Real entertainment tastes drift. Add a drift model and re-check that
   droughts stay bounded (drift could help — a neglected option becomes popular — or
   hurt — a moving favorite never lets a bank mature).
2. **Strategic robustness.** We argued flat accrual + automatic spend leaves nothing
   to game, but never simulated an adversarial voter. Confirm no profitable
   misranking exists.
3. **Accrual rule.** Does regret-based accrual (only bank options ranked above the
   winner) meaningfully sharpen fairness, and is its re-introduced bury-your-favorite
   incentive actually exploitable in practice? (Kept flat for now by request.)
4. **Satisfaction-aware objective.** For *semi*-important decisions, should the rule
   avoid overriding a compromise that's already serving the minority well
   (the Scenario-B backfire)?
5. **Product integration.** This maps naturally onto the existing poll/group model
   as a *recurring poll* that carries per-voter/per-option banks across cycles. The
   app already has ranked-choice IRV; the additions are the bank store, the
   `w·bank+1` weighting, flat accrual, and clear-all on win. Note the IRV base makes
   a clean "pivotal amount" hard to define — another reason clear-all (which needs no
   pivotal computation) beats clear-minimal.
