#!/usr/bin/env python3
"""Eval harness for AI poll suggestions — runs the REAL generation pipeline
(services.poll_suggest.generate_from_history) against the configured LLM (Ollama
on the Mac mini) over the scenarios in scenarios.py, prints each scenario's
history + the structured suggestions it produced, and computes simple quality
metrics so prompt/model iterations can be compared.

No database needed: generate_from_history takes a prebuilt HistoryContext, which
this builds from the scenario poll dicts using the SAME formatting + dedup helpers
the server uses. So this runs anywhere that can reach the LLM endpoint.

Run inside a per-branch dev container (Ollama reachable via host.docker.internal):

    bash scripts/remote-mac.sh "docker exec whoeverwants-dev-<slug> sh -c \\
      'cd /repo/server && uv run python ../prototypes/poll-suggest/eval.py'" / 600

Or against canary's Ollama route from anywhere with the bearer:

    POLL_VARIANT_LLM_URL=https://ollama.dev.whoeverwants.com/v1/chat/completions \\
    POLL_VARIANT_LLM_MODEL=nous-hermes2:10.7b \\
    POLL_VARIANT_LLM_API_KEY=<token> \\
    uv run python prototypes/poll-suggest/eval.py

Flags:
    --model <id>   override POLL_SUGGEST_LLM_MODEL for this run (compare models)
    --rounds N     generate N times per scenario (LLM is non-deterministic)
"""
from __future__ import annotations

import argparse
import os
import sys

# Make `services` / `database` importable when run from the repo root or server/.
HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.normpath(os.path.join(HERE, "..", "..", "server"))
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

from scenarios import SCENARIOS  # noqa: E402

from services import llm_client, poll_suggest  # noqa: E402


def build_context(scenario: dict) -> poll_suggest.HistoryContext:
    """Mirror gather_history with in-memory poll dicts (no DB)."""
    ctx = poll_suggest.HistoryContext()
    for r in scenario["group_polls"]:
        ctx.group_lines.append(poll_suggest._poll_line(r))
        ctx.existing_signatures.update(poll_suggest._row_signatures(r))
    for r in scenario["user_polls"]:
        ctx.user_lines.append(poll_suggest._poll_line(r))
        ctx.existing_signatures.update(poll_suggest._row_signatures(r))
    return ctx


def render_suggestion(s: dict) -> str:
    parts = [f"[{s['category']}]"]
    if s.get("title"):
        parts.append(f'"{s["title"]}"')
    if s.get("options"):
        parts.append("options: " + ", ".join(s["options"]))
    if s.get("context"):
        parts.append(f"for: {s['context']}")
    return " ".join(parts)


def score(suggestions: list[dict]) -> dict:
    n = len(suggestions)
    cats = {s["category"] for s in suggestions}
    with_ctx = sum(1 for s in suggestions if s.get("context"))
    with_opts = sum(1 for s in suggestions if s.get("options"))
    return {
        "count": n,
        "distinct_categories": len(cats),
        "diversity": round(len(cats) / n, 2) if n else 0.0,
        "with_context": with_ctx,
        "with_options": with_opts,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None, help="override POLL_SUGGEST_LLM_MODEL")
    ap.add_argument("--rounds", type=int, default=1)
    args = ap.parse_args()

    if args.model:
        # llm_client read the env at import; re-point the module-level default.
        llm_client._SUGGEST_MODEL = args.model  # type: ignore[attr-defined]

    if not llm_client.is_configured():
        print(
            "LLM not configured. Set POLL_VARIANT_LLM_URL + POLL_VARIANT_LLM_MODEL "
            "(see the module docstring).",
            file=sys.stderr,
        )
        return 2

    print(f"Model: {llm_client.suggest_model()}   URL: {llm_client._LLM_URL}\n")  # type: ignore[attr-defined]

    agg = {"count": 0, "distinct_categories": 0, "scenarios": 0, "empty": 0}
    for scenario in SCENARIOS:
        ctx = build_context(scenario)
        print("=" * 78)
        print(scenario["name"])
        print("-" * 78)
        print("GROUP history:")
        print("  " + ("\n  ".join(ctx.group_lines) or "(none)"))
        print("USER history:")
        print("  " + ("\n  ".join(ctx.user_lines) or "(none)"))
        for rnd in range(args.rounds):
            suggestions = poll_suggest.generate_from_history(ctx)
            label = f"SUGGESTIONS (round {rnd + 1})" if args.rounds > 1 else "SUGGESTIONS"
            print(f"{label}:")
            if not suggestions:
                print("  (none — LLM returned nothing usable)")
                agg["empty"] += 1
            for s in suggestions:
                print("  • " + render_suggestion(s))
            m = score(suggestions)
            print(f"  metrics: {m}")
            agg["count"] += m["count"]
            agg["distinct_categories"] += m["distinct_categories"]
            agg["scenarios"] += 1
        print()

    runs = max(1, agg["scenarios"])
    print("=" * 78)
    print("AGGREGATE")
    print(f"  runs: {agg['scenarios']}   empty runs: {agg['empty']}")
    print(f"  avg suggestions/run: {agg['count'] / runs:.2f}")
    print(f"  avg distinct categories/run: {agg['distinct_categories'] / runs:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
