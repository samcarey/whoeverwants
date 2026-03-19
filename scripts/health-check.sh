#!/bin/bash
# Health check script for the WhoeverWants droplet.
#
# Checks all critical services and optionally sends alerts via Pushover.
# Designed to run as a cron job (e.g., every 5 minutes).
#
# Usage (cron):
#   */5 * * * * /root/whoeverwants/scripts/health-check.sh >> /var/log/whoeverwants-health.log 2>&1
#
# Environment variables (optional, for push notifications):
#   PUSHOVER_USER_KEY  - Pushover user key
#   PUSHOVER_API_TOKEN - Pushover application token

set -euo pipefail

ALERT_FILE="/tmp/whoeverwants-alert-sent"
FAILURES=()

check_service() {
  local name="$1"
  local check_cmd="$2"
  if ! eval "$check_cmd" > /dev/null 2>&1; then
    FAILURES+=("$name")
  fi
}

# Check FastAPI (via health endpoint)
check_service "FastAPI" "curl -sf --max-time 5 http://localhost:8000/health | grep -q '\"ok\"'"

# Check Next.js
check_service "Next.js" "curl -sf --max-time 5 -o /dev/null http://localhost:3000/"

# Check PostgreSQL (via Docker)
check_service "PostgreSQL" "docker exec whoeverwants-db-1 pg_isready -U whoeverwants"

# Check Caddy
check_service "Caddy" "systemctl is-active --quiet caddy"

# Check Docker
check_service "Docker" "systemctl is-active --quiet docker"

# Check disk space (alert if >90% used)
DISK_PCT=$(df / --output=pcent | tail -1 | tr -d ' %')
if [ "$DISK_PCT" -gt 90 ]; then
  FAILURES+=("Disk(${DISK_PCT}%)")
fi

if [ ${#FAILURES[@]} -eq 0 ]; then
  # All healthy — remove alert file so next failure triggers a new alert
  rm -f "$ALERT_FILE"
  echo "[$(date -Iseconds)] OK - all services healthy"
  exit 0
fi

# Something failed
FAIL_MSG="WhoeverWants ALERT: ${FAILURES[*]} down"
echo "[$(date -Iseconds)] FAIL - $FAIL_MSG"

# Only send one alert per failure episode (don't spam every 5 min)
if [ -f "$ALERT_FILE" ]; then
  echo "[$(date -Iseconds)] Alert already sent, skipping notification"
  exit 1
fi

touch "$ALERT_FILE"

# Try to auto-recover common issues
for svc in "${FAILURES[@]}"; do
  case "$svc" in
    "Next.js")
      echo "[$(date -Iseconds)] Attempting Next.js restart..."
      systemctl restart whoeverwants-web 2>/dev/null || true
      ;;
    "FastAPI"|"PostgreSQL")
      echo "[$(date -Iseconds)] Attempting Docker Compose restart..."
      cd /root/whoeverwants && docker compose up -d 2>/dev/null || true
      ;;
    "Caddy")
      echo "[$(date -Iseconds)] Attempting Caddy restart..."
      systemctl restart caddy 2>/dev/null || true
      ;;
  esac
done

# Send Pushover notification if configured
if [ -n "${PUSHOVER_USER_KEY:-}" ] && [ -n "${PUSHOVER_API_TOKEN:-}" ]; then
  curl -sf -X POST https://api.pushover.net/1/messages.json \
    -d "token=${PUSHOVER_API_TOKEN}" \
    -d "user=${PUSHOVER_USER_KEY}" \
    -d "title=WhoeverWants Down" \
    -d "message=${FAIL_MSG}" \
    -d "priority=1" \
    > /dev/null 2>&1 || echo "[$(date -Iseconds)] Failed to send Pushover alert"
fi

exit 1
