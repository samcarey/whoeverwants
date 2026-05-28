#!/bin/sh
# /usr/local/bin/caddy-watchdog.sh on the Mac mini.
#
# Polled every 60s by com.whoeverwants.caddy-watchdog (system LaunchDaemon).
# Probes (a) the caddy process exists AND (b) it accepts TCP on 127.0.0.1:443.
# Either fail -> launchctl kickstart Caddy back up.
#
# Catches three failure modes that Homebrew's stock plist
# (KeepAlive = { SuccessfulExit: false }) misses:
#   1. Clean SIGTERM exits (App Nap, manual stop, system trigger).
#   2. launchd crash-loop throttling (after N rapid restarts, launchd gives up).
#   3. Hung-but-running (process alive, socket dead).
#
# Logs only on restart events to /var/log/caddy-watchdog.log; quiet otherwise.

TS=$(/bin/date '+%Y-%m-%d %H:%M:%S')

if /usr/bin/pgrep -x caddy >/dev/null && /usr/bin/nc -z -w 2 127.0.0.1 443 >/dev/null 2>&1; then
  exit 0
fi

echo "$TS caddy down, kickstarting" >> /var/log/caddy-watchdog.log
/bin/launchctl kickstart -k system/homebrew.mxcl.caddy
