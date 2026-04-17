#!/usr/bin/env bash
# Trigger an iOS build on the Mac mini self-hosted runner and watch it
# until completion. Reuses the GITHUB_API_TOKEN that CLAUDE.md already
# requires to be available in the environment.
#
# Usage:
#   scripts/ios/build.sh [--env dev|prod] [--skip-upload] [--ref <branch|sha>]
#
# Examples:
#   scripts/ios/build.sh                       # build current branch
#   scripts/ios/build.sh --env prod            # force production URL
#   scripts/ios/build.sh --skip-upload         # build only, no TestFlight
set -euo pipefail

REPO="samcarey/whoeverwants"
WORKFLOW="ios-build.yml"

CAP_ENV=""
SKIP_UPLOAD="false"
REF="$(git rev-parse --abbrev-ref HEAD)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) CAP_ENV="$2"; shift 2 ;;
    --skip-upload) SKIP_UPLOAD="true"; shift ;;
    --ref) REF="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "${GITHUB_API_TOKEN:-}" ]]; then
  echo "ERROR: GITHUB_API_TOKEN not set" >&2
  exit 1
fi

AUTH=(-H "Authorization: token $GITHUB_API_TOKEN" -H "Accept: application/vnd.github+json")
API="https://api.github.com/repos/$REPO"

echo "Dispatching iOS build on ref=$REF env='${CAP_ENV:-auto}' skip_upload=$SKIP_UPLOAD"

# Record the timestamp BEFORE dispatch so we can find our specific run.
DISPATCH_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

curl -sS -X POST "${AUTH[@]}" \
  "$API/actions/workflows/$WORKFLOW/dispatches" \
  -d "$(python3 -c "
import json,sys
inputs = {}
if '$CAP_ENV': inputs['cap_env'] = '$CAP_ENV'
if '$SKIP_UPLOAD' == 'true': inputs['skip_upload'] = 'true'
print(json.dumps({'ref': '$REF', 'inputs': inputs}))
")"

echo "Waiting for the run to appear..."
RUN_ID=""
for i in {1..30}; do
  sleep 2
  RUN_ID=$(curl -sS "${AUTH[@]}" \
    "$API/actions/workflows/$WORKFLOW/runs?branch=$REF&event=workflow_dispatch&per_page=5" \
    | python3 -c "
import json,sys,datetime
d = json.load(sys.stdin)
threshold = '$DISPATCH_TIME'
for r in d.get('workflow_runs', []):
    if r['created_at'] >= threshold:
        print(r['id']); break
")
  if [[ -n "$RUN_ID" ]]; then break; fi
done

if [[ -z "$RUN_ID" ]]; then
  echo "ERROR: could not find the dispatched run after 60s" >&2
  exit 1
fi

echo "Run ID: $RUN_ID"
echo "URL: https://github.com/$REPO/actions/runs/$RUN_ID"

echo "Polling status every 15s..."
while true; do
  STATUS_JSON=$(curl -sS "${AUTH[@]}" "$API/actions/runs/$RUN_ID")
  STATUS=$(echo "$STATUS_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','?'))")
  CONCLUSION=$(echo "$STATUS_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('conclusion') or '')")
  echo "  [$(date +%H:%M:%S)] status=$STATUS conclusion=$CONCLUSION"
  if [[ "$STATUS" == "completed" ]]; then
    if [[ "$CONCLUSION" == "success" ]]; then
      echo "✓ Build succeeded"
      exit 0
    else
      echo "✗ Build failed (conclusion=$CONCLUSION)"
      echo "Fetching failed step logs..."
      scripts/ios/logs.sh "$RUN_ID" || true
      exit 1
    fi
  fi
  sleep 15
done
