#!/bin/bash
# Entrypoint for per-branch dev-server containers.
#
# First-run behaviour (empty /repo volume):
#   - git clone REPO_URL /repo
#   - git checkout BRANCH
#   - npm ci
#   - cd server && uv sync
#
# Subsequent runs (volume already populated):
#   - git fetch + reset to origin/BRANCH
#   - npm ci only if package-lock.json hash changed
#   - uv sync only if server/pyproject.toml hash changed
#
# Then start Next.js (port 3000) + FastAPI (port 8000) in the background and
# write /repo/.dev-server-ready once both are responsive. tini (PID 1) reaps
# the children when the container stops.
#
# Required env: BRANCH, REPO_URL, DATABASE_URL, PYTHON_API_URL, SLUG

set -euo pipefail

REPO=/repo
PORT="${PORT:-3000}"
API_PORT="${API_PORT:-8000}"

log() { echo "[entrypoint $(date -u +%H:%M:%SZ)] $*"; }

cd /

if [ ! -d "$REPO/.git" ]; then
  log "First run: cloning $REPO_URL into $REPO"
  # Wipe any stray state in the volume from a prior aborted run. find -delete
  # handles an empty dir cleanly; brace+glob expansions fail under set -u when
  # the dir is empty.
  find "$REPO" -mindepth 1 -delete 2>/dev/null || true
  git clone --depth 50 "$REPO_URL" "$REPO"
fi

cd "$REPO"

OLD_LOCK_HASH=""
OLD_PYP_HASH=""
[ -f package-lock.json ] && OLD_LOCK_HASH=$(md5sum package-lock.json | cut -d' ' -f1)
[ -f server/pyproject.toml ] && OLD_PYP_HASH=$(md5sum server/pyproject.toml | cut -d' ' -f1)

log "Fetching origin/$BRANCH"
git fetch origin "$BRANCH" --depth 50
git reset --hard HEAD
git clean -fd
git checkout -B "$BRANCH" FETCH_HEAD
git reset --hard FETCH_HEAD

NEW_LOCK_HASH=""
NEW_PYP_HASH=""
[ -f package-lock.json ] && NEW_LOCK_HASH=$(md5sum package-lock.json | cut -d' ' -f1)
[ -f server/pyproject.toml ] && NEW_PYP_HASH=$(md5sum server/pyproject.toml | cut -d' ' -f1)

if [ ! -d node_modules ] || [ "$OLD_LOCK_HASH" != "$NEW_LOCK_HASH" ]; then
  log "Installing JS deps (npm ci)"
  npm ci --prefer-offline 2>&1 | tail -5
fi

if [ ! -d server/.venv ] || [ "$OLD_PYP_HASH" != "$NEW_PYP_HASH" ]; then
  log "Installing Python deps (uv sync)"
  (cd server && uv sync --quiet 2>&1 | tail -3) || true
fi

# Re-run migrations the manager already applied? No — manager handles it. We
# just signal readiness once both processes are listening.

# --- Spawn API server in background ----------------------------------------
log "Starting FastAPI on port $API_PORT"
(
  cd "$REPO/server"
  DISABLE_RATE_LIMIT=1 \
    uv run uvicorn main:app --host 0.0.0.0 --port "$API_PORT" --workers 1 \
    >> "$REPO/api.log" 2>&1
) &
API_PID=$!

# --- Spawn Next.js in background ------------------------------------------
log "Starting Next.js on port $PORT"
GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
(
  cd "$REPO"
  PYTHON_API_URL="$PYTHON_API_URL" \
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA="$GIT_SHA" \
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF="$BRANCH" \
  HOSTNAME=0.0.0.0 \
    npm run dev -- -p "$PORT" \
    >> "$REPO/nextjs.log" 2>&1
) &
FE_PID=$!

# --- Wait for both to respond ---------------------------------------------
log "Waiting for both servers to come up (up to 300s)..."
rm -f "$REPO/.dev-server-ready"
deadline=$(( $(date +%s) + 300 ))
fe_ok=0
api_ok=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ "$api_ok" = 0 ] && curl -sf "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
    api_ok=1
    log "  API is up."
  fi
  if [ "$fe_ok" = 0 ] && curl -sf "http://localhost:${PORT}/" >/dev/null 2>&1; then
    fe_ok=1
    log "  Frontend is up."
  fi
  if [ "$fe_ok" = 1 ] && [ "$api_ok" = 1 ]; then
    break
  fi
  # If either crashed, fail fast
  if ! kill -0 "$API_PID" 2>/dev/null; then
    log "ERROR: API process died. Tail of api.log:"
    tail -30 "$REPO/api.log" >&2 || true
    exit 1
  fi
  if ! kill -0 "$FE_PID" 2>/dev/null; then
    log "ERROR: Next.js process died. Tail of nextjs.log:"
    tail -30 "$REPO/nextjs.log" >&2 || true
    exit 1
  fi
  sleep 3
done

if [ "$fe_ok" = 1 ] && [ "$api_ok" = 1 ]; then
  touch "$REPO/.dev-server-ready"
  log "READY: $SLUG.dev.whoeverwants.com"
else
  log "WARNING: bootstrap timed out (api_ok=$api_ok fe_ok=$fe_ok). Container stays up so logs can be read."
fi

# Block forever; if either child exits, kill the other and propagate
wait -n "$API_PID" "$FE_PID"
exit_code=$?
log "A child process exited ($exit_code), shutting down siblings"
kill -TERM "$API_PID" "$FE_PID" 2>/dev/null || true
wait
exit "$exit_code"
