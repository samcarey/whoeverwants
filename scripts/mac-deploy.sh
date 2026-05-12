#!/bin/bash
# scripts/mac-deploy.sh — copy a file from this checkout to the Mac mini.
#
# Usage: bash scripts/mac-deploy.sh <local-path> <mac-path> [mode]
#
# The Mac path is anywhere under /Users (Colima auto-mounts /Users into the VM).
# Common targets:
#   /Users/sccarey/devbox/...
#   /Users/sccarey/Library/LaunchAgents/...
#
# Requires MAC_API_URL + MAC_API_TOKEN in env (or .env).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${MAC_API_URL:-}" ] || [ -z "${MAC_API_TOKEN:-}" ]; then
  ENV_FILE="$SCRIPT_DIR/../.env"
  if [ -f "$ENV_FILE" ]; then
    set +u
    eval "$(grep -E '^MAC_API_(URL|TOKEN)=' "$ENV_FILE" | sed 's/^/export /')"
    set -u
  fi
fi
: "${MAC_API_URL:=https://cmd-api.dev.whoeverwants.com}"
if [ -z "${MAC_API_TOKEN:-}" ]; then
  echo "ERROR: MAC_API_TOKEN must be set" >&2
  exit 1
fi

LOCAL="${1:?Usage: mac-deploy.sh <local-path> <mac-path> [mode]}"
MAC_PATH="${2:?Usage: mac-deploy.sh <local-path> <mac-path> [mode]}"
MODE="${3:-644}"

if [ ! -f "$LOCAL" ]; then
  echo "ERROR: local file not found: $LOCAL" >&2
  exit 1
fi

# Sanity check: the mac path must be under /Users (only mounted prefix)
case "$MAC_PATH" in
  /Users/*) ;;
  *) echo "ERROR: mac-path must start with /Users/ (got: $MAC_PATH)" >&2; exit 1 ;;
esac

B64=$(base64 -w0 < "$LOCAL")
DIR=$(dirname "$MAC_PATH")

# We spawn an alpine container with /Users mounted, then decode the base64
# payload into the target path. atomic via temp-file + mv. chmod afterwards.
CMD="docker run --rm -v /Users:/host-users alpine sh -c '
set -e
mkdir -p \"/host-users${DIR#/Users}\"
echo \"$B64\" | base64 -d > \"/host-users${MAC_PATH#/Users}.tmp\"
mv \"/host-users${MAC_PATH#/Users}.tmp\" \"/host-users${MAC_PATH#/Users}\"
chmod $MODE \"/host-users${MAC_PATH#/Users}\"
'"

PAYLOAD=$(python3 -c "import json,sys;print(json.dumps({'cmd':sys.argv[1],'cwd':'/','timeout':60}))" "$CMD")

RESP=$(curl -s -X POST "$MAC_API_URL/" \
  -H "Authorization: Bearer $MAC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

EXIT=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['exit_code'])")
if [ "$EXIT" != "0" ]; then
  echo "ERROR: deploy failed:" >&2
  echo "$RESP" | python3 -c "import json,sys;r=json.load(sys.stdin);print(r.get('stderr',''),r.get('stdout',''))" >&2
  exit 1
fi
echo "deployed: $LOCAL -> $MAC_PATH ($MODE)"
