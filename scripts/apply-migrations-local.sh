#!/bin/bash
# Apply all _up.sql migrations to local Docker Postgres (in order).
# Skips the 000_populate_tracking_table migration (Supabase-specific).
# Tracks applied migrations in a _migrations table.
#
# Usage: bash scripts/apply-migrations-local.sh [DATABASE_URL]
# Default: postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants

set -euo pipefail

DB_URL="${1:-postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants}"
MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../database/migrations" && pwd)"

echo "Applying migrations to: $DB_URL"

# Create tracking table if it doesn't exist
psql "$DB_URL" -q <<'SQL'
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
SQL

applied=0
skipped=0
failed=0

for f in "$MIGRATIONS_DIR"/*_up.sql; do
  filename="$(basename "$f")"

  # Skip the Supabase tracking table population
  if [[ "$filename" == "000_populate_tracking_table_up.sql" ]]; then
    continue
  fi

  # Check if already applied
  already=$(psql "$DB_URL" -Atq -c "SELECT COUNT(*) FROM _migrations WHERE filename = '$filename'")
  if [[ "$already" -gt 0 ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo "  Applying: $filename"
  if psql "$DB_URL" -q -f "$f" 2>&1; then
    psql "$DB_URL" -q -c "INSERT INTO _migrations (filename) VALUES ('$filename')"
    applied=$((applied + 1))
  else
    echo "  FAILED: $filename"
    failed=$((failed + 1))
    exit 1
  fi
done

echo ""
echo "Done. Applied: $applied, Skipped (already applied): $skipped, Failed: $failed"
