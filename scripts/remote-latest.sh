#!/bin/bash
# Remote command execution on the WhoeverWants "latest" (pre-prod canary) droplet.
#
# Same protocol as scripts/remote.sh (which targets the prod droplet); only the
# env-var names differ so both droplets can be addressed from one shell.
#
# Usage: bash scripts/remote-latest.sh "command to run" [cwd] [timeout_seconds]
#
# Requires env vars:
#   LATEST_DROPLET_API_URL   - HTTPS endpoint (e.g., https://1-2-3-4.sslip.io)
#   LATEST_DROPLET_API_TOKEN - Bearer token for authentication
#
# Examples:
#   bash scripts/remote-latest.sh "hostname"
#   bash scripts/remote-latest.sh "cd /root/whoeverwants && git pull" /root 60
#   bash scripts/remote-latest.sh "docker compose logs --tail 50" /root/whoeverwants

set -euo pipefail

if [ -z "${LATEST_DROPLET_API_URL:-}" ] || [ -z "${LATEST_DROPLET_API_TOKEN:-}" ]; then
  # Try loading from .env in project root
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ENV_FILE="$SCRIPT_DIR/../.env"
  if [ -f "$ENV_FILE" ]; then
    export $(grep -E '^LATEST_DROPLET_API_(URL|TOKEN)=' "$ENV_FILE" | xargs)
  fi
fi

if [ -z "${LATEST_DROPLET_API_URL:-}" ] || [ -z "${LATEST_DROPLET_API_TOKEN:-}" ]; then
  echo "ERROR: LATEST_DROPLET_API_URL and LATEST_DROPLET_API_TOKEN must be set (in env or .env)" >&2
  exit 1
fi

CMD="${1:-echo hello}"
CWD="${2:-/root}"
TIMEOUT="${3:-120}"

PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({'cmd': sys.argv[1], 'cwd': sys.argv[2], 'timeout': int(sys.argv[3])}))
" "$CMD" "$CWD" "$TIMEOUT")

curl -s -X POST "$LATEST_DROPLET_API_URL" \
  -H "Authorization: Bearer $LATEST_DROPLET_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | python3 -c "
import sys, json
r = json.load(sys.stdin)
if r['stdout']: print(r['stdout'], end='')
if r['stderr']: print('STDERR:', r['stderr'], end='')
if r['exit_code'] != 0: print(f'\n[exit code: {r[\"exit_code\"]}]')
"
