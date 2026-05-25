"""
Recurring-vote fairness — robustness battery for the clear-all scheme.

Flat accrual is FIXED (+1 to every ranked non-winner each round). We vary:
  - bank weight w           (how much stored grievance amplifies a live vote)
  - who gets cleared on win  (resting coalition vs everyone who ranked the winner)
  - cap / decay              (bound the memory)
  - scale                    (4..50 voters, 3..8 options)
  - ballot model             (random, Mallows popular-favorite, partial top-k)

Metrics:
  variety        normalized entropy of the win distribution (0=one winner, 1=uniform)
  opts_won       fraction of options that win at least once
  shut-out       fraction of voters whose TOP choice never wins  (starvation)
  worst_drought  longest run of rounds the most-neglected voter waits for a #1 win
  tot_sat        total Borda satisfaction across voters
  gini           inequality of per-voter satisfaction (0=equal)

Headline findings (see README.md): clear-all drives shut-out to 0% across every
scale and ballot style tested, roughly triples variety, costs ~5-12% total
satisfaction. w is a near-switch (any w>0 flips it on, then saturates). The cap
is the real variety dial, but it is COUPLED to the no-starvation guarantee:
caps below ~5 re-introduce starvation. Variety auto-scales to genuine preference
diversity (Mallows low-noise -> little forced variety; random -> lots).

Run:  python3 sim_robustness.py
"""
import math
import random
from statistics import mean


def weighted_irv(rankings, banks, options, w, rng):
    eliminated = set()
    voters = list(rankings.keys())
    while True:
        active = [o for o in options if o not in eliminated]
        tally = {o: 0.0 for o in active}
        assign = {}
        for v in voters:
            choice = None
            for o in rankings[v]:
                if o not in eliminated:
                    choice = o
                    break
            assign[v] = choice
            if choice is not None:
                tally[choice] += w * banks.get((v, choice), 0.0) + 1
        total = sum(tally.values())
        if total == 0:
            return None, set()
        best = max(active, key=lambda o: (tally[o], rng.random()))
        if tally[best] * 2 > total or len(active) == 1:
            return best, {v for v in voters if assign[v] == best}
        worst = min(active, key=lambda o: (tally[o], rng.random()))
        eliminated.add(worst)


def simulate(rankings, options, cfg, rounds, rng):
    """cfg: dict(w, clear in {'none','coalition','rankers'}, cap=None, decay=1.0)"""
    banks = {}
    voters = list(rankings.keys())
    winners = []
    w, clear = cfg["w"], cfg["clear"]
    cap, decay = cfg.get("cap"), cfg.get("decay", 1.0)
    for _ in range(rounds):
        win, coal = weighted_irv(rankings, banks, options, w, rng)
        winners.append(win)
        if clear == "none" or win is None:
            continue
        if clear == "coalition":
            for v in coal:
                banks[(v, win)] = 0.0
        elif clear == "rankers":
            for v in voters:
                if win in rankings[v]:
                    banks[(v, win)] = 0.0
        if decay != 1.0:
            for k in list(banks):
                banks[k] *= decay
        for v in voters:
            for o in rankings[v]:
                if o != win:
                    banks[(v, o)] = banks.get((v, o), 0.0) + 1
                    if cap is not None and banks[(v, o)] > cap:
                        banks[(v, o)] = cap
    return winners


def borda(ranking, w, M):
    return (M - 1 - ranking.index(w)) / (M - 1) if w in ranking else 0.0


def gini(xs):
    xs = sorted(xs)
    n, s = len(xs), sum(xs)
    if s == 0:
        return 0.0
    return (2 * sum((i + 1) * x for i, x in enumerate(xs)) / (n * s)) - (n + 1) / n


def metrics(rankings, options, winners, M):
    R = len(winners)
    voters = list(rankings.keys())
    counts = {o: winners.count(o) for o in options}
    ps = [c / R for c in counts.values() if c > 0]
    variety = (-sum(p * math.log(p) for p in ps)) / math.log(M) if M > 1 else 0.0
    toprate, sat, droughts = {}, {}, []
    for v in voters:
        wins = [i for i, w in enumerate(winners) if w == rankings[v][0]]
        toprate[v] = len(wins) / R
        sat[v] = mean(borda(rankings[v], w, M) for w in winners)
        idx = [-1] + wins + [R]
        droughts.append(max(idx[i + 1] - idx[i] - 1 for i in range(len(idx) - 1)))
    return dict(
        variety=variety,
        opts_won=sum(1 for o in options if counts[o] > 0) / M,
        shut=sum(1 for v in voters if toprate[v] == 0) / len(voters),
        min_top=min(toprate.values()),
        tot_sat=sum(sat.values()),
        gini=gini(list(sat.values())),
        worst_drought=max(droughts),
    )


def gen_random(N, M, rng, top_k=None):
    r = {}
    for i in range(N):
        perm = list(range(M))
        rng.shuffle(perm)
        r[i] = perm[:top_k] if top_k else perm
    return r


def gen_mallows(N, M, rng, swaps, top_k=None):
    central, r = list(range(M)), {}
    for i in range(N):
        p = central[:]
        for _ in range(swaps):
            j = rng.randrange(M - 1)
            p[j], p[j + 1] = p[j + 1], p[j]
        r[i] = p[:top_k] if top_k else p
    return r


def ensemble(profile_fn, M, cfg, rounds=400, trials=40, base_seed=0):
    acc = {}
    for t in range(trials):
        rng = random.Random(base_seed * 1000 + t)
        rankings = profile_fn(rng)
        winners = simulate(rankings, list(range(M)), cfg, rounds, rng)
        for k, v in metrics(rankings, list(range(M)), winners, M).items():
            acc.setdefault(k, []).append(v)
    return {k: mean(v) for k, v in acc.items()}


def row(label, m):
    print(f"  {label:<22} variety={m['variety']:.2f}  opts_won={m['opts_won']:.0%}  "
          f"shut-out={m['shut']:.0%}  worst-drought={m['worst_drought']:.0f}  "
          f"tot_sat={m['tot_sat']:.2f}  gini={m['gini']:.2f}")


if __name__ == "__main__":
    pf = lambda rng: gen_random(8, 5, rng)

    print("=" * 96)
    print("EXP1 — variant comparison  (8 voters, 5 options, full random ballots)")
    row("baseline (w=0)",       ensemble(pf, 5, dict(w=0, clear="none")))
    row("clear-all coalition",  ensemble(pf, 5, dict(w=1, clear="coalition")))
    row("clear-all rankers",    ensemble(pf, 5, dict(w=1, clear="rankers")))
    row("clear-all + cap=8",    ensemble(pf, 5, dict(w=1, clear="coalition", cap=8)))
    row("clear-all + decay=.9", ensemble(pf, 5, dict(w=1, clear="coalition", decay=0.9)))

    print("=" * 96)
    print("EXP2 — bank-weight dial  (clear-all coalition) — note it SATURATES, not a smooth dial")
    for w in [0, 0.5, 1, 2, 4]:
        row(f"w={w}", ensemble(pf, 5, dict(w=w, clear="coalition")))

    print("=" * 96)
    print("EXP3 — scale robustness  (clear-all coalition, w=1, full random ballots)")
    for N in [4, 8, 20, 50]:
        for M in [3, 5, 8]:
            m = ensemble(lambda rng, N=N, M=M: gen_random(N, M, rng), M,
                         dict(w=1, clear="coalition"), rounds=400, trials=25)
            print(f"  N={N:<3} M={M}:  variety={m['variety']:.2f}  opts_won={m['opts_won']:.0%}  "
                  f"shut-out={m['shut']:.0%}  worst-drought={m['worst_drought']:.0f}  "
                  f"tot_sat={m['tot_sat']:.2f}")

    print("=" * 96)
    print("EXP4 — ballot-style robustness  (clear-all coalition, w=1; N=10, M=6)")
    M = 6
    models = {
        "random full":        lambda rng: gen_random(10, 6, rng),
        "mallows low-noise":  lambda rng: gen_mallows(10, 6, rng, swaps=2),
        "mallows high-noise": lambda rng: gen_mallows(10, 6, rng, swaps=8),
        "partial top-3":      lambda rng: gen_random(10, 6, rng, top_k=3),
        "mallows+partial":    lambda rng: gen_mallows(10, 6, rng, swaps=4, top_k=3),
    }
    for name, fn in models.items():
        base = ensemble(fn, M, dict(w=0, clear="none"))
        ca = ensemble(fn, M, dict(w=1, clear="coalition"))
        print(f"  {name:<20} baseline: variety={base['variety']:.2f} shut={base['shut']:.0%} "
              f"sat={base['tot_sat']:.2f}   |  clear-all: variety={ca['variety']:.2f} "
              f"shut={ca['shut']:.0%} worst-drought={ca['worst_drought']:.0f} sat={ca['tot_sat']:.2f}")

    print("=" * 96)
    print("EXP5 — cap sweep  (8 voters, 5 options, clear-all coalition, w=1) — cap is the variety dial")
    print("       but low caps RE-INTRODUCE starvation: the no-starvation guarantee needs big banks")
    for cap in [1, 2, 3, 5, 10, None]:
        m = ensemble(pf, 5, dict(w=1, clear="coalition", cap=cap))
        print(f"  cap={str(cap):<5} variety={m['variety']:.2f}  shut-out={m['shut']:.0%}  "
              f"worst-drought={m['worst_drought']:.0f}  tot_sat={m['tot_sat']:.2f}  gini={m['gini']:.2f}")
