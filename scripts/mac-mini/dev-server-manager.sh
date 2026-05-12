#!/bin/bash
# Per-user FULL-STACK dev server manager for the Mac mini Colima VM.
#
# Architecture (differs from the droplet version — see scripts/dev-server-manager.sh
# for that file's docs):
#   - Each developer gets ONE Docker container: whoeverwants-dev-<slug>
#   - Inside the container: Next.js (port 3000) + FastAPI (port 8000) run together
#   - Container publishes Next.js to 127.0.0.1:<HOST_PORT> in the VM; Colima
#     forwards the same port to Mac localhost
#   - PostgreSQL is the shared devbox postgres container; one DB per author
#   - Caddy snippets are written to /host-caddy.d/ (a colima mount from Mac's
#     ~/devbox/caddy.d/); a launchd watcher on the Mac runs `caddy reload`
#     when snippets change
#
# Runtime environment:
#   - This script runs INSIDE the cmd-api container in the Colima VM
#   - It uses the Docker socket (mounted from the VM into cmd-api) to spawn
#     per-author dev-server containers as siblings
#
# Usage (driven from outside via bash scripts/remote-mac.sh):
#   dev-server-manager.sh upsert <email> <branch>
#   dev-server-manager.sh list
#   dev-server-manager.sh destroy <email-slug>
#   dev-server-manager.sh destroy-all
#   dev-server-manager.sh cleanup [days]
#   dev-server-manager.sh revive
#
# Email-to-slug mapping:
#   sam@example.com         -> sam-at-example-com
#   user.name@company.co.uk -> user-name-at-company-co-uk

set -euo pipefail

# --- Configuration -----------------------------------------------------------

# Where Caddy snippets land. The cmd-api container mounts this from the VM at
# the same path; the VM gets it from the Mac via colima --mount; the Mac's
# launchd watcher polls and reloads Caddy on changes.
CADDY_DEV_DIR="/host-caddy.d"

# Per-author repo state and logs land in a per-slug Docker named volume,
# mounted at /repo inside each dev-server container. Stop+restart preserves
# node_modules / .venv / .next; destroy drops the volume.
#
# DEV_REPO_VOLUME_PREFIX is also used by `list` and `destroy-all` to identify
# our containers (they share the prefix in their container names).
DEV_CONTAINER_PREFIX="whoeverwants-dev"
DEV_REPO_VOLUME_PREFIX="whoeverwants-dev-repo"
DEV_IMAGE="whoeverwants-devserver:latest"

REPO_URL="https://github.com/samcarey/whoeverwants.git"
FRONTEND_PORT_START=3001
FRONTEND_PORT_MAX=3010
MAX_DEV_SERVERS=5

# Shared docker network everyone joins (the devbox-net created by ~/devbox/docker-compose.yml)
DEVBOX_NET="devbox_devbox-net"
# The shared postgres container name (set by docker compose; "devbox" is the
# project name derived from ~/devbox/). Confirm via `docker ps --filter name=postgres`.
DB_CONTAINER="devbox-postgres-1"
DB_USER="whoeverwants"
DB_NAME_PREFIX="dev_"

LOCK_DIR="/tmp/dev-server-locks"
LOG_FILE="/var/log/dev-server-manager.log"

# Claude/bot email patterns to ignore (push events from these don't create dev servers)
IGNORE_EMAIL_PATTERNS=(
  "noreply@anthropic.com"
  "claude@anthropic.com"
  "noreply@github.com"
  "actions@github.com"
)

# --- Logging -----------------------------------------------------------------

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" >&2
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

# --- Slug + name helpers -----------------------------------------------------

email_to_slug() {
  local email="$1"
  echo "$email" | tr '[:upper:]' '[:lower:]' \
    | sed 's/@/-at-/g' \
    | sed 's/[^a-z0-9-]/-/g' \
    | sed 's/--*/-/g' \
    | sed 's/^-//; s/-$//'
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

is_ignored_email() {
  local email="$1"
  for pattern in "${IGNORE_EMAIL_PATTERNS[@]}"; do
    [ "$email" = "$pattern" ] && return 0
  done
  if echo "$email" | grep -qi '@anthropic\.com$'; then
    return 0
  fi
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
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    local basename
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
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$db_name" -v fname="$basename" -c \
      "INSERT INTO _migrations (filename) VALUES (:'fname') ON CONFLICT DO NOTHING;" >/dev/null
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
  cat > "${CADDY_DEV_DIR}/${slug}.caddy" <<EOF
${slug}.dev.whoeverwants.com {
    bind 0.0.0.0 ::
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
  local victims
  victims=$(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" \
    --format '{{.Label "updated_at"}} {{.Names}}' \
    | sort \
    | awk -v cur="$(slug_to_container "$current_slug")" '$2 != cur {print $2}')
  while IFS= read -r container && [ "$to_evict" -gt 0 ]; do
    [ -z "$container" ] && continue
    local victim_slug="${container#${DEV_CONTAINER_PREFIX}-}"
    log "Evicting dev server '$victim_slug' (limit: $MAX_DEV_SERVERS)"
    cmd_destroy "$victim_slug"
    to_evict=$((to_evict - 1))
  done <<< "$victims"
}

# --- Commands ----------------------------------------------------------------

cmd_upsert() {
  local email="${1:?Usage: dev-server-manager.sh upsert <email> <branch>}"
  local branch="${2:?Usage: dev-server-manager.sh upsert <email> <branch>}"

  if is_ignored_email "$email"; then
    log "Ignoring email: $email"
    return 0
  fi

  local slug
  slug=$(email_to_slug "$email")
  local container db_name volume
  container=$(slug_to_container "$slug")
  db_name=$(slug_to_dbname "$slug")
  volume=$(slug_to_volume "$slug")

  # Lock to prevent concurrent updates for same user
  mkdir -p "$LOCK_DIR"
  local lockfile="${LOCK_DIR}/${slug}.lock"
  exec 200>"$lockfile"
  if ! flock -n 200; then
    log "Update already in progress for $slug, skipping"
    return 0
  fi

  log "=== Upsert dev server: $email (slug: $slug, branch: $branch) ==="

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
  local existed_before=0
  if [ -n "${port:-}" ]; then
    existed_before=1
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

  # Create the per-author repo volume (idempotent)
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
    -p "127.0.0.1:${port}:3000" \
    -v "${volume}:/repo" \
    -e BRANCH="$branch" \
    -e EMAIL="$email" \
    -e SLUG="$slug" \
    -e REPO_URL="$REPO_URL" \
    -e DATABASE_URL="postgresql://${DB_USER}:${pg_password}@${DB_CONTAINER}:5432/${db_name}" \
    -e PYTHON_API_URL="http://localhost:8000" \
    -e DISABLE_RATE_LIMIT=1 \
    -e PORT=3000 \
    -e API_PORT=8000 \
    --label "whoeverwants-dev=true" \
    --label "slug=$slug" \
    --label "email=$email" \
    --label "branch=$branch" \
    --label "host_port=$port" \
    --label "db_name=$db_name" \
    --label "updated_at=$updated_at" \
    "$DEV_IMAGE" >/dev/null

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
  log "  Email:     $email"
  log "  Branch:    $branch"
  log "  Port:      $port"
  log "  Container: $container"
  log "  Database:  $db_name"
}

cmd_list() {
  printf "%-40s %-30s %-30s %-5s %-25s %s\n" "CONTAINER" "EMAIL" "BRANCH" "PORT" "UPDATED" "STATUS"
  printf "%-40s %-30s %-30s %-5s %-25s %s\n" "---------" "-----" "------" "----" "-------" "------"

  local found=0
  while IFS=$'\t' read -r container email branch port updated status; do
    [ -z "$container" ] && continue
    found=1
    printf "%-40s %-30s %-30s %-5s %-25s %s\n" "$container" "${email:-?}" "${branch:-?}" "${port:-?}" "${updated:-?}" "$status"
  done < <(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" \
    --format '{{.Names}}	{{.Label "email"}}	{{.Label "branch"}}	{{.Label "host_port"}}	{{.Label "updated_at"}}	{{.Status}}')

  if [ "$found" -eq 0 ]; then
    echo "(no dev servers)"
  fi
}

cmd_destroy() {
  local slug="${1:?Usage: dev-server-manager.sh destroy <email-slug>}"
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

cmd_destroy_all() {
  log "=== Destroying all dev servers ==="
  local any=0
  for container in $(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" --format '{{.Names}}'); do
    any=1
    local slug="${container#${DEV_CONTAINER_PREFIX}-}"
    cmd_destroy "$slug"
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
  while IFS=$'\t' read -r container updated; do
    [ -z "$container" ] && continue
    local created_epoch age_days
    created_epoch=$(date -d "$updated" +%s 2>/dev/null || echo 0)
    [ "$created_epoch" -eq 0 ] && continue
    age_days=$(( (now - created_epoch) / 86400 ))
    if [ "$age_days" -ge "$max_age_days" ]; then
      local slug="${container#${DEV_CONTAINER_PREFIX}-}"
      log "Dev server '$slug' last updated ${age_days} days ago (max: ${max_age_days}). Destroying..."
      cmd_destroy "$slug"
    fi
  done < <(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" \
    --format '{{.Names}}	{{.Label "updated_at"}}')
}

cmd_revive() {
  log "=== Reviving stopped dev servers ==="
  for container in $(docker ps -a --filter "name=${DEV_CONTAINER_PREFIX}-" --filter "status=exited" --format '{{.Names}}'); do
    log "Starting $container"
    docker start "$container" >/dev/null
  done
}

# --- Main --------------------------------------------------------------------

case "${1:-help}" in
  upsert)      cmd_upsert "${2:-}" "${3:-}" ;;
  list)        cmd_list ;;
  destroy)     cmd_destroy "${2:-}" ;;
  destroy-all) cmd_destroy_all ;;
  cleanup)     cmd_cleanup_old "${2:-7}" ;;
  revive)      cmd_revive ;;
  *)
    cat <<USAGE
Usage: dev-server-manager.sh <command> [args]

Commands:
  upsert <email> <branch>   Create or update a full-stack dev server
  list                      List all dev server containers
  destroy <email-slug>      Destroy a dev server (container, volume, database, Caddy)
  destroy-all               Destroy every dev server
  cleanup [days]            Destroy dev servers not updated in N days (default: 7)
  revive                    Start any stopped dev-server containers

Each dev server gets:
  - One Docker container in the Colima VM (Next.js :3000 + FastAPI :8000)
  - One PostgreSQL database (shared instance, separate DB per author)
  - Migrations auto-applied from branch
  - URL: https://<slug>.dev.whoeverwants.com (Caddy snippet auto-managed)
USAGE
    exit 1
    ;;
esac
