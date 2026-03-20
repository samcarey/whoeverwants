#!/bin/bash
# Per-user dev server manager for the WhoeverWants droplet.
# Each developer (identified by git author email) gets their own Next.js
# frontend server that auto-updates when they push new commits.
#
# Usage (run on droplet):
#   dev-server-manager.sh upsert <email> <branch>
#   dev-server-manager.sh list
#   dev-server-manager.sh destroy <email-slug>
#   dev-server-manager.sh destroy-all
#   dev-server-manager.sh cleanup [days]
#
# Each dev server gets:
#   - A clone of the repo at /root/dev-servers/<email-slug>/
#   - A Next.js dev server (hot reload) on a unique port
#   - A Caddy route at <email-slug>.dev.whoeverwants.com
#   - Uses the production API (api.whoeverwants.com)
#
# Dev mode: Uses `next dev` for instant hot reload. On push, files are
# updated via git and Next.js auto-detects changes — no rebuild needed.
# Server only restarts if package-lock.json changes.
#
# Email-to-slug mapping:
#   sam@example.com -> sam-at-example-com
#   user.name@company.co.uk -> user-name-at-company-co-uk

set -euo pipefail

DEV_DIR="/root/dev-servers"
CADDY_DEV_DIR="/etc/caddy/dev-servers"
REPO_URL="https://github.com/samcarey/whoeverwants.git"
PORT_START=3001
PORT_MAX=3005
MAX_DEV_SERVERS=3
LOCK_DIR="/tmp/dev-server-locks"
LOG_FILE="/var/log/dev-server-manager.log"

# Claude/bot email patterns to ignore
IGNORE_EMAIL_PATTERNS=(
  "noreply@anthropic.com"
  "claude@anthropic.com"
  "noreply@github.com"
  "actions@github.com"
)

log() {
  local msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$msg" >&2
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

# Convert email to URL-safe slug
# sam@example.com -> sam-at-example-com
email_to_slug() {
  local email="$1"
  echo "$email" | tr '[:upper:]' '[:lower:]' \
    | sed 's/@/-at-/g' \
    | sed 's/[^a-z0-9-]/-/g' \
    | sed 's/--*/-/g' \
    | sed 's/^-//; s/-$//'
}

# Check if email should be ignored (Claude, bots, etc.)
is_ignored_email() {
  local email="$1"
  for pattern in "${IGNORE_EMAIL_PATTERNS[@]}"; do
    if [ "$email" = "$pattern" ]; then
      return 0
    fi
  done
  # Also ignore any *@anthropic.com
  if echo "$email" | grep -qi '@anthropic\.com$'; then
    return 0
  fi
  return 1
}

# Find an available port
find_available_port() {
  for port in $(seq $PORT_START $PORT_MAX); do
    if ! ss -tlnp 2>/dev/null | grep -q ":${port} "; then
      echo "$port"
      return 0
    fi
  done
  log "ERROR: No available ports in range $PORT_START-$PORT_MAX"
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

# Stop the Next.js process for a dev server
# next dev spawns child processes, so we kill the entire process group
stop_nextjs() {
  local slug="$1"
  local dir="${DEV_DIR}/${slug}"
  local pid_file="${dir}/.nextjs.pid"

  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      log "Stopping Next.js for $slug (PID $pid)..."
      # Kill the entire process group (next dev + child processes)
      kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      # Wait up to 10 seconds for graceful shutdown
      local waited=0
      while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 10 ]; do
        sleep 1
        waited=$((waited + 1))
      done
      # Force kill if still running
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 -- -"$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
        sleep 1
      fi
    fi
    rm -f "$pid_file"
  fi
}

# Start the Next.js dev server (hot reload mode)
# NOTE: Only the PID is written to stdout (for capture). All log messages go to stderr.
start_nextjs() {
  local slug="$1"
  local port="$2"
  local dir="${DEV_DIR}/${slug}"

  cd "$dir"

  log "Starting Next.js dev server for $slug on port $port..."
  # Use `npm run dev` so flags (--webpack, etc.) stay in sync with package.json.
  # Extra args are passed after `--`.
  NEXT_PUBLIC_API_URL="https://api.whoeverwants.com/api/polls" \
  HOSTNAME=0.0.0.0 \
    npm run dev -- -p "$port" \
    >> "${dir}/nextjs.log" 2>&1 200>&- &
  local new_pid=$!
  echo "$new_pid" > "${dir}/.nextjs.pid"

  # Wait and verify it started
  sleep 5
  if ! kill -0 "$new_pid" 2>/dev/null; then
    log "ERROR: Next.js dev server failed to start for $slug. Last 20 lines of log:"
    tail -20 "${dir}/nextjs.log" 2>/dev/null || true
    return 1
  fi

  log "Next.js dev server started for $slug (PID $new_pid, port $port)"
  # Only output the PID — log() already wrote to the log file
  echo "$new_pid"
}

# Ensure the Caddy import line for dev-servers exists
ensure_caddy_import() {
  mkdir -p "$CADDY_DEV_DIR"
  if ! grep -q "dev-servers" /etc/caddy/Caddyfile 2>/dev/null; then
    echo "" >> /etc/caddy/Caddyfile
    echo "import ${CADDY_DEV_DIR}/*.caddy" >> /etc/caddy/Caddyfile
    log "Added dev-servers import to Caddyfile"
  fi
}

# Add or update Caddy config for a dev server
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

# Remove Caddy config for a dev server
remove_caddy() {
  local slug="$1"
  rm -f "${CADDY_DEV_DIR}/${slug}.caddy"
  caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl restart caddy
  log "Caddy config removed for $slug"
}

# Evict oldest dev servers to stay within MAX_DEV_SERVERS limit.
# Keeps the most recently updated servers, destroys the rest.
# The current_slug (about to be upserted) is never evicted.
evict_excess_servers() {
  local current_slug="$1"

  if [ ! -d "$DEV_DIR" ]; then
    return
  fi

  # Collect all slugs with their updated_at timestamps, sorted oldest first
  local servers=()
  for meta in "${DEV_DIR}"/*/.dev-meta.json; do
    [ ! -f "$meta" ] && continue
    local slug updated
    slug=$(python3 -c "import json; print(json.load(open('$meta'))['slug'])")
    updated=$(python3 -c "import json; print(json.load(open('$meta'))['updated_at'])")
    servers+=("${updated}|${slug}")
  done

  # Count how many will exist after this upsert
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

  # Sort oldest first and evict until we're at the limit
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
  local email="${1:?Usage: dev-server-manager.sh upsert <email> <branch>}"
  local branch="${2:?Usage: dev-server-manager.sh upsert <email> <branch>}"
  local slug
  slug=$(email_to_slug "$email")

  if is_ignored_email "$email"; then
    log "Ignoring email: $email"
    return 0
  fi

  # Evict oldest dev servers if at capacity
  evict_excess_servers "$slug"

  # Lock to prevent concurrent updates for same user
  mkdir -p "$LOCK_DIR"
  local lockfile="${LOCK_DIR}/${slug}.lock"
  exec 200>"$lockfile"
  if ! flock -n 200; then
    log "Update already in progress for $slug, skipping"
    return 0
  fi

  log "=== Upsert dev server: $email (slug: $slug, branch: $branch) ==="

  local dir="${DEV_DIR}/${slug}"
  local is_new=false
  local needs_restart=false

  if [ ! -d "$dir/.git" ]; then
    is_new=true
    needs_restart=true
    log "--- Cloning repository ---"
    mkdir -p "$DEV_DIR"
    rm -rf "$dir"
    git clone --depth 50 "$REPO_URL" "$dir"
  fi

  cd "$dir"

  # Save current package-lock hash to detect dependency changes
  local old_lockfile_hash=""
  if [ -f "package-lock.json" ]; then
    old_lockfile_hash=$(md5sum package-lock.json | cut -d' ' -f1)
  fi

  # Fetch and checkout the branch
  log "--- Fetching and checking out $branch ---"
  git fetch origin "$branch" --depth 50
  # Use FETCH_HEAD since shallow clones may not have remote tracking branches
  git checkout "$branch" 2>/dev/null \
    || git checkout -b "$branch" FETCH_HEAD 2>/dev/null \
    || git checkout "$branch"
  git reset --hard FETCH_HEAD

  # Check if dependencies changed
  local new_lockfile_hash=""
  if [ -f "package-lock.json" ]; then
    new_lockfile_hash=$(md5sum package-lock.json | cut -d' ' -f1)
  fi
  if [ "$old_lockfile_hash" != "$new_lockfile_hash" ]; then
    log "package-lock.json changed — reinstalling deps and restarting"
    needs_restart=true
  fi

  # Check if server process is still running
  local current_pid=""
  if [ -f "${dir}/.nextjs.pid" ]; then
    current_pid=$(cat "${dir}/.nextjs.pid")
    if ! kill -0 "$current_pid" 2>/dev/null; then
      log "Dev server process not running — needs restart"
      needs_restart=true
      current_pid=""
    fi
  else
    needs_restart=true
  fi

  # Determine port (reuse existing or find new)
  local port
  port=$(get_dev_port "$slug")
  if [ -z "$port" ]; then
    port=$(find_available_port)
  fi

  if [ "$needs_restart" = true ]; then
    # Stop existing server if running
    stop_nextjs "$slug"

    # Install dependencies
    log "--- Installing dependencies ---"
    npm ci --prefer-offline 2>&1 | tail -5

    # Clear .next cache on fresh installs for clean state
    if [ "$is_new" = true ]; then
      rm -rf .next
    fi

    # Start the dev server
    local pid
    pid=$(start_nextjs "$slug" "$port")
  else
    local pid="$current_pid"
    log "Files updated — Next.js dev server will hot-reload automatically"
  fi

  # Write metadata
  local commit_sha
  commit_sha=$(git rev-parse HEAD)
  cat > "${dir}/.dev-meta.json" <<EOF
{
  "slug": "${slug}",
  "email": "${email}",
  "branch": "${branch}",
  "port": ${port},
  "pid": ${pid},
  "commit": "${commit_sha}",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "url": "https://${slug}.dev.whoeverwants.com"
}
EOF

  # Configure Caddy (on first create, config missing, or port changed)
  local current_caddy_port=""
  if [ -f "${CADDY_DEV_DIR}/${slug}.caddy" ]; then
    current_caddy_port=$(grep -oP '127\.0\.0\.1:\K[0-9]+' "${CADDY_DEV_DIR}/${slug}.caddy" || echo "")
  fi
  if [ "$is_new" = true ] || [ ! -f "${CADDY_DEV_DIR}/${slug}.caddy" ] || [ "$current_caddy_port" != "$port" ]; then
    configure_caddy "$slug" "$port"
  fi

  log ""
  log "=== Dev server ready ==="
  log "  URL:    https://${slug}.dev.whoeverwants.com"
  log "  Email:  $email"
  log "  Branch: $branch"
  log "  Commit: ${commit_sha:0:8}"
  log "  Port:   $port"
  log "  PID:    $pid"
  if [ "$needs_restart" = true ]; then
    log "  Mode:   Full restart (deps changed or new server)"
  else
    log "  Mode:   Hot reload (files updated, no restart needed)"
  fi
}

cmd_list() {
  printf "%-35s %-30s %-30s %-5s %-20s %s\n" "SLUG" "EMAIL" "BRANCH" "PORT" "UPDATED" "URL"
  printf "%-35s %-30s %-30s %-5s %-20s %s\n" "----" "-----" "------" "----" "-------" "---"

  if [ ! -d "$DEV_DIR" ]; then
    echo "(no dev servers)"
    return
  fi

  local found=0
  for meta in "${DEV_DIR}"/*/.dev-meta.json; do
    [ ! -f "$meta" ] && continue
    found=1
    local slug branch email port updated url pid running
    slug=$(python3 -c "import json; print(json.load(open('$meta'))['slug'])")
    email=$(python3 -c "import json; print(json.load(open('$meta'))['email'])")
    branch=$(python3 -c "import json; print(json.load(open('$meta'))['branch'])")
    port=$(python3 -c "import json; print(json.load(open('$meta'))['port'])")
    updated=$(python3 -c "import json; print(json.load(open('$meta'))['updated_at'][:19])")
    url=$(python3 -c "import json; print(json.load(open('$meta'))['url'])")
    pid=$(python3 -c "import json; print(json.load(open('$meta')).get('pid', 'N/A'))")

    # Check if process is running
    running="STOPPED"
    if [ "$pid" != "N/A" ] && kill -0 "$pid" 2>/dev/null; then
      running="RUNNING"
    fi

    printf "%-35s %-30s %-30s %-5s %-20s %s [%s]\n" "$slug" "$email" "$branch" "$port" "$updated" "$url" "$running"
  done

  if [ "$found" -eq 0 ]; then
    echo "(no dev servers)"
  fi
}

cmd_destroy() {
  local slug="${1:?Usage: dev-server-manager.sh destroy <email-slug>}"

  log "=== Destroying dev server: $slug ==="

  # Stop Next.js
  stop_nextjs "$slug"

  # Remove Caddy config
  remove_caddy "$slug"

  # Remove clone
  log "--- Removing clone ---"
  rm -rf "${DEV_DIR:?}/${slug}"

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
    local slug port pid
    slug=$(python3 -c "import json; print(json.load(open('$meta'))['slug'])")
    port=$(python3 -c "import json; print(json.load(open('$meta'))['port'])")
    pid=$(python3 -c "import json; print(json.load(open('$meta')).get('pid', '0'))")

    if ! kill -0 "$pid" 2>/dev/null; then
      log "Dev server '$slug' is not running, restarting on port $port..."
      local dir="${DEV_DIR}/${slug}"
      if [ -d "$dir/node_modules" ]; then
        local new_pid
        new_pid=$(start_nextjs "$slug" "$port")
        # Update PID in metadata
        python3 -c "
import json
with open('$meta', 'r+') as f:
    d = json.load(f)
    d['pid'] = $new_pid
    f.seek(0)
    json.dump(d, f, indent=2)
    f.truncate()
"
        log "Revived '$slug' with PID $new_pid"
      else
        log "No node_modules found for '$slug', skipping (needs full upsert)"
      fi
    fi
  done
}

# --- Main ---
case "${1:-help}" in
  upsert)      cmd_upsert "${2:-}" "${3:-}" ;;
  list)        cmd_list ;;
  destroy)     cmd_destroy "${2:-}" ;;
  destroy-all) cmd_destroy_all ;;
  cleanup)     cmd_cleanup_old "${2:-7}" ;;
  revive)      cmd_revive ;;
  *)
    echo "Usage: dev-server-manager.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  upsert <email> <branch>   Create or update a dev server for a user"
    echo "  list                      List all active dev servers"
    echo "  destroy <email-slug>      Destroy a specific dev server"
    echo "  destroy-all               Destroy all dev servers"
    echo "  cleanup [days]            Destroy dev servers not updated in N days (default: 7)"
    echo "  revive                    Restart any stopped dev servers"
    echo ""
    echo "Email-to-slug mapping:"
    echo "  sam@example.com -> sam-at-example-com"
    echo "  user@company.co.uk -> user-at-company-co-uk"
    exit 1
    ;;
esac
