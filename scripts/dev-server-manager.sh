#!/bin/bash
# Per-BRANCH full-stack dev server manager for the WhoeverWants droplet.
# Each branch gets its own:
#   - Next.js standalone build on a unique port (3001-3099)
#   - FastAPI backend on a unique port (8001-8099)
#   - PostgreSQL database (shared instance, separate DB per dev server)
#   - All migrations from the branch auto-applied
#
# Usage (run on droplet):
#   dev-server-manager.sh upsert <branch>
#   dev-server-manager.sh list
#   dev-server-manager.sh destroy <slug>
#   dev-server-manager.sh destroy-all
#   dev-server-manager.sh cleanup [days]
#   dev-server-manager.sh suspend <slug>      # Stop processes, keep build
#   dev-server-manager.sh resume <slug>       # Restart stopped processes
#
# Branch-to-slug mapping (matches lib/slug.ts branchToSlug):
#   claude/fix-voting-bug-abc123 -> fix-voting-bug-abc123
#   feature/my-thing -> feature-my-thing

set -euo pipefail

DEV_DIR="/root/dev-servers"
CADDY_DEV_DIR="/etc/caddy/dev-servers"
REPO_URL="https://github.com/samcarey/whoeverwants.git"
FRONTEND_PORT_START=3001
FRONTEND_PORT_MAX=3099
API_PORT_START=8001
API_PORT_MAX=8099
MAX_DEV_SERVERS=20
LOCK_DIR="/tmp/dev-server-locks"
LOG_FILE="/var/log/dev-server-manager.log"

# Database connection (shared PostgreSQL container)
DB_CONTAINER="whoeverwants-db-1"
DB_USER="whoeverwants"
DB_PASSWORD="whoeverwants"
DB_HOST="127.0.0.1"
DB_PORT="5432"

# Path to uv (installed via astral.sh)
UV_BIN="/root/.local/bin/uv"

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" >&2
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

# Convert branch name to URL-safe slug (matches lib/slug.ts branchToSlug)
# claude/fix-voting-bug-abc123 -> fix-voting-bug-abc123
# feature/my-thing -> feature-my-thing
branch_to_slug() {
  local branch="$1"
  echo "$branch" \
    | sed 's|^claude/||' \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9-]/-/g' \
    | sed 's/--*/-/g' \
    | sed 's/^-//; s/-$//' \
    | cut -c1-50
}

# Convert email to URL-safe slug (for backward-compatible redirects)
# sam@example.com -> sam-at-example-com
email_to_slug() {
  local email="$1"
  echo "$email" | tr '[:upper:]' '[:lower:]' \
    | sed 's/@/-at-/g' \
    | sed 's/[^a-z0-9-]/-/g' \
    | sed 's/--*/-/g' \
    | sed 's/^-//; s/-$//'
}

# Convert slug to database name (replace hyphens with underscores)
# fix-voting-bug -> dev_fix_voting_bug
slug_to_dbname() {
  local slug="$1"
  echo "dev_${slug//-/_}"
}

# Find an available port in a range
find_available_port_in_range() {
  local start="$1"
  local max="$2"
  for port in $(seq "$start" "$max"); do
    if ! ss -tlnp 2>/dev/null | grep -q ":${port} "; then
      echo "$port"
      return 0
    fi
  done
  log "ERROR: No available ports in range $start-$max"
  return 1
}

# Get port from existing dev server metadata
get_dev_port() {
  local slug="$1"
  local meta="${DEV_DIR}/${slug}/.dev-meta.json"
  if [ -f "$meta" ]; then
    python3 -c "import json; print(json.load(open('$meta'))['port'])" 2>/dev/null || echo ""
  fi
}

# Get API port from existing dev server metadata
get_api_port() {
  local slug="$1"
  local meta="${DEV_DIR}/${slug}/.dev-meta.json"
  if [ -f "$meta" ]; then
    python3 -c "import json; print(json.load(open('$meta')).get('api_port', ''))" 2>/dev/null || echo ""
  fi
}

# --- Process management ---

# Stop the Next.js process for a dev server
stop_nextjs() {
  local slug="$1"
  local dir="${DEV_DIR}/${slug}"
  local pid_file="${dir}/.nextjs.pid"
  local port
  port=$(get_dev_port "$slug")

  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      log "Stopping Next.js for $slug (PID $pid)..."
      kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      local waited=0
      while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 10 ]; do
        sleep 1
        waited=$((waited + 1))
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 -- -"$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
        sleep 1
      fi
    fi
    rm -f "$pid_file"
  fi

  # Kill any orphaned processes still holding the port
  if [ -n "$port" ]; then
    local port_pids
    port_pids=$(fuser "${port}/tcp" 2>/dev/null || true)
    if [ -n "$port_pids" ]; then
      log "Killing orphaned processes on port $port: $port_pids"
      fuser -k "${port}/tcp" 2>/dev/null || true
      sleep 1
    fi
  fi
}

# Stop the FastAPI process for a dev server
stop_api() {
  local slug="$1"
  local dir="${DEV_DIR}/${slug}"
  local pid_file="${dir}/.api.pid"
  local port
  port=$(get_api_port "$slug")

  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      log "Stopping API for $slug (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      local waited=0
      while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 5 ]; do
        sleep 1
        waited=$((waited + 1))
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
        sleep 1
      fi
    fi
    rm -f "$pid_file"
  fi

  # Kill any orphaned processes still holding the API port
  if [ -n "$port" ]; then
    local port_pids
    port_pids=$(fuser "${port}/tcp" 2>/dev/null || true)
    if [ -n "$port_pids" ]; then
      log "Killing orphaned processes on API port $port: $port_pids"
      fuser -k "${port}/tcp" 2>/dev/null || true
      sleep 1
    fi
  fi
}

# Build the Next.js standalone output (run once, before start_nextjs)
build_nextjs() {
  local slug="$1"
  local api_port="$2"
  local dir="${DEV_DIR}/${slug}"

  cd "$dir"

  local git_sha git_branch
  git_sha=$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo "")
  git_branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

  log "Building Next.js standalone for $slug (API on port $api_port)..."

  # PYTHON_API_URL is baked into the build for rewrite destinations.
  # NEXT_OUTPUT=standalone triggers output: 'standalone' in next.config.ts.
  PYTHON_API_URL="http://localhost:${api_port}" \
  NEXT_OUTPUT=standalone \
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA="$git_sha" \
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF="$git_branch" \
    npm run build >> "${dir}/nextjs-build.log" 2>&1

  if [ ! -f "${dir}/.next/standalone/server.js" ]; then
    log "ERROR: Standalone build failed for $slug. Last 30 lines of build log:"
    tail -30 "${dir}/nextjs-build.log" >&2 2>/dev/null || true
    return 1
  fi

  # Copy static assets into standalone output (Next.js doesn't do this automatically)
  cp -r "${dir}/public" "${dir}/.next/standalone/public" 2>/dev/null || true
  cp -r "${dir}/.next/static" "${dir}/.next/standalone/.next/static" 2>/dev/null || true

  log "Next.js standalone build complete for $slug"
}

# Start the Next.js standalone server (must call build_nextjs first)
# NOTE: Only the PID is written to stdout (for capture). All log messages go to stderr.
start_nextjs() {
  local slug="$1"
  local frontend_port="$2"
  local api_port="$3"
  local dir="${DEV_DIR}/${slug}"

  cd "$dir"

  if [ ! -f "${dir}/.next/standalone/server.js" ]; then
    log "ERROR: No standalone build found for $slug. Run build_nextjs first."
    return 1
  fi

  log "Starting Next.js standalone server for $slug on port $frontend_port..."

  HOSTNAME=0.0.0.0 \
  PORT="$frontend_port" \
    node "${dir}/.next/standalone/server.js" \
    >> "${dir}/nextjs.log" 2>&1 200>&- &
  local new_pid=$!
  echo "$new_pid" > "${dir}/.nextjs.pid"

  sleep 3
  if ! kill -0 "$new_pid" 2>/dev/null; then
    log "ERROR: Next.js standalone server failed to start for $slug. Last 20 lines of log:"
    tail -20 "${dir}/nextjs.log" 2>/dev/null || true
    return 1
  fi

  log "Next.js standalone server started for $slug (PID $new_pid, port $frontend_port)"
  echo "$new_pid"
}

# Start the FastAPI dev server
# NOTE: Only the PID is written to stdout (for capture). All log messages go to stderr.
start_api() {
  local slug="$1"
  local api_port="$2"
  local db_name="$3"
  local dir="${DEV_DIR}/${slug}"

  cd "${dir}/server"

  log "Starting API server for $slug on port $api_port (DB: $db_name)..."

  # Install Python deps if needed (first time or pyproject.toml changed)
  if [ ! -d "${dir}/server/.venv" ]; then
    log "  Installing Python dependencies..."
    "$UV_BIN" sync --quiet 2>&1 | tail -3 || true
  fi

  # Source API secrets if available
  local api_env_file="/root/whoeverwants/.env.api"
  if [ -f "$api_env_file" ]; then
    set -a; source "$api_env_file"; set +a
  fi

  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${db_name}" \
    "$UV_BIN" run uvicorn main:app --host 0.0.0.0 --port "$api_port" --workers 1 \
    >> "${dir}/api.log" 2>&1 200>&- &
  local new_pid=$!
  echo "$new_pid" > "${dir}/.api.pid"

  sleep 3
  if ! kill -0 "$new_pid" 2>/dev/null; then
    log "ERROR: API server failed to start for $slug. Last 20 lines of log:"
    tail -20 "${dir}/api.log" 2>/dev/null || true
    return 1
  fi

  # Verify API is actually responding (process running != API healthy)
  local health_ok=false
  for i in 1 2 3 4 5; do
    if curl -sf "http://localhost:${api_port}/health" >/dev/null 2>&1; then
      health_ok=true
      break
    fi
    sleep 2
  done
  if [ "$health_ok" = false ]; then
    log "WARNING: API process running but /health not responding on port $api_port after 10s"
    log "  Last 10 lines of api.log:"
    tail -10 "${dir}/api.log" >&2 2>/dev/null || true
  fi

  log "API server started for $slug (PID $new_pid, port $api_port, DB: $db_name)"
  echo "$new_pid"
}

# --- Database management ---

# Create a dev database if it doesn't exist
create_dev_database() {
  local db_name="$1"
  local exists
  exists=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$db_name';" 2>/dev/null || echo "")
  if [ "$exists" != "1" ]; then
    log "  Creating database: $db_name"
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -c "CREATE DATABASE $db_name;" >/dev/null
  fi
}

# Apply migrations from the dev server's branch
apply_dev_migrations() {
  local db_name="$1"
  local migrations_dir="$2"

  if [ ! -d "$migrations_dir" ]; then
    log "  No migrations directory found at $migrations_dir"
    return
  fi

  log "  Applying migrations to $db_name..."
  bash "$(dirname "$0")/apply-migrations.sh" "$db_name" "$migrations_dir"
}

# Drop a dev database
drop_dev_database() {
  local db_name="$1"
  local exists
  exists=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$db_name';" 2>/dev/null || echo "")
  if [ "$exists" = "1" ]; then
    # Terminate existing connections first
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db_name' AND pid <> pg_backend_pid();" \
      >/dev/null 2>&1 || true
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -c "DROP DATABASE $db_name;" >/dev/null
    log "  Dropped database: $db_name"
  fi
}

# --- Caddy management ---

ensure_caddy_import() {
  mkdir -p "$CADDY_DEV_DIR"
  if ! grep -q "dev-servers" /etc/caddy/Caddyfile 2>/dev/null; then
    echo "" >> /etc/caddy/Caddyfile
    echo "import ${CADDY_DEV_DIR}/*.caddy" >> /etc/caddy/Caddyfile
    log "Added dev-servers import to Caddyfile"
  fi
}

configure_caddy() {
  local slug="$1"
  local port="$2"

  ensure_caddy_import

  cat > "${CADDY_DEV_DIR}/${slug}.caddy" <<EOF
${slug}.dev.whoeverwants.com {
	reverse_proxy 127.0.0.1:${port}
}
EOF

  caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl restart caddy
  log "Caddy configured for ${slug}.dev.whoeverwants.com -> port $port"
}

remove_caddy() {
  local slug="$1"
  rm -f "${CADDY_DEV_DIR}/${slug}.caddy"
  caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl restart caddy
  log "Caddy config removed for $slug"
}

# Configure a Caddy redirect from an email-based slug to a branch-based slug.
# This provides backward compatibility for old email-based dev server URLs.
# e.g., sam-at-samcarey-com.dev.whoeverwants.com -> fix-voting-bug.dev.whoeverwants.com
configure_caddy_redirect() {
  local email_slug="$1"
  local branch_slug="$2"

  ensure_caddy_import

  # Don't overwrite an actual dev server config with a redirect
  if [ -f "${DEV_DIR}/${email_slug}/.dev-meta.json" ]; then
    log "Skipping redirect for $email_slug — active dev server exists with that slug"
    return
  fi

  local redirect_file="${CADDY_DEV_DIR}/${email_slug}.caddy"
  local target_url="https://${branch_slug}.dev.whoeverwants.com"

  # Check if redirect already points to the right place
  if [ -f "$redirect_file" ] && grep -q "$target_url" "$redirect_file" 2>/dev/null; then
    return  # Already correct, skip reload
  fi

  cat > "$redirect_file" <<EOF
${email_slug}.dev.whoeverwants.com {
	redir ${target_url}{uri} temporary
}
EOF

  caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl restart caddy
  log "Caddy redirect: ${email_slug}.dev.whoeverwants.com -> ${target_url}"
}

# --- Eviction ---

evict_excess_servers() {
  local current_slug="$1"

  if [ ! -d "$DEV_DIR" ]; then
    return
  fi

  local servers=()
  for meta in "${DEV_DIR}"/*/.dev-meta.json; do
    [ ! -f "$meta" ] && continue
    local slug updated
    slug=$(python3 -c "import json; print(json.load(open('$meta'))['slug'])")
    updated=$(python3 -c "import json; print(json.load(open('$meta'))['updated_at'])")
    servers+=("${updated}|${slug}")
  done

  local total=${#servers[@]}
  local current_exists=false
  for entry in "${servers[@]}"; do
    local slug="${entry#*|}"
    if [ "$slug" = "$current_slug" ]; then
      current_exists=true
      break
    fi
  done
  if [ "$current_exists" = false ]; then
    total=$((total + 1))
  fi

  if [ "$total" -le "$MAX_DEV_SERVERS" ]; then
    return
  fi

  local sorted
  sorted=$(printf '%s\n' "${servers[@]}" | sort)
  local to_evict=$((total - MAX_DEV_SERVERS))

  while IFS= read -r entry && [ "$to_evict" -gt 0 ]; do
    local slug="${entry#*|}"
    if [ "$slug" = "$current_slug" ]; then
      continue
    fi
    log "Evicting dev server '$slug' (limit: $MAX_DEV_SERVERS)"
    cmd_destroy "$slug"
    to_evict=$((to_evict - 1))
  done <<< "$sorted"
}

# --- Commands ---

cmd_upsert() {
  local branch="${1:?Usage: dev-server-manager.sh upsert <branch>}"
  local slug
  slug=$(branch_to_slug "$branch")

  if [ -z "$slug" ]; then
    log "ERROR: branch '$branch' produced empty slug"
    return 1
  fi

  # Don't create dev servers for main/master
  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
    log "Skipping dev server for $branch"
    return 0
  fi

  # Validate prerequisites
  if [ ! -x "$UV_BIN" ]; then
    log "ERROR: uv not found at $UV_BIN. Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"
    return 1
  fi

  evict_excess_servers "$slug"

  # Lock to prevent concurrent updates for same branch
  mkdir -p "$LOCK_DIR"
  local lockfile="${LOCK_DIR}/${slug}.lock"
  exec 200>"$lockfile"
  if ! flock -n 200; then
    log "Update already in progress for $slug, skipping"
    return 0
  fi

  log "=== Upsert dev server: branch=$branch (slug: $slug) ==="

  local dir="${DEV_DIR}/${slug}"
  local db_name
  db_name=$(slug_to_dbname "$slug")
  local is_new=false
  local needs_npm_install=false

  if [ ! -d "$dir/.git" ]; then
    is_new=true
    needs_npm_install=true
    log "--- Cloning repository ---"
    mkdir -p "$DEV_DIR"
    rm -rf "$dir"
    git clone --depth 50 "$REPO_URL" "$dir"
  elif [ ! -d "$dir/node_modules" ]; then
    # Clone exists from a previous failed attempt but deps weren't installed
    needs_npm_install=true
  fi

  cd "$dir"

  # Save current hashes to detect dependency changes
  local old_lockfile_hash=""
  local old_pyproject_hash=""
  if [ -f "package-lock.json" ]; then
    old_lockfile_hash=$(md5sum package-lock.json | cut -d' ' -f1)
  fi
  if [ -f "server/pyproject.toml" ]; then
    old_pyproject_hash=$(md5sum server/pyproject.toml | cut -d' ' -f1)
  fi

  # Fetch and checkout the branch
  log "--- Fetching and checking out $branch ---"
  git fetch origin "$branch" --depth 50
  git checkout "$branch" 2>/dev/null \
    || git checkout -b "$branch" FETCH_HEAD 2>/dev/null \
    || git checkout "$branch"
  git reset --hard FETCH_HEAD

  # Check if JS dependencies changed
  local new_lockfile_hash=""
  if [ -f "package-lock.json" ]; then
    new_lockfile_hash=$(md5sum package-lock.json | cut -d' ' -f1)
  fi
  if [ "$old_lockfile_hash" != "$new_lockfile_hash" ]; then
    log "package-lock.json changed — will reinstall JS deps"
    needs_npm_install=true
  fi

  # Check if Python dependencies changed
  local needs_uv_sync=false
  local new_pyproject_hash=""
  if [ -f "server/pyproject.toml" ]; then
    new_pyproject_hash=$(md5sum server/pyproject.toml | cut -d' ' -f1)
  fi
  if [ "$old_pyproject_hash" != "$new_pyproject_hash" ] || [ ! -d "server/.venv" ]; then
    needs_uv_sync=true
  fi

  # --- Database setup (non-fatal — don't block frontend/API on migration errors) ---
  log "--- Setting up database ---"
  create_dev_database "$db_name"
  set +e
  apply_dev_migrations "$db_name" "${dir}/database/migrations"
  set -e

  # --- Python dependencies ---
  if [ "$needs_uv_sync" = true ]; then
    log "--- Installing Python dependencies ---"
    cd "${dir}/server"
    "$UV_BIN" sync --quiet 2>&1 | tail -3 || true
    cd "$dir"
  fi

  # --- Determine ports (reuse existing or find new) ---
  local frontend_port api_port
  frontend_port=$(get_dev_port "$slug")
  api_port=$(get_api_port "$slug")
  if [ -z "$frontend_port" ]; then
    frontend_port=$(find_available_port_in_range "$FRONTEND_PORT_START" "$FRONTEND_PORT_MAX")
  fi
  if [ -z "$api_port" ]; then
    api_port=$(find_available_port_in_range "$API_PORT_START" "$API_PORT_MAX")
  fi

  # --- Stop existing processes ---
  stop_api "$slug"
  stop_nextjs "$slug"

  # --- Install JS deps (needed for build) ---
  if [ "$needs_npm_install" = true ] || [ ! -d "${dir}/node_modules" ]; then
    log "--- Installing JS dependencies ---"
    npm ci --prefer-offline 2>&1 | tail -5
  fi

  # --- Build Next.js standalone ---
  log "--- Building Next.js standalone ---"
  build_nextjs "$slug" "$api_port"

  # --- Post-build cleanup: delete node_modules and build cache to free disk ---
  log "--- Post-build cleanup ---"
  rm -rf "${dir}/node_modules"
  rm -rf "${dir}/.next/cache"
  local disk_saved
  disk_saved=$(du -sh "${dir}" 2>/dev/null | cut -f1)
  log "  Dev server disk usage after cleanup: $disk_saved"

  # --- Start API server ---
  local api_pid
  api_pid=$(start_api "$slug" "$api_port" "$db_name")

  # --- Start Next.js standalone server ---
  local frontend_pid
  frontend_pid=$(start_nextjs "$slug" "$frontend_port" "$api_port")

  # --- Write metadata ---
  local commit_sha
  commit_sha=$(git rev-parse HEAD)
  cat > "${dir}/.dev-meta.json" <<EOF
{
  "slug": "${slug}",
  "branch": "${branch}",
  "port": ${frontend_port},
  "api_port": ${api_port},
  "db_name": "${db_name}",
  "pid": ${frontend_pid},
  "api_pid": ${api_pid},
  "commit": "${commit_sha}",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "url": "https://${slug}.dev.whoeverwants.com"
}
EOF

  # Configure Caddy (on first create, config missing, or port changed)
  local current_caddy_port=""
  if [ -f "${CADDY_DEV_DIR}/${slug}.caddy" ]; then
    current_caddy_port=$(grep -oP '127\.0\.0\.1:\K[0-9]+' "${CADDY_DEV_DIR}/${slug}.caddy" | head -1 || echo "")
  fi
  if [ "$is_new" = true ] || [ ! -f "${CADDY_DEV_DIR}/${slug}.caddy" ] || [ "$current_caddy_port" != "$frontend_port" ]; then
    configure_caddy "$slug" "$frontend_port"
  fi

  log ""
  log "=== Dev server ready ==="
  log "  URL:       https://${slug}.dev.whoeverwants.com"
  log "  Branch:    $branch"
  log "  Commit:    ${commit_sha:0:8}"
  log "  Frontend:  port $frontend_port (PID $frontend_pid)"
  log "  API:       port $api_port (PID $api_pid)"
  log "  Database:  $db_name"
}

cmd_list() {
  printf "%-35s %-40s %-5s %-5s %-20s %s\n" "SLUG" "BRANCH" "FE" "API" "UPDATED" "STATUS"
  printf "%-35s %-40s %-5s %-5s %-20s %s\n" "----" "------" "--" "---" "-------" "------"

  if [ ! -d "$DEV_DIR" ]; then
    echo "(no dev servers)"
    return
  fi

  local found=0
  for meta in "${DEV_DIR}"/*/.dev-meta.json; do
    [ ! -f "$meta" ] && continue
    found=1
    local slug branch port api_port updated pid api_pid suspended fe_status api_status
    slug=$(python3 -c "import json; print(json.load(open('$meta'))['slug'])")
    branch=$(python3 -c "import json; print(json.load(open('$meta'))['branch'])")
    port=$(python3 -c "import json; print(json.load(open('$meta'))['port'])")
    api_port=$(python3 -c "import json; print(json.load(open('$meta')).get('api_port', 'N/A'))")
    updated=$(python3 -c "import json; print(json.load(open('$meta'))['updated_at'][:19])")
    pid=$(python3 -c "import json; print(json.load(open('$meta')).get('pid', 'N/A'))")
    api_pid=$(python3 -c "import json; print(json.load(open('$meta')).get('api_pid', 'N/A'))")
    suspended=$(python3 -c "import json; print(json.load(open('$meta')).get('suspended', False))" 2>/dev/null || echo "False")

    if [ "$suspended" = "True" ]; then
      fe_status="SUSPENDED"
      api_status="SUSPENDED"
    else
      fe_status="DOWN"
      if [ "$pid" != "N/A" ] && [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then
        fe_status="UP"
      fi
      api_status="DOWN"
      if [ "$api_pid" != "N/A" ] && [ "$api_pid" != "0" ] && kill -0 "$api_pid" 2>/dev/null; then
        api_status="UP"
      fi
    fi

    printf "%-35s %-40s %-5s %-5s %-20s FE:%s API:%s\n" \
      "$slug" "$branch" "$port" "$api_port" "$updated" "$fe_status" "$api_status"
  done

  if [ "$found" -eq 0 ]; then
    echo "(no dev servers)"
  fi
}

cmd_destroy() {
  local slug="${1:?Usage: dev-server-manager.sh destroy <email-slug>}"
  local db_name
  db_name=$(slug_to_dbname "$slug")

  log "=== Destroying dev server: $slug ==="

  # Stop processes
  stop_api "$slug"
  stop_nextjs "$slug"

  # Remove Caddy config
  remove_caddy "$slug"

  # Drop the dev database
  drop_dev_database "$db_name"

  # Kill any lingering processes rooted in this directory
  local dir="${DEV_DIR:?}/${slug}"
  local pids
  pids=$(lsof +D "$dir" 2>/dev/null | awk 'NR>1{print $2}' | sort -u || true)
  if [ -n "$pids" ]; then
    log "Killing lingering processes in $dir: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi

  # Remove clone
  log "--- Removing clone ---"
  rm -rf "$dir" 2>/dev/null || { sleep 2; rm -rf "$dir"; }

  log "=== Dev server '$slug' destroyed ==="
}

cmd_destroy_all() {
  log "=== Destroying all dev servers ==="
  if [ ! -d "$DEV_DIR" ]; then
    echo "No dev servers to destroy."
    return
  fi

  for meta in "${DEV_DIR}"/*/.dev-meta.json; do
    [ ! -f "$meta" ] && continue
    local slug
    slug=$(python3 -c "import json; print(json.load(open('$meta'))['slug'])")
    cmd_destroy "$slug"
  done

  log "=== All dev servers destroyed ==="
}

cmd_cleanup_old() {
  local max_age_days="${1:-7}"
  local now
  now=$(date +%s)

  if [ ! -d "$DEV_DIR" ]; then
    return
  fi

  for meta in "${DEV_DIR}"/*/.dev-meta.json; do
    [ ! -f "$meta" ] && continue
    local slug updated created_epoch age_days
    slug=$(python3 -c "import json; print(json.load(open('$meta'))['slug'])")
    updated=$(python3 -c "import json; print(json.load(open('$meta'))['updated_at'])")
    created_epoch=$(date -d "$updated" +%s 2>/dev/null || echo 0)

    if [ "$created_epoch" -eq 0 ]; then
      continue
    fi

    age_days=$(( (now - created_epoch) / 86400 ))
    if [ "$age_days" -ge "$max_age_days" ]; then
      log "Dev server '$slug' last updated ${age_days} days ago (max: ${max_age_days}). Destroying..."
      cmd_destroy "$slug"
    fi
  done
}

# Restart any dev servers that should be running but aren't (e.g., after reboot)
cmd_revive() {
  log "=== Checking for stopped dev servers ==="
  if [ ! -d "$DEV_DIR" ]; then
    return
  fi

  for meta in "${DEV_DIR}"/*/.dev-meta.json; do
    [ ! -f "$meta" ] && continue
    local slug port api_port db_name pid api_pid
    slug=$(python3 -c "import json; print(json.load(open('$meta'))['slug'])")
    port=$(python3 -c "import json; print(json.load(open('$meta'))['port'])")
    api_port=$(python3 -c "import json; print(json.load(open('$meta')).get('api_port', ''))")
    db_name=$(python3 -c "import json; print(json.load(open('$meta')).get('db_name', ''))")
    pid=$(python3 -c "import json; print(json.load(open('$meta')).get('pid', '0'))")
    api_pid=$(python3 -c "import json; print(json.load(open('$meta')).get('api_pid', '0'))")

    local dir="${DEV_DIR}/${slug}"

    # Revive API if not running
    if [ -n "$api_port" ] && [ -n "$db_name" ] && ! kill -0 "$api_pid" 2>/dev/null; then
      if [ -d "${dir}/server/.venv" ]; then
        log "API for '$slug' is not running, restarting on port $api_port..."
        local new_api_pid
        new_api_pid=$(start_api "$slug" "$api_port" "$db_name")
        python3 -c "
import json
with open('$meta', 'r+') as f:
    d = json.load(f)
    d['api_pid'] = $new_api_pid
    f.seek(0)
    json.dump(d, f, indent=2)
    f.truncate()
"
        log "Revived API for '$slug' with PID $new_api_pid"
      fi
    fi

    # Revive frontend if not running (standalone build must exist)
    if ! kill -0 "$pid" 2>/dev/null; then
      local suspended
      suspended=$(python3 -c "import json; print(json.load(open('$meta')).get('suspended', False))" 2>/dev/null || echo "False")
      if [ "$suspended" = "True" ]; then
        log "Dev server '$slug' is suspended, skipping revive"
      elif [ -f "${dir}/.next/standalone/server.js" ] && [ -n "$api_port" ]; then
        log "Frontend for '$slug' is not running, restarting on port $port..."
        local new_pid
        new_pid=$(start_nextjs "$slug" "$port" "$api_port")
        python3 -c "
import json
with open('$meta', 'r+') as f:
    d = json.load(f)
    d['pid'] = $new_pid
    f.seek(0)
    json.dump(d, f, indent=2)
    f.truncate()
"
        log "Revived frontend for '$slug' with PID $new_pid"
      else
        log "Missing standalone build or api_port for '$slug', skipping (needs full upsert)"
      fi
    fi
  done
}

# Suspend a dev server (stop processes, keep build on disk for fast resume)
cmd_suspend() {
  local slug="${1:?Usage: dev-server-manager.sh suspend <slug>}"

  if [ ! -f "${DEV_DIR}/${slug}/.dev-meta.json" ]; then
    log "ERROR: No dev server found with slug '$slug'"
    return 1
  fi

  log "=== Suspending dev server: $slug ==="
  stop_api "$slug"
  stop_nextjs "$slug"

  # Mark as suspended in metadata
  python3 -c "
import json
meta_path = '${DEV_DIR}/${slug}/.dev-meta.json'
with open(meta_path, 'r+') as f:
    d = json.load(f)
    d['suspended'] = True
    d['pid'] = 0
    d['api_pid'] = 0
    f.seek(0)
    json.dump(d, f, indent=2)
    f.truncate()
"
  log "=== Dev server '$slug' suspended (processes stopped, build retained) ==="
}

# Resume a suspended dev server (restart processes from existing build)
cmd_resume() {
  local slug="${1:?Usage: dev-server-manager.sh resume <slug>}"
  local meta="${DEV_DIR}/${slug}/.dev-meta.json"

  if [ ! -f "$meta" ]; then
    log "ERROR: No dev server found with slug '$slug'"
    return 1
  fi

  local port api_port db_name
  port=$(python3 -c "import json; print(json.load(open('$meta'))['port'])")
  api_port=$(python3 -c "import json; print(json.load(open('$meta')).get('api_port', ''))")
  db_name=$(python3 -c "import json; print(json.load(open('$meta')).get('db_name', ''))")

  if [ ! -f "${DEV_DIR}/${slug}/.next/standalone/server.js" ]; then
    log "ERROR: No standalone build found for '$slug'. Run upsert instead."
    return 1
  fi

  log "=== Resuming dev server: $slug ==="

  # Start API
  local api_pid=0
  if [ -n "$api_port" ] && [ -n "$db_name" ]; then
    api_pid=$(start_api "$slug" "$api_port" "$db_name")
  fi

  # Start frontend
  local frontend_pid
  frontend_pid=$(start_nextjs "$slug" "$port" "$api_port")

  # Update metadata
  python3 -c "
import json
with open('$meta', 'r+') as f:
    d = json.load(f)
    d['suspended'] = False
    d['pid'] = $frontend_pid
    d['api_pid'] = $api_pid
    f.seek(0)
    json.dump(d, f, indent=2)
    f.truncate()
"
  log "=== Dev server '$slug' resumed (FE PID $frontend_pid, API PID $api_pid) ==="
}

# Suspend dev servers idle for more than N minutes (default: 30)
cmd_suspend_idle() {
  local max_idle_minutes="${1:-30}"
  local now
  now=$(date +%s)

  if [ ! -d "$DEV_DIR" ]; then
    return
  fi

  for meta in "${DEV_DIR}"/*/.dev-meta.json; do
    [ ! -f "$meta" ] && continue
    local slug updated updated_epoch idle_minutes pid api_pid suspended
    slug=$(python3 -c "import json; print(json.load(open('$meta'))['slug'])")
    updated=$(python3 -c "import json; print(json.load(open('$meta'))['updated_at'])")
    pid=$(python3 -c "import json; print(json.load(open('$meta')).get('pid', '0'))")
    api_pid=$(python3 -c "import json; print(json.load(open('$meta')).get('api_pid', '0'))")
    suspended=$(python3 -c "import json; print(json.load(open('$meta')).get('suspended', False))" 2>/dev/null || echo "False")

    # Skip already suspended servers
    if [ "$suspended" = "True" ]; then
      continue
    fi

    # Skip servers with no running processes
    local fe_running=false api_running=false
    if [ "$pid" != "0" ] && kill -0 "$pid" 2>/dev/null; then
      fe_running=true
    fi
    if [ "$api_pid" != "0" ] && kill -0 "$api_pid" 2>/dev/null; then
      api_running=true
    fi
    if [ "$fe_running" = false ] && [ "$api_running" = false ]; then
      continue
    fi

    updated_epoch=$(date -d "$updated" +%s 2>/dev/null || echo 0)
    if [ "$updated_epoch" -eq 0 ]; then
      continue
    fi

    idle_minutes=$(( (now - updated_epoch) / 60 ))
    if [ "$idle_minutes" -ge "$max_idle_minutes" ]; then
      log "Dev server '$slug' idle for ${idle_minutes} min (max: ${max_idle_minutes}). Suspending..."
      cmd_suspend "$slug"
    fi
  done
}

# Set up a redirect from an email-based URL to a branch-based URL
cmd_redirect() {
  local email="${1:?Usage: dev-server-manager.sh redirect <email> <branch>}"
  local branch="${2:?Usage: dev-server-manager.sh redirect <email> <branch>}"
  local email_slug branch_slug
  email_slug=$(email_to_slug "$email")
  branch_slug=$(branch_to_slug "$branch")

  if [ -z "$email_slug" ] || [ -z "$branch_slug" ]; then
    log "ERROR: empty slug from email='$email' or branch='$branch'"
    return 1
  fi

  # Don't redirect if the email slug is the same as the branch slug
  if [ "$email_slug" = "$branch_slug" ]; then
    return 0
  fi

  configure_caddy_redirect "$email_slug" "$branch_slug"
}

# --- Main ---
case "${1:-help}" in
  upsert)       cmd_upsert "${2:-}" ;;
  list)         cmd_list ;;
  destroy)      cmd_destroy "${2:-}" ;;
  destroy-all)  cmd_destroy_all ;;
  cleanup)      cmd_cleanup_old "${2:-7}" ;;
  revive)       cmd_revive ;;
  suspend)      cmd_suspend "${2:-}" ;;
  resume)       cmd_resume "${2:-}" ;;
  suspend-idle) cmd_suspend_idle "${2:-30}" ;;
  redirect)     cmd_redirect "${2:-}" "${3:-}" ;;
  *)
    echo "Usage: dev-server-manager.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  upsert <branch>          Create or update a dev server for a branch"
    echo "  list                     List all dev servers"
    echo "  destroy <slug>           Destroy a dev server (including database)"
    echo "  destroy-all              Destroy all dev servers"
    echo "  cleanup [days]           Destroy dev servers not updated in N days (default: 7)"
    echo "  revive                   Restart any stopped (non-suspended) dev servers"
    echo "  suspend <slug>           Stop processes but keep build on disk"
    echo "  resume <slug>            Restart a suspended dev server"
    echo "  suspend-idle [minutes]   Suspend servers idle for N minutes (default: 30)"
    echo "  redirect <email> <branch> Set up email-slug redirect to branch-slug"
    echo ""
    echo "Each dev server gets:"
    echo "  - Next.js standalone build (port 3001-3099)"
    echo "  - FastAPI backend (port 8001-8099)"
    echo "  - PostgreSQL database (shared instance, separate DB)"
    echo "  - Migrations auto-applied from branch"
    exit 1
    ;;
esac
