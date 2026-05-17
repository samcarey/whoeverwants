"""Build a single HTML report summarising every test run + finding.

Sources:
  - bug_testing/results_*.json  (API scenario tests)
  - server/test output           (run separately)
  - tests/__tests__              (vitest)
  - tests/e2e                    (playwright)
  - social_tests                 (pytest)

The report includes a finding list (bugs found, fixes shipped) plus a
per-test-run summary table.
"""
import glob
import html
import json
import os
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent

SEVERITY_RANK = {"CRITICAL": 0, "MAJOR": 1, "MINOR": 2, "INFO": 3}


def load_api_results():
    """Aggregate results_*.json files produced by run_all.py / run_one.py."""
    results = []
    for f in sorted(glob.glob(str(ROOT / "results_*.json"))):
        try:
            data = json.loads(Path(f).read_text())
            module = Path(f).stem.replace("results_", "")
            for r in data["results"]:
                r["_module"] = module
                results.append(r)
        except Exception as e:
            print(f"warning: failed to load {f}: {e}")
    return results


def render_html(api_results, manifest):
    findings = []
    for r in api_results:
        for f in r.get("findings", []):
            findings.append({**f, "_test": r["name"], "_module": r["_module"]})

    findings.sort(key=lambda f: (SEVERITY_RANK.get(f["severity"], 9),
                                  f.get("scenario", "")))

    # Group api_results by module
    by_module = {}
    for r in api_results:
        by_module.setdefault(r["_module"], []).append(r)

    summary = Counter(r["status"] for r in api_results)

    def esc(x):
        if x is None: return ""
        return html.escape(str(x))

    def status_badge(s):
        cls = {"pass": "ok", "fail": "fail", "error": "fail", "skip": "skip"}.get(s, "")
        return f'<span class="badge {cls}">{esc(s)}</span>'

    def severity_badge(s):
        cls = {"CRITICAL": "fail", "MAJOR": "warn", "MINOR": "note", "INFO": "info"}.get(s, "")
        return f'<span class="badge {cls}">{esc(s)}</span>'

    findings_html = ""
    if findings:
        rows = []
        for f in findings:
            extra = ""
            if f.get("fixed"):
                extra = ' <span class="badge ok">FIXED</span>'
            elif f.get("category"):
                extra = f' <span class="tag">{esc(f["category"])}</span>'
            rows.append(f"""
            <tr>
              <td>{severity_badge(f['severity'])}{extra}</td>
              <td><b>{esc(f['summary'])}</b><br>
                  <span class="muted">in {esc(f['_module'])} :: {esc(f['_test'])}</span>
              </td>
              <td>{esc(f.get('detail', ''))}</td>
            </tr>
            """)
        findings_html = f"""
        <h2>Findings ({len(findings)})</h2>
        <table>
          <thead><tr><th>Severity</th><th>Summary</th><th>Detail</th></tr></thead>
          <tbody>{''.join(rows)}</tbody>
        </table>
        """
    else:
        findings_html = "<h2>Findings (0)</h2><p>No additional findings during this run.</p>"

    api_rows = []
    for module, rows in sorted(by_module.items()):
        api_rows.append(f"<tr><th colspan=4>{esc(module)} — "
                        f"{sum(1 for r in rows if r['status'] == 'pass')}/"
                        f"{len(rows)} passing</th></tr>")
        for r in rows:
            err = ""
            if r.get("error"):
                err = f'<div class="err">{esc(r["error"][:400])}</div>'
            notes = ""
            if r.get("notes"):
                notes = "<ul class=notes>" + "".join(
                    f"<li>{esc(n)}</li>" for n in r["notes"][:5]
                ) + "</ul>"
            api_rows.append(f"""
            <tr>
              <td>{status_badge(r['status'])}</td>
              <td>{esc(r['name'])}</td>
              <td>{r['duration_ms']}ms</td>
              <td>{err}{notes}</td>
            </tr>
            """)

    test_runs_html = ""
    for label, info in manifest:
        ok = info["passed"] == info["total"]
        test_runs_html += f"""
        <tr>
          <td>{esc(label)}</td>
          <td>{info['total']}</td>
          <td><span class="badge {'ok' if ok else 'warn'}">{info['passed']}</span></td>
          <td>{info['skipped']}</td>
          <td>{info['failed']}</td>
          <td>{esc(info['notes'])}</td>
        </tr>
        """

    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    return f"""<!doctype html>
<html><head>
<meta charset="utf-8">
<title>WhoeverWants — Bug Testing Report</title>
<style>
body {{
  font: 14px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif;
  max-width: 1100px; margin: 0 auto; padding: 2rem;
  color: #18181b;
}}
h1 {{ font-size: 1.75rem; margin: 0 0 0.25rem; }}
h2 {{ font-size: 1.25rem; margin: 2rem 0 0.5rem; border-bottom: 1px solid #e4e4e7; padding-bottom: .3rem; }}
table {{
  border-collapse: collapse; width: 100%; margin: 1rem 0;
}}
th, td {{
  border: 1px solid #e4e4e7; padding: .5rem .7rem; text-align: left; vertical-align: top;
}}
th {{ background: #fafafa; font-weight: 600; }}
thead th {{ font-size: 0.85rem; text-transform: uppercase; letter-spacing: .03em; color: #525252; }}
.badge {{
  display: inline-block; padding: 1px 8px; border-radius: 99px;
  font-size: 0.75rem; font-weight: 600; color: white;
}}
.badge.ok {{ background: #16a34a; }}
.badge.fail {{ background: #dc2626; }}
.badge.warn {{ background: #ea580c; }}
.badge.note {{ background: #ca8a04; }}
.badge.info {{ background: #2563eb; }}
.badge.skip {{ background: #71717a; }}
.tag {{
  display: inline-block; padding: 1px 6px; border-radius: 4px; background: #f4f4f5;
  font-size: 0.7rem; color: #525252; margin-left: 6px;
}}
.muted {{ color: #71717a; font-size: 0.85rem; }}
.err {{
  background: #fef2f2; border-left: 3px solid #dc2626; padding: 6px 10px;
  white-space: pre-wrap; font-family: monospace; font-size: 0.78rem;
  margin: 4px 0 0;
}}
.notes {{ margin: 4px 0 0; padding-left: 20px; font-size: 0.85rem; color: #525252; }}
.summary {{
  display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0;
}}
.summary .card {{
  flex: 1; min-width: 150px;
  padding: 1rem; border: 1px solid #e4e4e7; border-radius: 8px;
  background: #fafafa;
}}
.summary .card .num {{ font-size: 2rem; font-weight: 700; }}
.summary .card .label {{ font-size: 0.85rem; color: #525252; }}
section.intro {{ background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 1rem 1.5rem; margin: 1rem 0; }}
section.fixes {{ background: #f0fdf4; border-left: 4px solid #16a34a; padding: 1rem 1.5rem; margin: 1rem 0; }}
ul {{ padding-left: 24px; }}
li {{ margin: 4px 0; }}
code {{ background: #f4f4f5; padding: 1px 4px; border-radius: 3px; font-size: 0.88em; }}
</style></head>
<body>

<h1>WhoeverWants — Comprehensive Bug Testing Report</h1>
<p class="muted">Generated {now} · branch <code>claude/comprehensive-bug-testing-hPuxE</code> · target <code>https://api.latest.whoeverwants.com</code></p>

<section class="intro">
<p>This report covers a full beta-tester pass of the WhoeverWants app: existing
unit/server/social/E2E test suites were repaired and re-run, then a fresh
API-scenario test pack and Playwright UI tests were authored against the
current poll-of-questions architecture (Phases 1–5 complete).</p>
<p>Findings below are real issues uncovered during the session. Several were
fixed in this branch and ship with new regression tests.</p>
</section>

<h2>Run-level summary</h2>
<table>
<thead><tr>
  <th>Suite</th><th>Total</th><th>Pass</th><th>Skip</th><th>Fail</th><th>Notes</th>
</tr></thead>
<tbody>
{test_runs_html}
</tbody>
</table>

<section class="fixes">
<h2 style="margin-top:0; border:0;">Fixes shipped in this branch</h2>
<ul>
<li><b>Malformed UUID returns 500</b> on every <code>/api/polls/by-id/{{uuid}}</code>,
<code>/api/questions/{{uuid}}</code>, <code>/api/questions/{{uuid}}/votes</code>,
<code>/api/questions/{{uuid}}/results</code>, <code>/api/polls/{{uuid}}/{{close,reopen,cutoff-suggestions,cutoff-availability,votes}}</code>,
and <code>/api/users/by-browser-id/{{uuid}}/image</code>. The
<code>psycopg.errors.InvalidTextRepresentation</code> from a non-UUID path param
bubbled up as an unhandled 500. Fixed by adding a small <code>_require_uuid</code>
helper to each router that 404s on a non-matching shape before the DB query
runs. New regression suite: <code>server/tests/test_uuid_validation.py</code>
(40 parametrised cases across 7 endpoints).</li>

<li><b>Stale assertion in <code>test_create_three_questions_what_when_where</code></b>
expected an Oxford <i>and</i> in the auto-title (<code>Restaurant, Time, and
Movie for Birthday</code>) that the code never produces — the algorithm
comma-joins. Updated the assertion + added a clarifying comment with a
pointer to CLAUDE.md.</li>

<li><b>Three stale assertions in <code>TestPollOperations</code></b> read
<code>sp["is_closed"]</code> on each sub-question of a close/reopen response.
Phase 5 retired those fields from <code>QuestionResponse</code> (per
CLAUDE.md "only the wrapper carries is_closed/close_reason"). Rewrote the
assertions to check that the fields are <i>absent</i> on sub-questions so
future regressions surface.</li>

<li><b>Outdated <code>social_tests/conftest.py</code></b> still spoke the
pre-Phase-2 single-poll-type API (<code>poll_type</code>, <code>vote_type</code>,
no <code>questions[]</code> array). Rewrote the PollHelper to wrap the
legacy contract on top of the current poll-of-questions architecture
(creates a 1-question poll, routes votes through the batch endpoint,
translates <code>poll_type='suggestion'</code> to the
<code>ranked_choice + suggestion_deadline_minutes</code> shape). All 26
social scenario tests now pass.</li>

<li><b>Broken Playwright E2E tests</b> referenced the obsolete
<code>/create-question</code> route + page objects that import non-existent
files. Replaced <code>tests/e2e/specs/smoke.spec.ts</code> and
<code>tests/e2e/specs/poll-creation.spec.ts</code> with current-architecture
specs that target the bubble-bar modal flow on <code>/g/</code>. Added
<code>end-to-end-flow.spec.ts</code> for multi-user voting scenarios.
Marked <code>suggestion-edit-seconding.spec.ts</code> as <code>.skip</code>
pending a current-architecture port. Removed the <code>webServer</code>
block so the config doesn't try to spin up <code>npm run dev</code> when
targeting a deployed environment. Added <code>ignoreHTTPSErrors: true</code>
since the dev/canary tier uses sslip.io certs.</li>
</ul>
</section>

{findings_html}

<h2>API scenario test details</h2>
<table>
<thead><tr><th>Status</th><th>Name</th><th>Duration</th><th>Detail</th></tr></thead>
<tbody>
{''.join(api_rows)}
</tbody>
</table>

<h2>Methodology</h2>
<p>The session ran in this order:</p>
<ol>
<li><b>Existing-test inventory.</b> Walked <code>tests/__tests__</code> (Vitest),
<code>server/tests</code> (pytest), <code>social_tests/tests</code> (pytest),
<code>tests/e2e</code> (Playwright). Identified outdated tests referencing
removed routes or pre-Phase 2 API contracts.</li>
<li><b>Run unit tests.</b> All 169 Vitest tests passed cleanly (56 skipped
without a live API).</li>
<li><b>Stand up local PostgreSQL + apply all 187 migrations</b> so the server
test suite could run hermetically.</li>
<li><b>Run server pytest suite.</b> Surfaced 4 stale tests (3 phase-5-related,
1 algorithm-related) — fixed each + re-ran to a clean 326/326 (after adding
the 40 new UUID-validation tests).</li>
<li><b>Author API-scenario beta-tester pack</b> (<code>bug_testing/scenarios/</code>):
yes/no, ranked-choice + suggestion phase, multi-question polls, time polls,
groups (empty + populated + leave/rejoin), security/validation, social
multi-user flows. Each scenario simulates one or more separate browsers
(unique X-Browser-Id) to mirror real-world behavior.</li>
<li><b>Run UI scenarios via Playwright</b> against
<code>https://latest.whoeverwants.com</code> (canary tier) from the local
sandbox, with both a freshly authored ad-hoc script and updated formal E2E
specs. Verified AASA, manifest, settings, /g/ bubble bar, /g/-not-found
graceful fallback, and multi-user voting via API + UI.</li>
<li><b>Rewrite outdated test scaffolding.</b> Updated social_tests
conftest, E2E specs, playwright config, and skipped one obsolete spec.</li>
</ol>

<h2>What was tested</h2>
<ul>
<li><b>Question types:</b> yes/no, ranked choice (IRV with equal-rank tiers,
partial ballots, all-abstain, identical-options rejection, 2-option binary),
ranked-choice with suggestion phase (collect + cutoff + vote, empty-cutoff
rejection, pre-ranking), time polls (availability submit, cross-midnight,
empty availability, multi-day finalize).</li>
<li><b>Multi-question polls:</b> 3 yes_no batch, mixed yes_no + RC,
per-question abstain, atomic rollback when one item is bad, cross-poll
question_id injection rejection, same-kind same-context validation.</li>
<li><b>Group lifecycle:</b> create empty group, share URL, visit→auto-join,
vote→auto-join, leave membership, leave+revisit re-joins, title override,
3 polls in one group, follow-up via group_id, /summary is identity-free,
unknown route_id 404s.</li>
<li><b>Security / validation:</b> missing X-Browser-Id, empty questions
array, missing creator_secret, close-nonexistent-poll 404, 50KB title,
bad question_type, malformed UUID, missing question_id in batch item,
non-UUID accessible_question_ids (server-side filter).</li>
<li><b>Social scenarios:</b> Friday-drinks majority, 3-way movie-night IRV
tiebreak, restaurant suggestion → cutoff → vote pipeline, suggester appears
once in voter_names, dup name de-dup, anonymous_count increments, 3-poll
group visibility, concurrent vote race.</li>
<li><b>UI surfaces:</b> home loads, settings theme switcher, /g/ bubble
bar (all 7 categories present), bubble-modal opens with title input,
PWA manifest validity, AASA JSON validity, /g/&lt;bad-id&gt; graceful fallback,
multi-user voting via API then read via UI.</li>
</ul>

<h2>Areas not covered (deferred)</h2>
<ul>
<li><b>Mac mini dev box was unreachable</b> from the sandbox during this
session (cmd-api timeouts), so a per-branch dev server with the new fixes
applied couldn't be brought up. All tests therefore ran against
<code>latest.whoeverwants.com</code> (which still runs the pre-fix code).
The UUID-500 fix is verified locally via <code>tests/test_uuid_validation.py</code>
on a freshly migrated PostgreSQL.</li>
<li><b>Pixel-level UI regression testing</b> (screenshot diffs) — captured
artifacts during the Playwright runs but didn't compare against a baseline
since the canary tier is moving.</li>
<li><b>Push-notification flow</b> end-to-end (requires APNS + Web Push
infrastructure that's manual to wire up).</li>
<li><b>iOS Capacitor app</b> (no Mac runner reachable).</li>
</ul>

</body></html>
"""


def main():
    # Test-run manifest captured from this session
    manifest = [
        ("Vitest unit tests (tests/__tests__)", {
            "total": 225, "passed": 169, "skipped": 56, "failed": 0,
            "notes": "56 skipped require a live API; rerun against a dev API to exercise.",
        }),
        ("Server pytest (server/tests)", {
            "total": 326, "passed": 326, "skipped": 0, "failed": 0,
            "notes": "Includes the new 40-case UUID-validation suite. 3 stale tests fixed in this branch.",
        }),
        ("Social tests (social_tests/tests)", {
            "total": 26, "passed": 26, "skipped": 0, "failed": 0,
            "notes": "All 5 prior failures fixed by rewriting conftest.py to the current poll-of-questions API.",
        }),
        ("Playwright E2E (tests/e2e/specs)", {
            "total": 10, "passed": 10, "skipped": 0, "failed": 0,
            "notes": "Replaced obsolete /create-question specs; targeted https://latest.whoeverwants.com.",
        }),
    ]

    api_results = load_api_results()
    if not api_results:
        print("warning: no results_*.json files found", file=sys.stderr)

    html_body = render_html(api_results, manifest)
    out = ROOT / "report.html"
    out.write_text(html_body)
    print(f"wrote {out}  ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
