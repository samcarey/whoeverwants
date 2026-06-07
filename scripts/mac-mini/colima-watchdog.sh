#!/bin/sh
# /usr/local/bin/colima-watchdog.sh on the Mac mini.
#
# The VM-level analog of caddy-watchdog.sh. Polled every 60s by
# com.whoeverwants.colima-watchdog (a LaunchDaemon that runs AS the devbox
# owner so `colima`/`docker` resolve the per-user VM state under
# /Users/<owner>/.colima). Keeps the devbox Colima VM alive and self-heals a
# wedged instance so a VM crash no longer leaves every *.dev.whoeverwants.com
# host 502 until someone SSHes in and runs colima by hand.
#
# Probe: the devbox Docker daemon answers `docker ps` over its UNIX socket —
# the true "is the dev infra usable?" signal (mirrors caddy-watchdog probing
# :443 rather than just pgrep). It fails iff the VM is DOWN or Docker is
# WEDGED, which are exactly the states to recover. A single down per-branch
# container does NOT fail it (Docker still answers) — restarting one container
# is dev-server-manager's job, not the VM watchdog's.
#
# Recovery is the exact manual sequence that cleared the 2026-06 outage:
#   colima stop -f       graceful/forced stop
#   pkill -f colima-<p>  kill the zombie lima/vz process still holding the disk
#                        image lock after an UNCLEAN exit. Without this a plain
#                        `colima start` fails with:
#                          "failed to attach disk \"colima-<p>\", in use by
#                           instance \"colima-<p>\""
#   colima start         boot; the compose services (cmd-api, webhook,
#                        postgres) AND every per-branch dev container
#                        auto-restart on boot.
#
# No lock is needed against an overlapping recovery: launchd serializes a
# StartInterval job (it never launches a second copy while the prior run is
# still alive), so even a ~40s recovery can't overlap the next 60s tick —
# same guarantee caddy-watchdog.sh relies on. Logs only on recovery to
# ~/Library/Logs/colima-watchdog.log; quiet (single `docker ps`, early exit)
# otherwise.

set -u

PROFILE="devbox"
COLIMA="/opt/homebrew/bin/colima"
DOCKER="/opt/homebrew/bin/docker"
SOCK="$HOME/.colima/$PROFILE/docker.sock"
LOG="$HOME/Library/Logs/colima-watchdog.log"

ts() { /bin/date '+%Y-%m-%dT%H:%M:%S%z'; }
# Lazy log-dir creation keeps the healthy fast-path to a single `docker ps`.
log() { mkdir -p "$(dirname "$LOG")" 2>/dev/null || true; echo "$(ts) $*" >> "$LOG"; }

healthy() {
  DOCKER_HOST="unix://$SOCK" "$DOCKER" ps >/dev/null 2>&1
}

# Healthy → nothing to do. Re-probe once after a short pause so a transient
# blip (Docker momentarily busy) can't bounce a perfectly good VM.
healthy && exit 0
sleep 5
healthy && exit 0

log "devbox VM/Docker unreachable — recovering"
"$COLIMA" stop -p "$PROFILE" -f >>"$LOG" 2>&1 || true
/usr/bin/pkill -f "colima-$PROFILE" || true
sleep 3
if "$COLIMA" start -p "$PROFILE" >>"$LOG" 2>&1; then
  if healthy; then
    log "devbox VM recovered (Docker reachable)"
  else
    log "colima start returned but Docker still unreachable — retry next tick"
  fi
else
  log "colima start FAILED — manual intervention may be needed"
fi
