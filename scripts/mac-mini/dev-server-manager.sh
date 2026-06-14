#!/bin/bash
# Per-BRANCH full-stack dev server manager for the Mac mini Colima VM.
#
# Architecture (differs from the droplet version — see scripts/dev-server-manager.sh
# for that file's docs):
#   - Each open branch gets ONE Docker container: whoeverwants-dev-<slug>
#   - Inside the container: Next.js (port 3000) + FastAPI (port 8000) run together
#   - Container publishes Next.js to 127.0.0.1:<HOST_PORT> in the VM; Colima
#     forwards the same port to Mac localhost
#   - PostgreSQL is the shared devbox postgres container; one DB per branch
#   - Caddy snippets are written to /host-caddy.d/ (a colima mount from Mac's
#     ~/devbox/caddy.d/); a launchd watcher on the Mac runs `caddy reload`
#     when snippets change
#
# Runtime environment:
#   - This script runs INSIDE the cmd-api / webhook container in the Colima VM
#   - It uses the Docker socket (mounted from the VM into cmd-api) to spawn
#     per-branch dev-server containers as siblings
#
# Usage (driven from outside via bash scripts/remote-mac.sh):
#   dev-server-manager.sh upsert <branch>
#   dev-server-manager.sh destroy <branch>
#   dev-server-manager.sh destroy-slug <branch-slug>
#   dev-server-manager.sh list
#   dev-server-manager.sh destroy-all
#   dev-server-manager.sh cleanup [days]
#   dev-server-manager.sh revive
#
# Branch-to-slug mapping (DNS-label-safe, ≤50 chars):
#   claude/migrate-foo       -> claude-migrate-foo
#   feature/UPPERCASE-bug    -> feature-uppercase-bug
#   release/v1.2.3           -> release-v1-2-3
#
# The `main` branch is explicitly skipped (production lives on the droplet;
# a long-lived `main.dev.whoeverwants.com` would never expire via 7d-idle).

set -euo pipefail

# --- Configuration -----------------------------------------------------------

# Where Caddy snippets land. The cmd-api container mounts this from the VM at
# the same path; the VM gets it from the Mac via colima --mount; the Mac's
# launchd watcher polls and reloads Caddy on changes.
CADDY_DEV_DIR="/host-caddy.d"

# Per-branch repo state and logs land in a per-slug Docker named volume,
# mounted at /repo inside each dev-server container. Stop+restart preserves
# node_modules / .venv / .next; destroy drops the volume.
#
# DEV_*_PREFIX is also used by `list` and `destroy-all` to identify our
# containers/volumes (they share the prefix in their names).
DEV_CONTAINER_PREFIX="whoeverwants-dev"
DEV_REPO_VOLUME_PREFIX="whoeverwants-dev-repo"
DEV_IMAGE="whoeverwants-devserver:latest"

REPO_URL="https://github.com/samcarey/whoeverwants.git"
FRONTEND_PORT_START=3001
MAX_DEV_SERVERS=15
# One published host port per dev server. Derive the range end from the
# server cap so the two can't drift out of sync (a smaller range than the
# cap would let eviction admit a server with no free port to bind).
FRONTEND_PORT_MAX=$((FRONTEND_PORT_START + MAX_DEV_SERVERS - 1))

# Slug length cap. A DNS label maxes out at 63 chars; we reserve plenty of
# headroom for the `.dev.whoeverwants.com` suffix and for container/volume
# name decoration.
MAX_SLUG_LEN=50

# Shared docker network everyone joins (the devbox-net created by ~/devbox/docker-compose.yml)
DEVBOX_NET="devbox_devbox-net"
# The shared postgres container name (set by docker compose; "devbox" is the
# project name derived from ~/devbox/). Confirm via `docker ps --filter name=postgres`.
DB_CONTAINER="devbox-postgres-1"
DB_USER="whoeverwants"
DB_NAME_PREFIX="dev_"

# Branches we never spin a dev server for. `main` is the prod branch (lives on
# the droplet) and would never age out under the 7d-idle policy.
SKIP_BRANCHES=("main")

LOCK_DIR="/tmp/dev-server-locks"
LOG_FILE="/var/log/dev-server-manager.log"

# --- Logging -----------------------------------------------------------------

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" >&2
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

# --- Slug + name helpers -----------------------------------------------------

# Convert a branch name to a DNS-label-safe slug.
#   - lowercase
#   - replace any char not in [a-z0-9-] with '-'
#   - collapse runs of '-'
#   - trim leading / trailing '-'
#   - truncate to MAX_SLUG_LEN (then re-trim trailing '-')
branch_to_slug() {
  local slug
  slug=$(echo "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+|-+$//g')
  if [ "${#slug}" -gt "$MAX_SLUG_LEN" ]; then
    slug="${slug:0:$MAX_SLUG_LEN}"
    slug="${slug%-}"
  fi
  echo "$slug"
}

slug_to_dbname() {
  echo "${DB_NAME_PREFIX}${1//-/_}"
}

slug_to_container() {
  echo "${DEV_CONTAINER_PREFIX}-$1"
}

slug_to_volume() {
  echo "${DEV_REPO_VOLUME_PREFIX}-$1"
}

is_skipped_branch() {
  local branch="$1"
  local skip
  for skip in "${SKIP_BRANCHES[@]}"; do
    [ "$branch" = "$skip" ] && return 0
  done
  return 1
}

# --- Port allocation ---------------------------------------------------------

# Read the published host port off an existing container's port mapping.
# Returns "" if the container doesn't exist or has no published port for 3000/tcp.
get_container_port() {
  local container="$1"
  docker port "$container" 3000/tcp 2>/dev/null | head -1 | sed 's/.*://' || true
}

# Find a free port in [start, max] that isn't published by any dev-server container.
find_available_port() {
  local start="$1"
  local max="$2"
  # Gather all ports already claimed by other dev-server containers
  local used
  used=$(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" --format '{{.Names}}' \
    | while read -r c; do
        docker port "$c" 3000/tcp 2>/dev/null | head -1 | sed 's/.*://'
      done | sort -u)
  for port in $(seq "$start" "$max"); do
    if ! echo "$used" | grep -qx "$port"; then
      echo "$port"
      return 0
    fi
  done
  log "ERROR: No available ports in range $start-$max"
  return 1
}

# --- Database management -----------------------------------------------------

# Run psql against the shared postgres container, optionally targeting a DB.
psql_exec() {
  local db="${1:-postgres}"
  local sql="$2"
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$db" -tAc "$sql" 2>/dev/null
}

create_dev_database() {
  local db_name="$1"
  local exists
  exists=$(psql_exec postgres "SELECT 1 FROM pg_database WHERE datname = '$db_name';" || echo "")
  if [ "$exists" != "1" ]; then
    log "  Creating database: $db_name"
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -c "CREATE DATABASE \"$db_name\";" >/dev/null
  fi
}

drop_dev_database() {
  local db_name="$1"
  local exists
  exists=$(psql_exec postgres "SELECT 1 FROM pg_database WHERE datname = '$db_name';" || echo "")
  if [ "$exists" = "1" ]; then
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db_name' AND pid <> pg_backend_pid();" \
      >/dev/null 2>&1 || true
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -c "DROP DATABASE \"$db_name\";" >/dev/null
    log "  Dropped database: $db_name"
  fi
}

apply_dev_migrations() {
  local db_name="$1"
  local container="$2"
  log "  Applying migrations to $db_name..."
  # The dev-server container holds the current branch's checkout; apply migrations
  # from its /repo/database/migrations directory by piping each *_up.sql file into
  # the shared postgres container.
  local applied
  applied=$(psql_exec "$db_name" "SELECT filename FROM _migrations;" 2>/dev/null || echo "")
  # If _migrations doesn't exist yet, create it
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$db_name" -c "
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  " >/dev/null 2>&1
  applied=$(psql_exec "$db_name" "SELECT filename FROM _migrations;" 2>/dev/null || echo "")

  # List migration files (filenames only, sorted)
  local files
  files=$(docker exec "$container" sh -c "ls /repo/database/migrations/*_up.sql 2>/dev/null | sort")
  local pending=0
  # Loop vars declared local so this function (called from cmd_upsert's dynamic
  # scope) can't leak `f`/`basename` into a caller. `container` is already local.
  local f basename
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    basename=$(basename "$f")
    case "$basename" in
      000_*) continue ;;                      # production-only marker
      *\'*) log "ERROR: refusing migration filename with single quote: $basename"; return 1 ;;
    esac
    if echo "$applied" | grep -qxF "$basename"; then
      continue
    fi
    echo "  Applying: $basename" >&2
    docker exec "$container" cat "$f" \
      | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$db_name" >/dev/null
    # The `:'fname'` psql variable expansion fails inside `-c` (psql parses
    # the SQL server-side without expanding variables), so just interpolate
    # the basename into the SQL directly. `$basename` was validated against
    # single quotes by the `*\'*)` case above, so direct interpolation is
    # safe — no injection vector.
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$db_name" -c \
      "INSERT INTO _migrations (filename) VALUES ('$basename') ON CONFLICT DO NOTHING;" >/dev/null
    pending=$((pending + 1))
  done <<< "$files"
  if [ "$pending" -eq 0 ]; then
    echo "  All migrations already applied." >&2
  else
    echo "  Applied $pending migration(s)." >&2
  fi
}

# --- Caddy management --------------------------------------------------------

configure_caddy() {
  local slug="$1"
  local port="$2"
  mkdir -p "$CADDY_DEV_DIR"
  # Emit a host-matcher FRAGMENT, not a standalone site block. The fragment is
  # imported into the single "*.dev.whoeverwants.com" wildcard block in the main
  # Caddyfile, which holds one DNS-01/Route 53 wildcard cert covering every
  # branch host. A standalone "<slug>.dev.whoeverwants.com { ... }" block would
  # make Caddy obtain a per-hostname Let's Encrypt cert again, which is exactly
  # what blew through LE's 50-certs/week/registered-domain limit (HTTP 429 ->
  # aborted TLS handshakes -> every dev site appeared down). The matcher name
  # must be alnum/underscore (Caddy rejects '-' and '.' in @matcher names), so
  # the slug's non-alnum chars are folded to '_'.
  local mname
  mname=$(echo "$slug" | tr -c 'a-zA-Z0-9' '_')
  cat > "${CADDY_DEV_DIR}/${slug}.caddy" <<EOF
@${mname} host ${slug}.dev.whoeverwants.com
handle @${mname} {
    reverse_proxy localhost:${port}
}
EOF
  log "Caddy snippet written: ${slug}.dev.whoeverwants.com -> port $port"
  # The Mac launchd watcher (~/Library/LaunchAgents/com.devbox.caddy-watch.plist)
  # polls this directory and runs `sudo brew services reload caddy` when files
  # change. No reload signal needed from here.
}

remove_caddy() {
  local slug="$1"
  rm -f "${CADDY_DEV_DIR}/${slug}.caddy"
  log "Caddy snippet removed for $slug"
}

# --- Eviction ----------------------------------------------------------------

evict_excess_servers() {
  local current_slug="$1"
  # List all dev-server containers (running or stopped), sorted by updated_at label oldest first
  local total
  total=$(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" --format '{{.Names}}' | wc -l | tr -d ' ')

  # If the current slug already has a container, it doesn't bump the count
  local current_exists=0
  if docker inspect "$(slug_to_container "$current_slug")" >/dev/null 2>&1; then
    current_exists=1
  fi
  local effective_total="$total"
  [ "$current_exists" = 0 ] && effective_total=$((total + 1))

  if [ "$effective_total" -le "$MAX_DEV_SERVERS" ]; then
    return
  fi

  local to_evict=$((effective_total - MAX_DEV_SERVERS))
  # Sort by container label "updated_at" ascending (oldest first); skip current slug.
  # NOTE: the loop var MUST NOT be named `container` — bash is dynamically
  # scoped, and this function runs inside cmd_upsert's scope where `container`
  # holds the upserted slug's name. Aliasing it here makes cmd_upsert's later
  # `docker run --name "$container"` use the last evicted victim's name. Use
  # `victim` (declared local) so it can't clobber the caller.
  local victims victim victim_slug
  victims=$(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" \
    --format '{{.Label "updated_at"}} {{.Names}}' \
    | sort \
    | awk -v cur="$(slug_to_container "$current_slug")" '$2 != cur {print $2}')
  while IFS= read -r victim && [ "$to_evict" -gt 0 ]; do
    [ -z "$victim" ] && continue
    victim_slug="${victim#${DEV_CONTAINER_PREFIX}-}"
    log "Evicting dev server '$victim_slug' (limit: $MAX_DEV_SERVERS)"
    cmd_destroy_slug "$victim_slug"
    to_evict=$((to_evict - 1))
  done <<< "$victims"
}

# --- Commands ----------------------------------------------------------------

cmd_upsert() {
  local branch="${1:?Usage: dev-server-manager.sh upsert <branch>}"

  if is_skipped_branch "$branch"; then
    log "Skipping branch: $branch (in SKIP_BRANCHES)"
    return 0
  fi

  local slug
  slug=$(branch_to_slug "$branch")
  if [ -z "$slug" ]; then
    log "ERROR: branch '$branch' slugified to empty string; refusing to upsert"
    return 1
  fi

  local container db_name volume
  container=$(slug_to_container "$slug")
  db_name=$(slug_to_dbname "$slug")
  volume=$(slug_to_volume "$slug")

  # Lock to prevent concurrent updates for same branch
  mkdir -p "$LOCK_DIR"
  local lockfile="${LOCK_DIR}/${slug}.lock"
  exec 200>"$lockfile"
  if ! flock -n 200; then
    log "Update already in progress for $slug, skipping"
    return 0
  fi

  log "=== Upsert dev server: branch=$branch (slug: $slug) ==="

  evict_excess_servers "$slug"

  # Ensure the dev-server image exists. It's built by the devbox compose stack;
  # if missing, fail loudly with a hint instead of silently rebuilding here.
  if ! docker image inspect "$DEV_IMAGE" >/dev/null 2>&1; then
    log "ERROR: $DEV_IMAGE not found. Build it via:"
    log "  (on Mac) cd ~/devbox && docker compose build devserver-image"
    return 1
  fi

  # Create DB (idempotent)
  create_dev_database "$db_name"

  # Allocate or reuse port
  local port
  port=$(get_container_port "$container" || true)
  if [ -n "${port:-}" ]; then
    log "Reusing port $port for existing container $container"
  else
    port=$(find_available_port "$FRONTEND_PORT_START" "$FRONTEND_PORT_MAX")
    log "Allocated port $port for $container"
  fi

  # Stop + remove any prior container for this slug (we always recreate so env/labels are fresh)
  if docker inspect "$container" >/dev/null 2>&1; then
    log "Stopping existing container $container"
    docker stop --time 10 "$container" >/dev/null 2>&1 || true
    docker rm "$container" >/dev/null 2>&1 || true
  fi

  # Create the per-branch repo volume (idempotent)
  docker volume create "$volume" >/dev/null

  # Read postgres password from the postgres container (it was set via $POSTGRES_PASSWORD
  # in ~/devbox/.env; we pull it back out via env exposed on the postgres container)
  local pg_password
  pg_password=$(docker inspect "$DB_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep '^POSTGRES_PASSWORD=' | head -1 | cut -d= -f2-)
  if [ -z "$pg_password" ]; then
    log "ERROR: couldn't read POSTGRES_PASSWORD from $DB_CONTAINER"
    return 1
  fi

  local updated_at
  updated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Launch the dev-server container in detached mode
  log "Launching $container (image: $DEV_IMAGE, branch: $branch, port: $port)"
  docker run -d \
    --name "$container" \
    --restart unless-stopped \
    --network "$DEVBOX_NET" \
    --add-host host.docker.internal:host-gateway \
    -p "127.0.0.1:${port}:3000" \
    -v "${volume}:/repo" \
    -e BRANCH="$branch" \
    -e SLUG="$slug" \
    -e REPO_URL="$REPO_URL" \
    -e DATABASE_URL="postgresql://${DB_USER}:${pg_password}@${DB_CONTAINER}:5432/${db_name}" \
    -e PYTHON_API_URL="http://localhost:8000" \
    -e DISABLE_RATE_LIMIT=1 \
    -e POLL_VARIANT_LLM_URL="${POLL_VARIANT_LLM_URL:-http://host.docker.internal:11434/v1/chat/completions}" \
    -e POLL_VARIANT_LLM_MODEL="${POLL_VARIANT_LLM_MODEL:-nous-hermes2:10.7b}" \
    -e PORT=3000 \
    -e API_PORT=8000 \
    --label "whoeverwants-dev=true" \
    --label "slug=$slug" \
    --label "branch=$branch" \
    --label "host_port=$port" \
    --label "db_name=$db_name" \
    --label "updated_at=$updated_at" \
    "$DEV_IMAGE" >/dev/null

  # Belt-and-suspenders: confirm the launched container wears THIS slug's name.
  # If a dynamic-scoping bug ever reintroduces the eviction clobber, fail loudly
  # here instead of silently serving under a sibling slug's name.
  local expected_container
  expected_container=$(slug_to_container "$slug")
  if [ "$container" != "$expected_container" ]; then
    log "ERROR: launched container name '$container' != expected '$expected_container' (eviction clobber?). Removing."
    docker rm -f "$container" >/dev/null 2>&1 || true
    return 1
  fi

  # Wait for the entrypoint to finish git clone / npm ci / uv sync.
  # The entrypoint writes /repo/.dev-server-ready when both processes are up.
  log "Waiting for dev server bootstrap (up to 600s)..."
  local waited=0
  while [ "$waited" -lt 600 ]; do
    if docker exec "$container" test -f /repo/.dev-server-ready 2>/dev/null; then
      log "  Bootstrap complete."
      break
    fi
    if ! docker inspect "$container" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
      log "ERROR: container $container exited during bootstrap. Last 40 lines:"
      docker logs --tail 40 "$container" >&2 || true
      return 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  if ! docker exec "$container" test -f /repo/.dev-server-ready 2>/dev/null; then
    log "WARNING: dev server still bootstrapping after 600s — continuing anyway"
    log "  Tail of container logs:"
    docker logs --tail 30 "$container" >&2 || true
  fi

  # Apply migrations (idempotent, runs after the container has cloned the repo)
  apply_dev_migrations "$db_name" "$container" || log "  (migrations errored, continuing)"

  # Configure Caddy snippet
  configure_caddy "$slug" "$port"

  log ""
  log "=== Dev server ready ==="
  log "  URL:       https://${slug}.dev.whoeverwants.com"
  log "  Branch:    $branch"
  log "  Port:      $port"
  log "  Container: $container"
  log "  Database:  $db_name"
}

cmd_list() {
  printf "%-40s %-40s %-5s %-25s %s\n" "CONTAINER" "BRANCH" "PORT" "UPDATED" "STATUS"
  printf "%-40s %-40s %-5s %-25s %s\n" "---------" "------" "----" "-------" "------"

  local found=0
  # Loop vars declared local (defensive: matches the eviction-clobber rule — a
  # future refactor that calls this from cmd_upsert's scope can't alias its
  # `container`/`port` locals).
  local container branch port updated status
  while IFS=$'\t' read -r container branch port updated status; do
    [ -z "$container" ] && continue
    found=1
    printf "%-40s %-40s %-5s %-25s %s\n" "$container" "${branch:-?}" "${port:-?}" "${updated:-?}" "$status"
  done < <(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" \
    --format '{{.Names}}	{{.Label "branch"}}	{{.Label "host_port"}}	{{.Label "updated_at"}}	{{.Status}}')

  if [ "$found" -eq 0 ]; then
    echo "(no dev servers)"
  fi
}

# Destroy by raw slug (used by eviction + the destroy-slug subcommand).
cmd_destroy_slug() {
  local slug="${1:?Usage: dev-server-manager.sh destroy-slug <branch-slug>}"
  local container db_name volume
  container=$(slug_to_container "$slug")
  db_name=$(slug_to_dbname "$slug")
  volume=$(slug_to_volume "$slug")

  log "=== Destroying dev server: $slug ==="

  if docker inspect "$container" >/dev/null 2>&1; then
    docker stop --time 10 "$container" >/dev/null 2>&1 || true
    docker rm "$container" >/dev/null 2>&1 || true
  fi
  docker volume rm "$volume" >/dev/null 2>&1 || true

  remove_caddy "$slug"
  drop_dev_database "$db_name"

  log "=== Dev server '$slug' destroyed ==="
}

# Destroy by branch name (used by the GitHub `delete` webhook handler).
cmd_destroy_branch() {
  local branch="${1:?Usage: dev-server-manager.sh destroy <branch>}"
  if is_skipped_branch "$branch"; then
    log "Skipping branch: $branch (in SKIP_BRANCHES)"
    return 0
  fi
  local slug
  slug=$(branch_to_slug "$branch")
  if [ -z "$slug" ]; then
    log "ERROR: branch '$branch' slugified to empty string; refusing to destroy"
    return 1
  fi
  cmd_destroy_slug "$slug"
}

cmd_destroy_all() {
  log "=== Destroying all dev servers ==="
  local any=0
  local container slug
  for container in $(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" --format '{{.Names}}'); do
    any=1
    slug="${container#${DEV_CONTAINER_PREFIX}-}"
    cmd_destroy_slug "$slug"
  done
  if [ "$any" -eq 0 ]; then
    echo "No dev servers to destroy."
  fi
  log "=== All dev servers destroyed ==="
}

cmd_cleanup_old() {
  local max_age_days="${1:-7}"
  local now
  now=$(date +%s)
  local container updated created_epoch age_days slug
  while IFS=$'\t' read -r container updated; do
    [ -z "$container" ] && continue
    created_epoch=$(date -d "$updated" +%s 2>/dev/null || echo 0)
    [ "$created_epoch" -eq 0 ] && continue
    age_days=$(( (now - created_epoch) / 86400 ))
    if [ "$age_days" -ge "$max_age_days" ]; then
      slug="${container#${DEV_CONTAINER_PREFIX}-}"
      log "Dev server '$slug' last updated ${age_days} days ago (max: ${max_age_days}). Destroying..."
      cmd_destroy_slug "$slug"
    fi
  done < <(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" \
    --format '{{.Names}}	{{.Label "updated_at"}}')
}

cmd_revive() {
  log "=== Reviving stopped dev servers ==="
  local container
  for container in $(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" --filter "status=exited" --format '{{.Names}}'); do
    log "Starting $container"
    docker start "$container" >/dev/null
  done
}

# --- Main --------------------------------------------------------------------

case "${1:-help}" in
  upsert)        cmd_upsert "${2:-}" ;;
  destroy)       cmd_destroy_branch "${2:-}" ;;
  destroy-slug)  cmd_destroy_slug "${2:-}" ;;
  list)          cmd_list ;;
  destroy-all)   cmd_destroy_all ;;
  cleanup)       cmd_cleanup_old "${2:-7}" ;;
  revive)        cmd_revive ;;
  *)
    cat <<USAGE
Usage: dev-server-manager.sh <command> [args]

Commands:
  upsert <branch>          Create or update a full-stack dev server for a branch
  destroy <branch>         Destroy the dev server for <branch> (by branch name)
  destroy-slug <slug>      Destroy the dev server for <slug> (by raw slug)
  list                     List all dev server containers
  destroy-all              Destroy every dev server
  cleanup [days]           Destroy dev servers not updated in N days (default: 7)
  revive                   Start any stopped dev-server containers

Each dev server gets:
  - One Docker container in the Colima VM (Next.js :3000 + FastAPI :8000)
  - One PostgreSQL database (shared instance, separate DB per branch)
  - Migrations auto-applied from branch
  - URL: https://<branch-slug>.dev.whoeverwants.com (Caddy snippet auto-managed)

Branches are slugified DNS-label-safe (lowercase, non-[a-z0-9-] -> '-',
truncated to ${MAX_SLUG_LEN} chars). The 'main' branch is skipped.
USAGE
    exit 1
    ;;
esac
