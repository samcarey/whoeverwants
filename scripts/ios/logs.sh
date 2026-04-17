#!/usr/bin/env bash
# Fetch logs for an iOS build run. If no run ID given, fetches the latest.
#
# Usage:
#   scripts/ios/logs.sh                  # latest run on ios-build.yml
#   scripts/ios/logs.sh <run_id>         # specific run
#   scripts/ios/logs.sh --failed-only    # only show failing step logs
set -euo pipefail

REPO="samcarey/whoeverwants"
WORKFLOW="ios-build.yml"
FAILED_ONLY="false"
RUN_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --failed-only) FAILED_ONLY="true"; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) RUN_ID="$1"; shift ;;
  esac
done

if [[ -z "${GITHUB_API_TOKEN:-}" ]]; then
  echo "ERROR: GITHUB_API_TOKEN not set" >&2
  exit 1
fi

AUTH=(-H "Authorization: token $GITHUB_API_TOKEN" -H "Accept: application/vnd.github+json")
API="https://api.github.com/repos/$REPO"

if [[ -z "$RUN_ID" ]]; then
  RUN_ID=$(curl -sS "${AUTH[@]}" "$API/actions/workflows/$WORKFLOW/runs?per_page=1" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['workflow_runs'][0]['id'])")
  echo "Latest run: $RUN_ID"
fi

if [[ "$FAILED_ONLY" == "true" ]]; then
  # List failed jobs/steps and print logs for each failed step.
  JOBS=$(curl -sS "${AUTH[@]}" "$API/actions/runs/$RUN_ID/jobs")
  echo "$JOBS" | python3 -c "
import json, sys, subprocess, os
d = json.load(sys.stdin)
for j in d.get('jobs', []):
    for s in j.get('steps', []):
        if s.get('conclusion') == 'failure':
            print(f\"\\n===== FAILED: {j['name']} / {s['name']} =====\")
            print(f\"  (see full log: job_id={j['id']})\")
"
fi

# Always fetch the zip of all logs for the run
TMPZIP=$(mktemp -t ios-logs.XXXX).zip
curl -sSL "${AUTH[@]}" -o "$TMPZIP" "$API/actions/runs/$RUN_ID/logs"

TMPDIR=$(mktemp -d)
unzip -q "$TMPZIP" -d "$TMPDIR"

echo ""
echo "===== Log files for run $RUN_ID ====="
find "$TMPDIR" -name '*.txt' | sort | while read -r f; do
  echo ""
  echo "----- ${f#$TMPDIR/} -----"
  # Print last 200 lines of each step's log (keeps output manageable)
  tail -n 200 "$f"
done

rm -rf "$TMPZIP" "$TMPDIR"
