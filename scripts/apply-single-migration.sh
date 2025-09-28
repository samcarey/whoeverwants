#!/bin/bash

# Apply a single migration file directly to the database
# This is useful when the migration tracking system has issues

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Get migration file from argument
MIGRATION_FILE=$1

if [ -z "$MIGRATION_FILE" ]; then
    echo "Usage: $0 <migration_file.sql>"
    exit 1
fi

if [ ! -f "$MIGRATION_FILE" ]; then
    echo "Error: Migration file not found: $MIGRATION_FILE"
    exit 1
fi

# Use test database
PROJECT_REF="kfngceqepnzlljkwedtd"
ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN}"

echo "📄 Applying migration: $(basename $MIGRATION_FILE)"
echo "🔗 Project: $PROJECT_REF"

# Read SQL file content
SQL_CONTENT=$(cat "$MIGRATION_FILE")

# Execute via Management API
echo "🔄 Executing SQL..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"query\": $(echo "$SQL_CONTENT" | jq -Rs .)}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Migration applied successfully!"
else
    echo "❌ Migration failed (HTTP $HTTP_CODE)"
    echo "Response: $BODY"
    exit 1
fi