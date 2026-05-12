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

# Cheap change detector: dir-mtime + per-file mtime+name. Any add/remove/modify
# of a *.caddy file bumps the dir's mtime; per-file mtimes catch in-place edits.
# Reading content (cat | md5) costs ~5 processes per tick when nothing changed,
# and this runs every 5s.
current_sig() {
  stat -f '%m %N' "$CADDY_DIR" "$CADDY_DIR"/*.caddy 2>/dev/null | md5
}

NEW=$(current_sig)
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
