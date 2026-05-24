#!/usr/bin/env bash
#
# Fire the server-local notification tick once. Installed as a per-minute
# crontab entry by scripts/provision-droplet.sh.
#
# The app computes "poll closed" / "prephase over" lazily on read — nothing
# else acts on deadlines passing. This tick is the only thing that closes
# past-deadline polls authoritatively and sends the poll-closed +
# phase-transition push notifications. The endpoint is idempotent (each event
# is claimed via an atomic UPDATE), so overlapping runs are safe.
#
# The bearer secret is read from .env.api so the cron and the API container
# share one value. Missing secret => no-op (the API would 503 anyway).

set -euo pipefail

ENV_FILE="${ENV_FILE:-/root/whoeverwants/.env.api}"
API_URL="${INTERNAL_TICK_URL:-http://localhost:8000/api/internal/tick}"

SECRET="$(grep -E '^INTERNAL_TICK_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
if [ -z "${SECRET:-}" ]; then
  echo "$(date -u +%FT%TZ) INTERNAL_TICK_SECRET not set in $ENV_FILE; skipping"
  exit 0
fi

RESPONSE="$(curl -fsS -X POST "$API_URL" \
  -H "Authorization: Bearer ${SECRET}" \
  --max-time 30 2>&1 || true)"
echo "$(date -u +%FT%TZ) tick -> ${RESPONSE}"
