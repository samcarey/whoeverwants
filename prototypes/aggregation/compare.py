"""Run every scenario through IRV / Borda / Condorcet and emit a comparison.

Usage (from repo root):
    cd server && uv run python ../prototypes/aggregation/compare.py
    # writes prototypes/aggregation/report.html and prints a console summary

Pure analysis — touches no production code, no DB, no network.
"""

from __future__ import annotations

import html
from pathlib import Path

from methods import borda_scores, borda_winner, condorcet_winner, irv_winner
from scenarios import SCENARIOS, Scenario

OUT = Path(__file__).resolve().parent / "report.html"


def run(s: Scenario) -> dict:
    irv = irv_winner(s.rankings, s.options)
    borda = borda_winner(s.rankings, s.options)
    cond = condorcet_winner(s.rankings, s.options)
    scores = borda_scores(s.rankings, s.options)
    winners = {irv, borda, cond.winner}
    return {
        "irv": irv,
        "borda": borda,
        "condorcet": cond,
        "borda_scores": scores,
        "agree": len(winners) == 1,
    }


def consensus_note(s: Scenario, r: dict) -> str:
    """One plain-language line: did the headline differ from 'least objectionable'?"""
    if r["agree"]:
        return (
            f"All three methods agree on “{r['irv']}”. No headline change would "
            "move this result."
        )
    cw = r["condorcet"]
    cw_kind = "the option that beats every other head-to-head" if cw.is_true_condorcet \
        else "the least-objectionable option (minimax)"
    return (
        f"IRV crowns “{r['irv']}” (strongest core / most #1s), but {cw_kind} is "
        f"“{cw.winner}” and Borda’s broad-acceptance winner is “{r['borda']}”. "
        f"A group that wanted ‘the thing nobody hates’ would expect "
        f"“{cw.winner}”."
    )


# --------------------------------------------------------------------------- #
# Console summary
# --------------------------------------------------------------------------- #
def print_console() -> list[tuple[Scenario, dict]]:
    rows = [(s, run(s)) for s in SCENARIOS]
    print("\n" + "=" * 78)
    print("RANKED-CHOICE AGGREGATION — METHOD COMPARISON (prototype, owner review)")
    print("=" * 78)
    w = max(len(s.title) for s in SCENARIOS)
    print(f"\n{'scenario':<{w}}  {'IRV (now)':<14} {'Borda':<14} {'Condorcet':<14} same?")
    print("-" * (w + 50))
    for s, r in rows:
        same = "  ✓" if r["agree"] else "  ✗ DIVERGES"
        cw = r["condorcet"].winner + ("" if r["condorcet"].is_true_condorcet else "*")
        print(f"{s.title:<{w}}  {str(r['irv']):<14} {str(r['borda']):<14} {cw:<14}{same}")
    print("\n  * = no true Condorcet winner; completed by minimax (smallest worst defeat)")
    diverged = [s.title for s, r in rows if not r["agree"]]
    print(f"\n  {len(diverged)}/{len(rows)} scenarios diverge between IRV and consensus methods:")
    for t in diverged:
        print(f"    - {t}")
    print()
    return rows


# --------------------------------------------------------------------------- #
# HTML report (the artifact the owner clicks through)
# --------------------------------------------------------------------------- #
def _esc(x) -> str:
    return html.escape(str(x))


def render_html(rows: list[tuple[Scenario, dict]]) -> str:
    diverged = sum(1 for _, r in rows if not r["agree"])
    cards = []
    for s, r in rows:
        cond = r["condorcet"]
        scores = r["borda_scores"]
        # ballots table
        brows = "".join(
            f"<tr><td class='vn'>{_esc(name)}</td><td>{' › '.join(_esc(o) for o in rk)}</td></tr>"
            for name, rk in s.ballots
        )
        # borda bar list (sorted desc)
        smax = max(scores.values()) if scores else 1
        bbars = "".join(
            f"<div class='bb'><span class='bl'>{_esc(o)}</span>"
            f"<span class='bt'><span class='bf' style='width:{(scores[o] / smax) * 100:.0f}%'></span></span>"
            f"<span class='bv'>{scores[o]}</span></div>"
            for o in sorted(s.options, key=lambda o: -scores.get(o, 0))
        )
        chips = (
            f"<span class='chip irv'>IRV → {_esc(r['irv'])}</span>"
            f"<span class='chip borda'>Borda → {_esc(r['borda'])}</span>"
            f"<span class='chip cond'>Condorcet → {_esc(cond.winner)}"
            f"{'' if cond.is_true_condorcet else ' *'}</span>"
        )
        verdict = "agree" if r["agree"] else "diverge"
        cards.append(f"""
        <section class="card {verdict}">
          <div class="hd">
            <h2>{_esc(s.title)}</h2>
            <span class="tag {verdict}">{'methods agree' if r['agree'] else 'methods DIVERGE'}</span>
          </div>
          <p class="blurb">{_esc(s.blurb)}</p>
          <div class="chips">{chips}</div>
          <p class="note">{_esc(consensus_note(s, r))}</p>
          <details>
            <summary>Ballots &amp; Borda breakdown</summary>
            <div class="cols">
              <table class="ballots"><thead><tr><th>voter</th><th>ranking (best › worst)</th></tr></thead>
                <tbody>{brows}</tbody></table>
              <div class="borda"><div class="bh">Borda score (breadth of support)</div>{bbars}</div>
            </div>
          </details>
          <p class="src">source: {_esc(s.source)}</p>
        </section>""")

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ranked-choice aggregation — method comparison</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font: 15px/1.55 -apple-system, system-ui, sans-serif; max-width: 860px;
         margin: 0 auto; padding: 24px 16px 80px; background: #f7f7f8; color: #1a1a1a; }}
  @media (prefers-color-scheme: dark) {{ body {{ background:#0f1115; color:#e6e6e6; }} }}
  h1 {{ font-size: 26px; margin: 0 0 6px; }}
  .lede {{ color: #666; margin: 0 0 18px; }}
  @media (prefers-color-scheme: dark) {{ .lede {{ color:#9aa0aa; }} }}
  .frame {{ background: #eef0f3; border-radius: 12px; padding: 14px 16px; margin: 0 0 22px; font-size:14px; }}
  @media (prefers-color-scheme: dark) {{ .frame {{ background:#1a1d24; }} }}
  .frame b {{ color:#1a1a1a; }} @media (prefers-color-scheme: dark) {{ .frame b {{ color:#fff; }} }}
  .card {{ background:#fff; border-radius:14px; padding:16px 18px; margin:0 0 16px;
          border:1px solid #e3e5e9; }}
  @media (prefers-color-scheme: dark) {{ .card {{ background:#161922; border-color:#262a33; }} }}
  .card.diverge {{ border-left:4px solid #e0a000; }}
  .card.agree {{ border-left:4px solid #2f9e44; }}
  .hd {{ display:flex; align-items:center; gap:10px; justify-content:space-between; }}
  h2 {{ font-size:18px; margin:0; }}
  .tag {{ font-size:11px; font-weight:700; padding:3px 8px; border-radius:999px; white-space:nowrap; }}
  .tag.diverge {{ background:#fff3d6; color:#8a6100; }}
  .tag.agree {{ background:#e3f5e8; color:#1d7a32; }}
  .blurb {{ color:#555; margin:8px 0 12px; }}
  @media (prefers-color-scheme: dark) {{ .blurb {{ color:#9aa0aa; }} }}
  .chips {{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; }}
  .chip {{ font-size:13px; font-weight:600; padding:5px 10px; border-radius:8px; }}
  .chip.irv {{ background:#e7edff; color:#2545b8; }}
  .chip.borda {{ background:#efe7ff; color:#5b2db8; }}
  .chip.cond {{ background:#e3f5e8; color:#1d7a32; }}
  .note {{ font-size:14px; margin:6px 0 4px; }}
  .card.diverge .note {{ font-weight:600; }}
  details {{ margin-top:8px; }}
  summary {{ cursor:pointer; font-size:13px; color:#777; }}
  .cols {{ display:flex; gap:18px; flex-wrap:wrap; margin-top:10px; }}
  table.ballots {{ border-collapse:collapse; font-size:13px; flex:1; min-width:280px; }}
  table.ballots th, table.ballots td {{ text-align:left; padding:3px 8px; border-bottom:1px solid #eee; }}
  @media (prefers-color-scheme: dark) {{ table.ballots th, table.ballots td {{ border-color:#262a33; }} }}
  .vn {{ font-weight:600; white-space:nowrap; }}
  .borda {{ flex:1; min-width:240px; }}
  .bh {{ font-size:12px; color:#888; margin-bottom:6px; }}
  .bb {{ display:flex; align-items:center; gap:8px; margin:3px 0; font-size:13px; }}
  .bl {{ width:120px; }} .bv {{ width:24px; text-align:right; color:#888; }}
  .bt {{ flex:1; height:8px; background:#eceef2; border-radius:6px; overflow:hidden; }}
  @media (prefers-color-scheme: dark) {{ .bt {{ background:#262a33; }} }}
  .bf {{ display:block; height:100%; background:#7b61ff; }}
  .src {{ font-size:11px; color:#aaa; margin:10px 0 0; }}
</style></head><body>
<h1>Ranked-choice headline — method comparison</h1>
<p class="lede">Prototype for the “Layer 2” decision: should the headline winner stay
Instant-Runoff, or move to (or offer) a broad-acceptance method? Same ballots, three methods.
Production is unchanged — this is a read-only comparison.</p>
<div class="frame">
  <p><b>The two intents, in plain words:</b></p>
  <p>• <b>Favorite (IRV, current)</b> — “the option with the strongest core support”.
  Each round drops the option with the fewest <i>first</i>-choice votes. Great for vote-splitting;
  but a broadly-liked compromise with few #1s gets eliminated early.</p>
  <p>• <b>Consensus (Borda / Condorcet)</b> — “the option the most people are okay with / nobody hates”.
  Rewards breadth across the whole ballot. For a friend group settling “where do we eat?”, this is
  usually what they actually mean.</p>
  <p><b>{diverged} of {len(rows)} scenarios below diverge.</b> When they agree, the method choice
  doesn’t matter. The decision is only about the cases where they don’t — and whether to change the
  default, offer a per-poll choice, or just keep explaining IRV (Layer 1, already shipped).</p>
</div>
{''.join(cards)}
<p class="src">* no true Condorcet winner; completed by minimax (smallest worst pairwise defeat).
Generated by prototypes/aggregation/compare.py — re-run to regenerate.</p>
</body></html>"""


def main() -> None:
    rows = print_console()
    OUT.write_text(render_html(rows), encoding="utf-8")
    print(f"  HTML report written to: {OUT}")
    print()


if __name__ == "__main__":
    main()
