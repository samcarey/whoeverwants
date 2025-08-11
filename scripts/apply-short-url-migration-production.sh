#!/bin/bash

# Apply short URL migration to production database
# This script applies ONLY the new migration without rebuilding the entire database

set -e

echo "🚀 Applying Short URL Migration to PRODUCTION Database..."
echo ""
echo "⚠️  WARNING: This will modify the PRODUCTION database!"
echo "⚠️  This adds new columns but does NOT delete existing data"
echo ""
read -p "Type 'APPLY_TO_PRODUCTION' to continue: " confirmation

if [ "$confirmation" != "APPLY_TO_PRODUCTION" ]; then
    echo "❌ Migration cancelled"
    exit 1
fi

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check required environment variables
if [ -z "$NEXT_PUBLIC_SUPABASE_URL_PRODUCTION" ] || [ -z "$SUPABASE_ACCESS_TOKEN" ] || [ -z "$SUPABASE_ACCESS_TOKEN_PRODUCTION" ]; then
    echo "❌ Missing required environment variables"
    echo "Required: NEXT_PUBLIC_SUPABASE_URL_PRODUCTION, SUPABASE_ACCESS_TOKEN, SUPABASE_ACCESS_TOKEN_PRODUCTION"
    exit 1
fi

# Extract project ref from URL
PROJECT_REF=$(echo $NEXT_PUBLIC_SUPABASE_URL_PRODUCTION | sed 's/https:\/\/\([^.]*\).*/\1/')

echo "📋 Project: $PROJECT_REF (PRODUCTION)"
echo "🌐 URL: $NEXT_PUBLIC_SUPABASE_URL_PRODUCTION"
echo ""

# Function to execute SQL via Management API
execute_sql() {
    local sql="$1"
    local description="$2"
    
    echo "🔄 $description..."
    
    # Escape the SQL for JSON - basic escaping without jq
    escaped_sql=$(echo "$sql" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    
    response=$(curl -s -X POST \
        "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
        -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -H "X-Connection-Encrypted: true" \
        -d "{\"query\": \"$escaped_sql\"}" \
        -w "\n%{http_code}")
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        echo "✅ $description completed (HTTP $http_code)"
        return 0
    else
        echo "❌ $description failed (HTTP $http_code)"
        echo "Response: $body"
        return 1
    fi
}

# Read the migration file
MIGRATION_FILE="database/migrations/021_add_sequential_id_and_short_id_up.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Migration file not found: $MIGRATION_FILE"
    exit 1
fi

echo "📄 Applying migration: $MIGRATION_FILE"
MIGRATION_SQL=$(cat "$MIGRATION_FILE")

# Apply the migration
if execute_sql "$MIGRATION_SQL" "Applying short URL migration"; then
    echo ""
    echo "🎉 SHORT URL MIGRATION SUCCESSFUL!"
    echo "✅ Production database now supports short URLs"
    echo "✅ Existing polls will get short IDs automatically"
    echo ""
    echo "📊 Next steps:"
    echo "1. Deploy the updated code to production"
    echo "2. New polls will automatically get short URLs"
    echo "3. Existing polls can be accessed with both old and new URLs"
else
    echo ""
    echo "❌ Migration failed!"
    echo "Please check the error message above"
    exit 1
fi