#!/usr/bin/env bash
# Fetch logs for an iOS build run. With --failed-only, only the failing
# job's logs are downloaded (via the per-job API endpoint) — much cheaper
# than grabbing the whole run's zip.
#
# Usage:
#   scripts/ios/logs.sh                  # latest run on ios-build.yml
#   scripts/ios/logs.sh <run_id>         # specific run
#   scripts/ios/logs.sh --failed-only    # only failing jobs
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
    | python3 -c "
import json, sys
runs = json.load(sys.stdin).get('workflow_runs', [])
if not runs:
    sys.exit('no runs found')
print(runs[0]['id'])")
  echo "Latest run: $RUN_ID"
fi

if [[ "$FAILED_ONLY" == "true" ]]; then
  JOBS=$(curl -sS "${AUTH[@]}" "$API/actions/runs/$RUN_ID/jobs")
  FAILED_IDS=$(echo "$JOBS" | python3 -c "
import json, sys
for j in json.load(sys.stdin).get('jobs', []):
    if j.get('conclusion') == 'failure':
        print(j['id'], j['name'])")
  if [[ -z "$FAILED_IDS" ]]; then
    echo "No failed jobs in run $RUN_ID"
    exit 0
  fi
  while IFS= read -r line; do
    jid=$(echo "$line" | cut -d' ' -f1)
    jname=$(echo "$line" | cut -d' ' -f2-)
    echo ""
    echo "===== FAILED JOB: $jname (id=$jid) ====="
    curl -sSL "${AUTH[@]}" "$API/actions/jobs/$jid/logs" | tail -n 400
  done <<< "$FAILED_IDS"
  exit 0
fi

TMPZIP=$(mktemp -t ios-logs.XXXX).zip
curl -sSL "${AUTH[@]}" -o "$TMPZIP" "$API/actions/runs/$RUN_ID/logs"

TMPDIR=$(mktemp -d)
unzip -q "$TMPZIP" -d "$TMPDIR"

echo ""
echo "===== Log files for run $RUN_ID ====="
find "$TMPDIR" -name '*.txt' | sort | while read -r f; do
  echo ""
  echo "----- ${f#$TMPDIR/} -----"
  tail -n 200 "$f"
done

rm -rf "$TMPZIP" "$TMPDIR"
