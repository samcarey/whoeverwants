"""
Recurring-vote fairness — single-scenario simulation.

Explores a "banked-points modified IRV" for recurring low-stakes group decisions
(e.g. a weekly lunch/entertainment pick) where we want chronically-outvoted
minorities to occasionally get their way, deterministically (not by luck).

Mechanism under test:
  - Each voter has a per-option bank of points: bank[(voter, option)].
  - A ballot resting on option o counts as  w*bank[(v,o)] + 1  (the +1 is this
    round's live vote). On IRV transfer the weight is recomputed from the NEW
    option's bank, NOT carried from the previous candidate.
  - Accrual (FIXED, "flat"): at the end of each round every option a voter ranked
    that did NOT win gains +1 in that voter's bank.
  - Consumption variants compared here:
      baseline      : no banks at all (plain IRV every round)
      clear_all     : the winning coalition loses ALL their bank for the winner
      clear_minimal : the winning coalition loses only the minimal pivotal amount,
                      found by refunding points until the winner would flip

Conclusion from this file (see ../recurring-vote-fairness/README.md):
  clear_all is stable and ~proportional; clear_minimal is unstable — it either
  starves a lone minority (Scenario B: C wins 0%) or over-serves one (Scenario A:
  50%). We proceed with clear_all.

Run:  python3 sim_scenarios.py
"""


def weighted_irv(rankings, banks, options, w=1):
    eliminated = set()
    voters = list(rankings.keys())
    order = list(options)
    while True:
        active = [o for o in options if o not in eliminated]
        tally = {o: 0 for o in active}
        assignment = {}
        for v in voters:
            choice = None
            for o in rankings[v]:
                if o not in eliminated:
                    choice = o
                    break
            assignment[v] = choice
            if choice is not None:
                tally[choice] += w * banks.get((v, choice), 0) + 1
        total = sum(tally.values())
        if total == 0:
            return None, set(), assignment
        best = max(active, key=lambda o: (tally[o], -order.index(o)))
        if tally[best] * 2 > total or len(active) == 1:
            coalition = {v for v in voters if assignment[v] == best}
            return best, coalition, assignment
        worst = min(active, key=lambda o: (tally[o], -order.index(o)))
        eliminated.add(worst)


def minimal_spend(rankings, banks, options, winner, coalition):
    """Greedily refund the winner's coalition's bank one point at a time (in a
    fixed cycling order) while the winner still wins. What can't be refunded is
    the minimal pivotal spend."""
    work = dict(banks)
    members = sorted(coalition)
    while True:
        progress = False
        for v in members:
            if work.get((v, winner), 0) <= 0:
                continue
            work[(v, winner)] -= 1
            w2, _, _ = weighted_irv(rankings, work, options)
            if w2 == winner:
                progress = True
            else:
                work[(v, winner)] += 1
        if not progress:
            break
    return {v: banks.get((v, winner), 0) - work.get((v, winner), 0) for v in coalition}


def simulate(rankings, options, variant, rounds):
    banks = {}
    winners = []
    voters = list(rankings.keys())
    accrued = consumed = 0
    for _ in range(rounds):
        w, coal, _ = weighted_irv(rankings, banks, options)
        winners.append(w)
        if w is None or variant == "baseline":
            continue
        if variant == "clear_all":
            for v in coal:
                consumed += banks.get((v, w), 0)
                banks[(v, w)] = 0
        elif variant == "clear_minimal":
            for v, c in minimal_spend(rankings, banks, options, w, coal).items():
                if c:
                    banks[(v, w)] = banks.get((v, w), 0) - c
                    consumed += c
        for v in voters:                       # flat accrual
            for o in rankings[v]:
                if o != w:
                    banks[(v, o)] = banks.get((v, o), 0) + 1
                    accrued += 1
    return winners, accrued, consumed


def borda(ranking, w, M):
    return (M - 1 - ranking.index(w)) / (M - 1) if w in ranking else 0.0


def report(name, rankings, options, rounds=300):
    M = len(options)
    voters = list(rankings.keys())
    print("=" * 72)
    print(name)
    for v in voters:
        print(f"    {v}: {rankings[v]}")
    print()
    for variant in ["baseline", "clear_all", "clear_minimal"]:
        winners, accrued, consumed = simulate(rankings, options, variant, rounds)
        shares = {o: winners.count(o) / rounds for o in options}
        toprate = {v: sum(1 for w in winners if w == rankings[v][0]) / rounds for v in voters}
        avgsat = {v: sum(borda(rankings[v], w, M) for w in winners) / rounds for v in voters}
        print(f"  --- {variant} ---")
        print("    win shares : " + "  ".join(f"{o}:{shares[o]:.0%}" for o in options))
        print("    top-choice win rate: " + "  ".join(f"{v}:{toprate[v]:.0%}" for v in voters))
        print(f"    satisfaction total={sum(avgsat.values()):.2f}  "
              f"min-voter={min(avgsat.values()):.2f}  "
              f"(per-voter " + " ".join(f"{avgsat[v]:.2f}" for v in voters) + ")")
        if variant != "baseline":
            print(f"    points accrued={accrued} consumed={consumed} "
                  f"unspent={1 - consumed/accrued:.0%}")
        print("    first 32 winners: " + "".join(str(w) for w in winners[:32]))
        print()


if __name__ == "__main__":
    # Scenario A: 3 love A, 1 loves C, everyone's 2nd choice is B
    report("SCENARIO A  (3 vs 1, shared 2nd choice B)", {
        "v1": ["A", "B", "C"], "v2": ["A", "B", "C"],
        "v3": ["A", "B", "C"], "v4": ["C", "B", "A"],
    }, ["A", "B", "C"])

    # Scenario B: two blocs (A,B) + lone minority C
    report("SCENARIO B  (two blocs A & B, lone minority C)", {
        "v1": ["A", "B", "C"], "v2": ["A", "B", "C"],
        "v3": ["B", "A", "C"], "v4": ["B", "A", "C"],
        "v5": ["C", "A", "B"],
    }, ["A", "B", "C"])

    # Scenario C: dominant 3-voter P bloc + lonely R & S
    report("SCENARIO C  (dominant P bloc, lonely R & S)", {
        "v1": ["P", "Q", "R", "S"], "v2": ["P", "Q", "R", "S"], "v3": ["P", "Q", "R", "S"],
        "v4": ["Q", "P", "R", "S"], "v5": ["R", "S", "Q", "P"], "v6": ["S", "R", "Q", "P"],
    }, ["P", "Q", "R", "S"])
