#!/bin/bash
# Remote command execution on the Mac mini Colima VM.
#
# Usage: bash scripts/remote-mac.sh "command to run" [cwd] [timeout_seconds]
#
# Requires env vars (or .env at project root):
#   MAC_API_URL    - HTTPS endpoint (e.g., https://cmd-api.dev.whoeverwants.com)
#   MAC_API_TOKEN  - Bearer token for authentication
#
# Default cwd is "/" — the cmd-api container's working directory. Pass a
# different cwd to operate against a mounted host volume (e.g., /host-caddy.d).
#
# Examples:
#   bash scripts/remote-mac.sh "hostname && docker ps"
#   bash scripts/remote-mac.sh "bash /opt/dev-server-manager.sh list"
#   bash scripts/remote-mac.sh "docker logs whoeverwants-dev-claude-migrate-foo --tail 50"

set -euo pipefail

if [ -z "${MAC_API_URL:-}" ] || [ -z "${MAC_API_TOKEN:-}" ]; then
  # Load only MAC_API_URL/MAC_API_TOKEN from .env. Plain read avoids `eval`
  # (which would evaluate command-substitutions / backticks in values).
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ENV_FILE="$SCRIPT_DIR/../.env"
  if [ -f "$ENV_FILE" ]; then
    while IFS='=' read -r k v; do
      case "$k" in
        MAC_API_URL)   export MAC_API_URL="${MAC_API_URL:-$v}" ;;
        MAC_API_TOKEN) export MAC_API_TOKEN="${MAC_API_TOKEN:-$v}" ;;
      esac
    done < "$ENV_FILE"
  fi
fi

# Default URL if not set (token still required)
: "${MAC_API_URL:=https://cmd-api.dev.whoeverwants.com}"

if [ -z "${MAC_API_TOKEN:-}" ]; then
  echo "ERROR: MAC_API_TOKEN must be set (in env or .env)" >&2
  echo "  Find it in ~/devbox/.env on the Mac mini (CMD_API_TOKEN value)." >&2
  exit 1
fi

CMD="${1:-echo hello}"
CWD="${2:-/}"
TIMEOUT="${3:-120}"

PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({'cmd': sys.argv[1], 'cwd': sys.argv[2], 'timeout': int(sys.argv[3])}))
" "$CMD" "$CWD" "$TIMEOUT")

curl -s -X POST "$MAC_API_URL/" \
  -H "Authorization: Bearer $MAC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | python3 -c "
import sys, json
r = json.load(sys.stdin)
if r['stdout']: print(r['stdout'], end='')
if r['stderr']: print('STDERR:', r['stderr'], end='')
if r['exit_code'] != 0: print(f'\n[exit code: {r[\"exit_code\"]}]')
"
