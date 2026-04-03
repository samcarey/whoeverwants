#!/usr/bin/env python3
"""Generate social test report: run tests, build MD, convert to HTML, serve from droplet.

Usage:
    cd social_tests && uv run python generate_report.py [--skip-tests] [--skip-critique] [--skip-deploy]

Steps:
    1. Run pytest and collect structured results (JSON)
    2. Build a Markdown report with collapsible sections and badges
    3. Optionally inject AI critique (reads previous critique for continuity)
    4. Convert to a self-contained HTML file
    5. Deploy to the droplet for mobile viewing
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

RESULTS_PATH = Path("/tmp/social_test_results.json")
REPORT_DIR = Path(__file__).parent / "reports"
STRATEGY_PATH = Path(__file__).parent / "testing_strategy.md"
CRITIQUE_PATH = REPORT_DIR / "previous_critique.json"


def run_tests() -> list[dict]:
    """Execute pytest and return collected results."""
    env = os.environ.copy()
    env["SOCIAL_TEST_RESULTS_PATH"] = str(RESULTS_PATH)

    print("Running social tests...")
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/", "-v", "--tb=short", "-x"],
        cwd=str(Path(__file__).parent),
        env=env,
        capture_output=True,
        text=True,
    )
    print(proc.stdout)
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)

    if RESULTS_PATH.exists():
        with open(RESULTS_PATH) as f:
            return json.load(f)
    return []


def badge_html(text: str, color: str) -> str:
    """Generate an inline badge for the MD report."""
    colors = {
        "green": "#28a745",
        "red": "#dc3545",
        "blue": "#0366d6",
        "orange": "#f0883e",
        "purple": "#8b5cf6",
        "gray": "#6b7280",
    }
    bg = colors.get(color, "#6b7280")
    return f'<span style="background:{bg};color:white;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">{text}</span>'


def social_badge_color(badge: str) -> str:
    return {"FAIR": "green", "AWKWARD": "orange", "INSIGHT": "purple"}.get(badge, "gray")


def build_markdown(results: list[dict], critique_map: dict[str, str] | None = None, site_url: str = "") -> str:
    """Build the full Markdown report."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    critique_map = critique_map or {}
    site_url = site_url.rstrip("/")

    # Read strategy document
    strategy_text = STRATEGY_PATH.read_text() if STRATEGY_PATH.exists() else "*Strategy document not found.*"

    lines = []
    lines.append(f"# Social Test Report — {now}\n")

    # Collapsible strategy section
    lines.append("<details>")
    lines.append("<summary><strong>Testing Philosophy & Strategy</strong></summary>\n")
    lines.append(strategy_text)
    lines.append("\n</details>\n")

    # Summary
    total = len(results)
    passed = sum(1 for r in results if r["technical_pass"])
    failed = total - passed
    fair = sum(1 for r in results if r["social_badge"] == "FAIR")
    awkward = sum(1 for r in results if r["social_badge"] == "AWKWARD")
    insight = sum(1 for r in results if r["social_badge"] == "INSIGHT")

    lines.append("## Summary\n")
    lines.append(f"| Metric | Count |")
    lines.append(f"|--------|-------|")
    lines.append(f"| Total tests | {total} |")
    lines.append(f"| {badge_html('PASS', 'green')} Technical pass | {passed} |")
    lines.append(f"| {badge_html('FAIL', 'red')} Technical fail | {failed} |")
    lines.append(f"| {badge_html('FAIR', 'green')} Socially fair | {fair} |")
    lines.append(f"| {badge_html('AWKWARD', 'orange')} Socially awkward | {awkward} |")
    lines.append(f"| {badge_html('INSIGHT', 'purple')} Insights | {insight} |")
    lines.append("")

    # Group by category
    categories: dict[str, list[dict]] = {}
    for r in results:
        cat = r.get("category", "uncategorized")
        categories.setdefault(cat, []).append(r)

    for category, cat_results in categories.items():
        lines.append(f"## {category.replace('_', ' ').title()}\n")

        for r in cat_results:
            tech_badge = badge_html("PASS", "green") if r["technical_pass"] else badge_html("FAIL", "red")
            soc_color = social_badge_color(r["social_badge"])
            soc_badge = badge_html(r["social_badge"], soc_color)

            anchor = r["test_name"]
            poll_id = r["details"].get("poll_id")
            poll_link = ""
            if poll_id and site_url:
                poll_link = f' <a href="{site_url}/p/{poll_id}/" style="font-size:12px;color:#58a6ff;text-decoration:none">view poll &#x2197;</a>'

            lines.append(f'<details id="{anchor}">')
            lines.append(f"<summary>{tech_badge} {soc_badge} <code>{anchor}</code>{poll_link}</summary>\n")

            # Docstring (scenario description) — style SCENARIO:/EXPECTATION: labels
            if r["docstring"]:
                lines.append(f"#### Scenario\n")
                # Split docstring: first line is the title, rest is body
                doc_lines = r["docstring"].split("\n")
                title_line = doc_lines[0].strip()
                body = "\n".join(doc_lines[1:]).strip()
                if title_line:
                    lines.append(f"**{title_line}**\n")
                if body:
                    # Style SCENARIO:/EXPECTATION:/SOCIAL QUESTION:/NOTE: as bold labels
                    import re
                    styled = re.sub(
                        r"^(SCENARIO|EXPECTATION|SOCIAL QUESTION|NOTE):",
                        r"**\1:**",
                        body,
                        flags=re.MULTILINE,
                    )
                    lines.append(styled)
                    lines.append("")

            # Technical assertions — only include Detail column if any assertion has one
            has_details = any(a["detail"] for a in r["assertions"])
            lines.append("#### Technical Results\n")
            if has_details:
                lines.append("| Assertion | Result | Detail |")
                lines.append("|-----------|--------|--------|")
            else:
                lines.append("| Assertion | Result |")
                lines.append("|-----------|--------|")
            for a in r["assertions"]:
                icon = "&#x2705;" if a["passed"] else "&#x274C;"
                if has_details:
                    detail = a["detail"] if a["detail"] else ""
                    lines.append(f"| {a['description']} | {icon} | {detail} |")
                else:
                    lines.append(f"| {a['description']} | {icon} |")
            lines.append("")

            if r["failure_message"]:
                lines.append(f"**Failure:** `{r['failure_message']}`\n")

            # Social evaluation
            social_note = r["details"].get("social_note", "")
            if social_note:
                lines.append(f"#### Social Evaluation\n")
                lines.append(f"> {social_note}\n")

            # AI Critique — only show if it adds value beyond the social note
            critique_key = r["test_name"]
            critique_text = critique_map.get(critique_key, "")
            if critique_text and critique_text != social_note:
                lines.append(f"#### Critique\n")
                lines.append(f"{critique_text}\n")

            # Relevant data (collapsed)
            interesting_keys = {"results", "suggestion_map", "participant_names", "winner", "num_rounds"}
            data_items = {k: v for k, v in r["details"].items() if k in interesting_keys}
            if data_items:
                lines.append("<details>")
                lines.append("<summary>Raw data</summary>\n")
                lines.append("```json")
                lines.append(json.dumps(data_items, indent=2, default=str))
                lines.append("```\n")
                lines.append("</details>")

            lines.append("\n</details>\n")

    return "\n".join(lines)


def build_html(md_content: str) -> str:
    """Convert markdown to a self-contained HTML document."""
    # Escape for embedding but preserve HTML tags in the markdown
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Social Test Report — WhoeverWants</title>
<style>
  :root {{
    --bg: #0d1117;
    --fg: #e6edf3;
    --border: #30363d;
    --accent: #58a6ff;
    --surface: #161b22;
    --muted: #8b949e;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.6;
    padding: 16px;
    max-width: 900px;
    margin: 0 auto;
  }}
  h1 {{ font-size: 1.5em; margin: 16px 0; border-bottom: 1px solid var(--border); padding-bottom: 8px; }}
  h2 {{ font-size: 1.25em; margin: 20px 0 10px; color: var(--accent); }}
  h3, h4 {{ font-size: 1em; margin: 12px 0 6px; }}
  p {{ margin: 8px 0; }}
  code {{ background: var(--surface); padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }}
  pre {{ background: var(--surface); padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }}
  pre code {{ background: none; padding: 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 8px 0; }}
  th, td {{ border: 1px solid var(--border); padding: 6px 12px; text-align: left; }}
  th {{ background: var(--surface); }}
  details {{ margin: 8px 0; border: 1px solid var(--border); border-radius: 8px; }}
  details > summary {{
    padding: 10px 14px;
    cursor: pointer;
    background: var(--surface);
    border-radius: 8px;
    font-weight: 500;
  }}
  details[open] > summary {{ border-bottom: 1px solid var(--border); border-radius: 8px 8px 0 0; }}
  details > :not(summary) {{ padding: 0 14px; }}
  details > p:last-child, details > div:last-child {{ padding-bottom: 14px; }}
  blockquote {{
    border-left: 3px solid var(--accent);
    padding: 4px 12px;
    margin: 8px 0;
    color: var(--muted);
    font-style: italic;
  }}
  a {{ color: var(--accent); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  em {{ color: var(--muted); }}
  /* Badge alignment */
  summary span {{ vertical-align: middle; }}
  summary code {{ vertical-align: middle; }}
</style>
</head>
<body>
<div id="content">{_md_to_html(md_content)}</div>
</body>
</html>"""


def _md_to_html(md: str) -> str:
    """Minimal markdown-to-HTML conversion that preserves inline HTML."""
    import re

    def inline_fmt(text: str) -> str:
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
        text = re.sub(r"`(.+?)`", r"<code>\1</code>", text)
        return text

    lines = md.split("\n")
    html_lines = []
    in_code = False
    in_table = False
    table_header_done = False
    para_buf: list[str] = []  # accumulate consecutive text lines

    def flush_para():
        if para_buf:
            html_lines.append(f"<p>{inline_fmt(' '.join(para_buf))}</p>")
            para_buf.clear()

    for line in lines:
        # Code blocks
        if line.strip().startswith("```"):
            flush_para()
            if in_code:
                html_lines.append("</code></pre>")
                in_code = False
            else:
                html_lines.append("<pre><code>")
                in_code = True
            continue

        if in_code:
            html_lines.append(line.replace("<", "&lt;").replace(">", "&gt;"))
            continue

        stripped = line.strip()

        # Close table if non-table line
        if in_table and not stripped.startswith("|"):
            html_lines.append("</table>")
            in_table = False
            table_header_done = False

        # Table rows
        if stripped.startswith("|"):
            flush_para()
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if all(set(c) <= {"-", " ", ":"} for c in cells):
                table_header_done = True
                continue
            if not in_table:
                html_lines.append("<table>")
                in_table = True
            tag = "th" if not table_header_done else "td"
            row = "".join(f"<{tag}>{c}</{tag}>" for c in cells)
            html_lines.append(f"<tr>{row}</tr>")
            continue

        # HTML pass-through
        if stripped.startswith("<"):
            flush_para()
            html_lines.append(line)
            continue

        # Headers
        m = re.match(r"^(#{1,4})\s+(.*)", line)
        if m:
            flush_para()
            level = len(m.group(1))
            html_lines.append(f"<h{level}>{m.group(2)}</h{level}>")
            continue

        # Blockquote
        if stripped.startswith("> "):
            flush_para()
            html_lines.append(f"<blockquote>{inline_fmt(stripped[2:])}</blockquote>")
            continue

        # Empty line → end of paragraph
        if not stripped:
            flush_para()
            continue

        # Accumulate text lines into a paragraph
        para_buf.append(stripped)

    flush_para()
    if in_table:
        html_lines.append("</table>")
    if in_code:
        html_lines.append("</code></pre>")

    return "\n".join(html_lines)


def load_previous_critiques() -> dict[str, str]:
    """Load critiques from the previous run."""
    if CRITIQUE_PATH.exists():
        with open(CRITIQUE_PATH) as f:
            return json.load(f)
    return {}


def save_critiques(critiques: dict[str, str]):
    """Save critiques for the next run."""
    REPORT_DIR.mkdir(exist_ok=True)
    with open(CRITIQUE_PATH, "w") as f:
        json.dump(critiques, f, indent=2)


def generate_critiques(results: list[dict], previous: dict[str, str]) -> dict[str, str]:
    """Generate critiques for each test result.

    Focuses on actionable observations. Skips tests that simply pass
    with FAIR — the social note already covers those. Only emits a
    critique when there's something worth calling out.
    """
    critiques = {}
    for r in results:
        name = r["test_name"]
        social_note = r["details"].get("social_note", "")
        prev = previous.get(name, "")

        if not r["technical_pass"]:
            msg = r["failure_message"]
            critique = f"Technical failure: {msg}. Needs investigation before social evaluation is meaningful."
        elif r["social_badge"] == "AWKWARD":
            critique = social_note  # The social note IS the critique for awkward results
        elif r["social_badge"] == "INSIGHT":
            critique = social_note
        else:
            # FAIR + PASS — no critique needed, the social eval says it all
            critique = ""

        # If previous critique existed and was different, note the change (collapsed)
        if prev and critique and prev != critique:
            critique += f"\n\n<details><summary>Previous assessment</summary>\n\n{prev}\n\n</details>"

        critiques[name] = critique

    return critiques


def deploy_to_droplet(html_content: str):
    """Upload the HTML report to the droplet for mobile viewing."""
    import base64
    import tempfile

    # Write HTML to a temp file, base64 encode, send to droplet
    with tempfile.NamedTemporaryFile(mode="w", suffix=".html", delete=False) as f:
        f.write(html_content)
        tmp_path = f.name

    remote_script = Path(__file__).parent.parent / "scripts" / "remote.sh"

    # Create directory on droplet
    subprocess.run(
        ["bash", str(remote_script), "mkdir -p /var/www/reports"],
        capture_output=True,
        text=True,
    )

    # Base64 encode and transfer
    with open(tmp_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    # Write in chunks if needed (remote.sh has command length limits)
    chunk_size = 50000
    chunks = [b64[i:i + chunk_size] for i in range(0, len(b64), chunk_size)]

    # Clear any previous file
    subprocess.run(
        ["bash", str(remote_script), "rm -f /var/www/reports/social_tests.html"],
        capture_output=True,
    )

    for i, chunk in enumerate(chunks):
        op = ">>" if i > 0 else ">"
        subprocess.run(
            ["bash", str(remote_script), f"echo -n '{chunk}' {op} /tmp/report_b64.txt"],
            capture_output=True,
        )

    # Decode on droplet
    subprocess.run(
        ["bash", str(remote_script), "base64 -d /tmp/report_b64.txt > /var/www/reports/social_tests.html && rm /tmp/report_b64.txt"],
        capture_output=True,
    )

    # Clean up
    os.unlink(tmp_path)

    print("Report deployed to droplet at /var/www/reports/social_tests.html")


def main():
    parser = argparse.ArgumentParser(description="Generate social test report")
    parser.add_argument("--skip-tests", action="store_true", help="Use cached test results")
    parser.add_argument("--skip-critique", action="store_true", help="Skip AI critique generation")
    parser.add_argument("--skip-deploy", action="store_true", help="Skip deploying to droplet")
    parser.add_argument("--site-url", default=os.environ.get("SOCIAL_TEST_API_URL", ""), help="Dev site URL for poll links")
    args = parser.parse_args()

    REPORT_DIR.mkdir(exist_ok=True)

    # Step 1: Run tests
    if args.skip_tests and RESULTS_PATH.exists():
        with open(RESULTS_PATH) as f:
            results = json.load(f)
        print(f"Using cached results: {len(results)} tests")
    else:
        results = run_tests()
        print(f"Collected {len(results)} test results")

    if not results:
        print("No test results collected. Check test execution.", file=sys.stderr)
        sys.exit(1)

    # Step 2: Generate critiques
    critique_map = {}
    if not args.skip_critique:
        previous = load_previous_critiques()
        critique_map = generate_critiques(results, previous)
        save_critiques(critique_map)
        print(f"Generated {len(critique_map)} critiques")

    # Step 3: Build report
    md_content = build_markdown(results, critique_map, site_url=args.site_url)
    md_path = REPORT_DIR / "social_test_report.md"
    md_path.write_text(md_content)
    print(f"Markdown report: {md_path}")

    html_content = build_html(md_content)
    html_path = REPORT_DIR / "social_test_report.html"
    html_path.write_text(html_content)
    print(f"HTML report: {html_path}")

    # Step 4: Deploy
    if not args.skip_deploy:
        deploy_to_droplet(html_content)
    else:
        print("Skipping deployment (--skip-deploy)")


if __name__ == "__main__":
    main()
