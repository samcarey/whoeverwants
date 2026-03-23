#!/usr/bin/env bash
# Apply all *_up.sql migrations to a dev database.
# Usage: apply-dev-migrations.sh <db_name> <migrations_dir>
#
# Creates the _migrations table if it doesn't exist, then applies any
# migration files not yet recorded, in filename order.

set -euo pipefail

DB_NAME="${1:?Usage: apply-dev-migrations.sh <db_name> <migrations_dir>}"
MIGRATIONS_DIR="${2:?Usage: apply-dev-migrations.sh <db_name> <migrations_dir>}"
CONTAINER="whoeverwants-db-1"
DB_USER="whoeverwants"

run_sql() {
  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "$1"
}

run_sql_file() {
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$1"
}

# Ensure _migrations table exists
run_sql "CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);" >/dev/null 2>&1

# Get already-applied migrations
applied=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT filename FROM _migrations;")

# Find and apply pending *_up.sql migrations
pending=0
for f in "$MIGRATIONS_DIR"/*_up.sql; do
  [ -f "$f" ] || continue
  basename=$(basename "$f")
  # Re-read applied list each iteration (some migrations like 000_* insert tracking rows)
  applied=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT filename FROM _migrations;" 2>/dev/null || echo "")
  if echo "$applied" | grep -qxF "$basename"; then
    continue
  fi
  echo "  Applying: $basename"
  run_sql_file "$f"
  run_sql "INSERT INTO _migrations (filename) VALUES ('$basename') ON CONFLICT DO NOTHING;" >/dev/null
  pending=$((pending + 1))
done

if [ "$pending" -eq 0 ]; then
  echo "  All migrations already applied."
else
  echo "  Applied $pending migration(s)."
fi
