#!/bin/bash

set -e

# Load environment variables
source .env

echo "🔍 Investigating Poll Issue..."

# Use production database
URL="$NEXT_PUBLIC_SUPABASE_URL_PRODUCTION"
SERVICE_KEY="$SUPABASE_ACCESS_TOKEN_PRODUCTION"
ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN"
POLL_ID="79839ecb-f39e-4655-be7d-71b3abddbcfc"

# Extract project ref from URL
PROJECT_REF=$(echo "$URL" | sed 's|https://||' | sed 's|.supabase.co||')

echo "🔗 Project: $PROJECT_REF"
echo "🌐 URL: $URL"
echo "🎯 Poll ID: $POLL_ID"

# Function to execute SQL query via Management API
query_sql() {
    local sql="$1"
    local description="$2"
    
    echo ""
    echo "🔄 $description..."
    
    # Create JSON payload without jq
    local escaped_sql=$(echo "$sql" | sed 's/"/\\"/g' | sed 's/$/\\n/' | tr -d '\n')
    local json_payload="{\"query\": \"$escaped_sql\"}"
    
    # Use Supabase Management API to execute SQL
    response=$(curl -s -w "\n%{http_code}" \
        -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$json_payload")
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        echo "✅ Query executed successfully (HTTP $http_code)"
        echo "📊 Results:"
        if [ "$HAVE_JQ" = true ]; then
            echo "$body" | jq '.'
        else
            echo "$body"
        fi
        return 0
    else
        echo "❌ Query failed (HTTP $http_code)"
        echo "Response: $body"
        return 1
    fi
}

# Check if we have jq, but don't require it
if ! command -v jq &> /dev/null; then
    echo "⚠️  jq not available, using basic text processing"
    HAVE_JQ=false
else
    HAVE_JQ=true
fi

echo ""
echo "========================================"
echo "INVESTIGATING POLL: $POLL_ID"
echo "========================================"

# 1. Get poll details
query_sql "SELECT id, title, poll_type, options, created_at FROM polls WHERE id = '$POLL_ID';" "Getting poll details"

# 2. Get all votes for this poll
query_sql "SELECT id, vote_type, yes_no_choice, ranked_choices, created_at FROM votes WHERE poll_id = '$POLL_ID' ORDER BY created_at;" "Getting all votes"

# 3. Get ranked choice rounds
query_sql "SELECT round_number, option_name, vote_count, is_eliminated FROM ranked_choice_rounds WHERE poll_id = '$POLL_ID' ORDER BY round_number, vote_count DESC;" "Getting ranked choice elimination rounds"

# 4. Get poll results view
query_sql "SELECT * FROM poll_results WHERE poll_id = '$POLL_ID';" "Getting poll results from view"

# 5. Manually recalculate ranked choice winner to see if there's a bug
echo ""
echo "🧮 Manually recalculating ranked choice winner..."
query_sql "SELECT * FROM calculate_ranked_choice_winner('$POLL_ID');" "Recalculating ranked choice winner"

echo ""
echo "========================================"
echo "INVESTIGATION COMPLETE"
echo "========================================"