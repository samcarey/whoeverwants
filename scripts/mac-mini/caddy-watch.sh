#!/bin/bash
# Caddy snippet directory watcher (Mac mini side).
#
# Polls ~/devbox/caddy.d/ every 5 seconds; when the directory's content hash
# changes (any file added/modified/removed), runs `sudo brew services reload caddy`.
#
# Why not Caddy admin API? The dev-server-manager runs inside the Colima VM
# and the admin socket is Mac-localhost-only by default. Polling is simple and
# avoids cross-boundary auth.
#
# Why not fswatch? Polling at 5s is a sub-second latency improvement over
# launchd's "rerun every N seconds" but adds an external dep. We chose simpler.

set -uo pipefail

CADDY_DIR="${HOME}/devbox/caddy.d"
STATE_FILE="${HOME}/devbox/.caddy-watch.hash"
LOG_FILE="${HOME}/Library/Logs/caddy-watch.log"

mkdir -p "$CADDY_DIR"
touch "$STATE_FILE"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"; }

current_hash() {
  # Hash filenames + content of every *.caddy in the directory
  if ls "$CADDY_DIR"/*.caddy >/dev/null 2>&1; then
    # shellcheck disable=SC2012
    ls "$CADDY_DIR"/*.caddy | sort | xargs cat 2>/dev/null | md5
  else
    echo "empty"
  fi
}

NEW=$(current_hash)
OLD=$(cat "$STATE_FILE" 2>/dev/null || echo "")

if [ "$NEW" = "$OLD" ]; then
  exit 0
fi

log "Caddy snippets changed (old=$OLD new=$NEW), reloading"
echo "$NEW" > "$STATE_FILE"

# `caddy reload` talks to the admin API on localhost:2019 (non-privileged).
# Caddy daemon is running as root (sudo-loaded LaunchDaemon to bind :80/:443)
# but admin API listens unauthenticated on localhost so any user can reload.
if /opt/homebrew/bin/caddy reload --config /opt/homebrew/etc/Caddyfile 2>>"$LOG_FILE"; then
  log "  reload OK"
else
  log "  caddy reload failed — config may be invalid"
fi
