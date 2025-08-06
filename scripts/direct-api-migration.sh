#!/bin/bash

set -e

# Load environment variables
source .env

echo "🚀 Direct API Migration using Supabase Management API..."

URL="$NEXT_PUBLIC_SUPABASE_URL_TEST"
SERVICE_KEY="$SUPABASE_TEST_SERVICE_KEY"
ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN"

# Extract project ref from URL
PROJECT_REF=$(echo "$URL" | sed 's|https://||' | sed 's|.supabase.co||')

echo "🔗 Project: $PROJECT_REF"
echo "🌐 URL: $URL"

# Function to execute SQL via Management API
execute_sql_mgmt() {
    local sql="$1"
    local description="$2"
    
    echo "🔄 $description..."
    
    # Create properly formatted JSON payload
    local json_payload=$(jq -n --arg query "$sql" '{"query": $query}')
    
    # Use Supabase Management API to execute SQL
    response=$(curl -s -w "\n%{http_code}" \
        -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$json_payload")
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        echo "✅ $description completed (HTTP $http_code)"
        return 0
    else
        echo "❌ $description failed (HTTP $http_code)"
        echo "Response: $body"
        return 1
    fi
}

# Function to verify database is cleared
verify_cleared() {
    echo "🔍 Verifying database is cleared..."
    
    # Try to query a table that should not exist
    response=$(curl -s \
        -H "Authorization: Bearer $SERVICE_KEY" \
        -H "apikey: $SERVICE_KEY" \
        "$URL/rest/v1/polls?select=count" 2>/dev/null)
    
    if echo "$response" | grep -q "relation.*does not exist"; then
        echo "✅ Database appears to be cleared (polls table not found)"
        return 0
    else
        echo "⚠️  Database may still contain tables"
        return 1
    fi
}

# Clear database using Management API
clear_database() {
    local clear_sql="DO \$\$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        RAISE NOTICE 'Dropped table: %', r.tablename;
    END LOOP;
END \$\$;"
    
    execute_sql_mgmt "$clear_sql" "Clearing database schema"
}


# Check if we have required tools
if ! command -v jq &> /dev/null; then
    echo "❌ jq is required but not installed"
    exit 1
fi

# Main execution based on command
case "${1:-}" in
    "clear")
        echo "🎯 Clearing database only..."
        if clear_database; then
            echo "✅ Database cleared successfully"
            verify_cleared
        else
            echo "❌ Database clearing failed"
            exit 1
        fi
        ;;
    *)
        echo "Usage:"
        echo "  ./scripts/direct-api-migration.sh clear   - Clear database only"
        echo ""
        echo "For complete database rebuild with all migrations, use:"
        echo "  ./scripts/complete-migration.sh"
        exit 1
        ;;
esac