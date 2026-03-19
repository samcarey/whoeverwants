#!/bin/bash
# Preview environment manager for the WhoeverWants droplet.
# Creates per-branch preview API instances with isolated databases.
#
# Usage (run on droplet):
#   preview-manager.sh create <branch-name>
#   preview-manager.sh list
#   preview-manager.sh destroy <slug>
#   preview-manager.sh destroy-all
#
# Each preview gets:
#   - A separate Postgres database in the shared container
#   - A FastAPI Docker container on a unique port
#   - A Caddy route at <slug>.api.whoeverwants.com

set -euo pipefail

REPO_DIR="/root/whoeverwants"
PREVIEW_DIR="/root/previews"
CADDY_PREVIEW_DIR="/etc/caddy/previews"
PORT_START=8001
PORT_MAX=8020

# Derive a URL-safe slug from a branch name
# e.g., "claude/fix-voting-bug-abc123" -> "fix-voting-bug-abc123"
branch_to_slug() {
  local branch="$1"
  # Strip claude/ prefix if present
  local slug="${branch#claude/}"
  # Lowercase, replace non-alphanumeric chars (except hyphens) with hyphens
  slug=$(echo "$slug" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
  # Truncate to 50 chars for DNS label safety
  echo "${slug:0:50}"
}

# Find the next available port
find_available_port() {
  for port in $(seq $PORT_START $PORT_MAX); do
    if ! docker ps --format '{{.Ports}}' | grep -q ":${port}->"; then
      echo "$port"
      return 0
    fi
  done
  echo "ERROR: No available ports in range $PORT_START-$PORT_MAX" >&2
  return 1
}

# Get the DB container name
db_container() {
  docker ps --filter "name=whoeverwants-db" --format '{{.Names}}' | head -1
}

cmd_create() {
  local branch="${1:?Usage: preview-manager.sh create <branch-name>}"
  local slug=$(branch_to_slug "$branch")
  local db_name="preview_${slug//-/_}"
  local container_name="preview-${slug}"

  echo "=== Creating preview: $slug ==="
  echo "Branch: $branch"
  echo "Database: $db_name"
  echo "Container: $container_name"

  # Check if preview already exists
  if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
    echo "Preview '$slug' already exists. Destroy it first or use a different branch."
    exit 1
  fi

  # 1. Fetch the branch
  echo "--- Fetching branch ---"
  cd "$REPO_DIR"
  git fetch origin "$branch"

  # 2. Create git worktree
  echo "--- Creating worktree ---"
  mkdir -p "$PREVIEW_DIR"
  if [ -d "${PREVIEW_DIR}/${slug}" ]; then
    git worktree remove --force "${PREVIEW_DIR}/${slug}" 2>/dev/null || true
  fi
  git worktree add "${PREVIEW_DIR}/${slug}" "origin/${branch}"

  # 3. Create database
  echo "--- Creating database ---"
  local db_cont=$(db_container)
  docker exec "$db_cont" psql -U whoeverwants -c "CREATE DATABASE \"${db_name}\";" 2>/dev/null || true

  # 4. Copy schema from production (structure only, no data for clean slate)
  echo "--- Copying schema ---"
  docker exec "$db_cont" pg_dump -U whoeverwants --schema-only whoeverwants \
    | docker exec -i "$db_cont" psql -U whoeverwants -q "$db_name"

  # 5. Apply any new migrations from the branch
  echo "--- Applying migrations ---"
  docker exec -i "$db_cont" psql -U whoeverwants -q "$db_name" <<'SQL'
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
SQL

  # Copy production migration tracking, then apply any new ones
  docker exec "$db_cont" psql -U whoeverwants -Atc \
    "SELECT filename FROM _migrations ORDER BY filename" whoeverwants \
    | while read -r fname; do
        docker exec -i "$db_cont" psql -U whoeverwants -q "$db_name" \
          -c "INSERT INTO _migrations (filename) VALUES ('${fname}') ON CONFLICT DO NOTHING" 2>/dev/null || true
      done

  local applied=0
  for f in "${PREVIEW_DIR}/${slug}/database/migrations/"*_up.sql; do
    [ ! -f "$f" ] && continue
    local filename=$(basename "$f")
    [ "$filename" = "000_populate_tracking_table_up.sql" ] && continue
    local already=$(docker exec -i "$db_cont" psql -U whoeverwants -Atq "$db_name" \
      -c "SELECT COUNT(*) FROM _migrations WHERE filename = '$filename'")
    [ "$already" -gt 0 ] && continue
    echo "  Applying: $filename"
    docker exec -i "$db_cont" psql -U whoeverwants -q "$db_name" < "$f" 2>&1 || true
    docker exec -i "$db_cont" psql -U whoeverwants -q "$db_name" \
      -c "INSERT INTO _migrations (filename) VALUES ('$filename') ON CONFLICT DO NOTHING"
    applied=$((applied + 1))
  done
  echo "Applied $applied new migrations"

  # 6. Find available port and start FastAPI container
  local port=$(find_available_port)
  echo "--- Starting API container on port $port ---"
  docker build -t "preview-${slug}" "${PREVIEW_DIR}/${slug}/server"
  docker run -d \
    --name "$container_name" \
    --restart unless-stopped \
    --network whoeverwants_default \
    -e "DATABASE_URL=postgresql://whoeverwants:whoeverwants@db:5432/${db_name}" \
    -p "127.0.0.1:${port}:8000" \
    "preview-${slug}"

  # 7. Add Caddy route
  echo "--- Configuring Caddy ---"
  mkdir -p "$CADDY_PREVIEW_DIR"
  cat > "${CADDY_PREVIEW_DIR}/${slug}.caddy" <<EOF
${slug}.api.whoeverwants.com {
	header Access-Control-Allow-Origin *
	header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
	header Access-Control-Allow-Headers "Content-Type, Authorization"

	@options method OPTIONS
	handle @options {
		respond 204
	}

	reverse_proxy 127.0.0.1:${port}
}
EOF

  # Rebuild main Caddyfile with imports
  rebuild_caddyfile
  caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl restart caddy

  # 8. Write metadata
  cat > "${PREVIEW_DIR}/${slug}/.preview-meta.json" <<EOF
{
  "slug": "${slug}",
  "branch": "${branch}",
  "port": ${port},
  "database": "${db_name}",
  "container": "${container_name}",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "api_url": "https://${slug}.api.whoeverwants.com"
}
EOF

  echo ""
  echo "=== Preview ready ==="
  echo "  API: https://${slug}.api.whoeverwants.com"
  echo "  Port: $port"
  echo "  Database: $db_name"
  echo "  Container: $container_name"
  echo "  Worktree: ${PREVIEW_DIR}/${slug}"
}

rebuild_caddyfile() {
  # Read existing Caddyfile and keep only the base blocks (sslip.io + api.whoeverwants.com)
  # Then import all preview Caddy configs
  local ip_dashed=$(hostname -I | awk '{print $1}' | tr '.' '-')

  cat > /etc/caddy/Caddyfile <<EOF
${ip_dashed}.sslip.io {
	reverse_proxy 127.0.0.1:9090
}

api.whoeverwants.com {
	header Access-Control-Allow-Origin *
	header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
	header Access-Control-Allow-Headers "Content-Type, Authorization"

	@options method OPTIONS
	handle @options {
		respond 204
	}

	reverse_proxy 127.0.0.1:8000
}

import ${CADDY_PREVIEW_DIR}/*.caddy
EOF
}

cmd_list() {
  echo "SLUG                           BRANCH                                    PORT  CREATED              API URL"
  echo "----                           ------                                    ----  -------              -------"

  if [ ! -d "$PREVIEW_DIR" ]; then
    echo "(no previews)"
    return
  fi

  local found=0
  for meta in "${PREVIEW_DIR}"/*/.preview-meta.json; do
    [ ! -f "$meta" ] && continue
    found=1
    local slug=$(python3 -c "import json; d=json.load(open('$meta')); print(d['slug'])")
    local branch=$(python3 -c "import json; d=json.load(open('$meta')); print(d['branch'])")
    local port=$(python3 -c "import json; d=json.load(open('$meta')); print(d['port'])")
    local created=$(python3 -c "import json; d=json.load(open('$meta')); print(d['created_at'][:19])")
    local api_url=$(python3 -c "import json; d=json.load(open('$meta')); print(d['api_url'])")
    printf "%-30s %-40s %-5s %-20s %s\n" "$slug" "$branch" "$port" "$created" "$api_url"
  done

  [ "$found" -eq 0 ] && echo "(no previews)"
}

cmd_destroy() {
  local slug="${1:?Usage: preview-manager.sh destroy <slug>}"
  local container_name="preview-${slug}"
  local db_name="preview_${slug//-/_}"

  echo "=== Destroying preview: $slug ==="

  # 1. Stop and remove container
  echo "--- Removing container ---"
  docker stop "$container_name" 2>/dev/null || true
  docker rm "$container_name" 2>/dev/null || true
  docker rmi "preview-${slug}" 2>/dev/null || true

  # 2. Drop database
  echo "--- Dropping database ---"
  local db_cont=$(db_container)
  if [ -n "$db_cont" ]; then
    # Terminate active connections first
    docker exec "$db_cont" psql -U whoeverwants -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db_name}' AND pid <> pg_backend_pid();" 2>/dev/null || true
    docker exec "$db_cont" psql -U whoeverwants -c "DROP DATABASE IF EXISTS \"${db_name}\";" 2>/dev/null || true
  fi

  # 3. Remove Caddy config
  echo "--- Removing Caddy config ---"
  rm -f "${CADDY_PREVIEW_DIR}/${slug}.caddy"
  rebuild_caddyfile
  caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl restart caddy

  # 4. Remove worktree
  echo "--- Removing worktree ---"
  cd "$REPO_DIR"
  git worktree remove --force "${PREVIEW_DIR}/${slug}" 2>/dev/null || rm -rf "${PREVIEW_DIR}/${slug}"

  echo "=== Preview '$slug' destroyed ==="
}

cmd_destroy_all() {
  echo "=== Destroying all previews ==="
  if [ ! -d "$PREVIEW_DIR" ]; then
    echo "No previews to destroy."
    return
  fi

  for meta in "${PREVIEW_DIR}"/*/.preview-meta.json; do
    [ ! -f "$meta" ] && continue
    local slug=$(python3 -c "import json; d=json.load(open('$meta')); print(d['slug'])")
    cmd_destroy "$slug"
  done

  echo "=== All previews destroyed ==="
}

cmd_cleanup_old() {
  # Destroy previews older than 7 days
  local max_age_days="${1:-7}"
  local now=$(date +%s)

  if [ ! -d "$PREVIEW_DIR" ]; then
    return
  fi

  for meta in "${PREVIEW_DIR}"/*/.preview-meta.json; do
    [ ! -f "$meta" ] && continue
    local slug=$(python3 -c "import json; d=json.load(open('$meta')); print(d['slug'])")
    local created=$(python3 -c "import json; d=json.load(open('$meta')); print(d['created_at'])")
    local created_epoch=$(date -d "$created" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$created" +%s 2>/dev/null || echo 0)

    if [ "$created_epoch" -eq 0 ]; then
      continue
    fi

    local age_days=$(( (now - created_epoch) / 86400 ))
    if [ "$age_days" -ge "$max_age_days" ]; then
      echo "Preview '$slug' is ${age_days} days old (max: ${max_age_days}). Destroying..."
      cmd_destroy "$slug"
    fi
  done
}

# --- Main ---
case "${1:-help}" in
  create)      cmd_create "${2:-}" ;;
  list)        cmd_list ;;
  destroy)     cmd_destroy "${2:-}" ;;
  destroy-all) cmd_destroy_all ;;
  cleanup)     cmd_cleanup_old "${2:-7}" ;;
  *)
    echo "Usage: preview-manager.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  create <branch>   Create a preview environment for a branch"
    echo "  list              List all active previews"
    echo "  destroy <slug>    Destroy a specific preview"
    echo "  destroy-all       Destroy all previews"
    echo "  cleanup [days]    Destroy previews older than N days (default: 7)"
    exit 1
    ;;
esac
