"""Run all API-level scenario tests and emit results.json."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bug_testing.scenarios.runner import Runner
from bug_testing.scenarios import (
    test_yes_no,
    test_ranked_choice,
    test_groups,
    test_multi_question,
    test_time_polls,
    test_security,
    test_social,
)

MODULES = [
    ("yes/no questions", test_yes_no),
    ("ranked choice & suggestions", test_ranked_choice),
    ("groups", test_groups),
    ("multi-question polls", test_multi_question),
    ("time polls", test_time_polls),
    ("security & validation", test_security),
    ("social scenarios", test_social),
]


def main():
    runner = Runner()
    for label, mod in MODULES:
        print(f"\n=== {label} ===")
        try:
            mod.run(runner)
        except Exception as e:
            print(f"  ! module {mod.__name__} crashed: {e}")
    # Print results
    s = runner.summary()
    print(f"\nSUMMARY: pass={s['pass']} fail={s['fail']} error={s['error']} skip={s['skip']}")
    for r in runner.results:
        marker = {"pass": "✓", "fail": "✗", "error": "!", "skip": "·"}[r.status]
        print(f"  {marker} [{r.status:5}] {r.name} ({r.duration_ms}ms)")
        if r.error:
            print(f"        {r.error[:200]}")
        for f in r.findings:
            print(f"        FINDING [{f.severity}] {f.summary}")
    out_path = Path(__file__).resolve().parent / "results.json"
    runner.save(str(out_path))
    print(f"\nSaved {out_path}")
    return runner


if __name__ == "__main__":
    main()
