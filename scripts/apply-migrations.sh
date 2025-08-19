#!/bin/bash

set -e

# Additive Database Migration Script
# This script applies only NEW migrations without destroying existing data
# It tracks which migrations have been applied and only runs new ones

echo "📦 Starting additive database migration process..."

# Load environment variables
source .env

# Determine if we're running in production or test
if [ "$1" == "production" ]; then
    echo "🔴 Running migrations on PRODUCTION database"
    URL="$NEXT_PUBLIC_SUPABASE_URL_PRODUCTION"
    SERVICE_KEY="$SUPABASE_ACCESS_TOKEN_PRODUCTION"
    DB_NAME="PRODUCTION"
else
    echo "🟢 Running migrations on TEST database"
    URL="$NEXT_PUBLIC_SUPABASE_URL_TEST"
    SERVICE_KEY="$SUPABASE_TEST_SERVICE_KEY"
    DB_NAME="TEST"
fi

ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN"

# Extract project ref from URL
PROJECT_REF=$(echo "$URL" | sed 's|https://||' | sed 's|.supabase.co||')

echo "🔗 Project: $PROJECT_REF ($DB_NAME)"
echo "🌐 URL: $URL"

# Function to execute SQL via Management API
execute_sql() {
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

# Create migrations tracking table if it doesn't exist
create_migrations_table() {
    local create_table_sql="
    CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        checksum TEXT
    );
    
    -- Add comment for documentation
    COMMENT ON TABLE _migrations IS 'Tracks applied database migrations to prevent re-running';
    "
    
    execute_sql "$create_table_sql" "Creating migrations tracking table"
}

# Get list of already applied migrations
get_applied_migrations() {
    local query_sql="SELECT filename FROM _migrations ORDER BY filename;"
    
    # Execute query and parse response
    response=$(curl -s \
        -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"$query_sql\"}")
    
    # Extract filenames from JSON response using jq
    echo "$response" | jq -r '.[] | .filename' 2>/dev/null || echo ""
}

# Get list of migration files
get_migration_files() {
    find database/migrations -name "*_up.sql" -type f | sort
}

# Calculate checksum of migration file
calculate_checksum() {
    local file="$1"
    if command -v sha256sum > /dev/null; then
        sha256sum "$file" | cut -d' ' -f1
    elif command -v shasum > /dev/null; then
        shasum -a 256 "$file" | cut -d' ' -f1
    else
        echo "no-checksum-available"
    fi
}

# Apply a single migration
apply_migration() {
    local migration_file="$1"
    local migration_name=$(basename "$migration_file")
    local checksum=$(calculate_checksum "$migration_file")
    
    echo "📄 Applying migration: $migration_name"
    
    if [ ! -f "$migration_file" ]; then
        echo "❌ Migration file not found: $migration_file"
        return 1
    fi
    
    # Read migration content
    local migration_sql=$(cat "$migration_file")
    
    # Wrap migration in a transaction with tracking
    local full_sql="
    BEGIN;
    
    -- Apply the migration
    $migration_sql
    
    -- Record that this migration was applied
    INSERT INTO _migrations (filename, checksum) 
    VALUES ('$migration_name', '$checksum')
    ON CONFLICT (filename) DO NOTHING;
    
    COMMIT;
    "
    
    if execute_sql "$full_sql" "Applying $migration_name"; then
        echo "✅ Migration applied: $migration_name"
        return 0
    else
        echo "❌ Migration failed: $migration_name"
        return 1
    fi
}

# Main migration process
main() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "📚 ADDITIVE DATABASE MIGRATION"
    echo "═══════════════════════════════════════════════════════════════"
    echo "Database: $DB_NAME"
    echo "Project: $PROJECT_REF"
    echo "Mode: Apply only new migrations (preserves existing data)"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    
    # Step 1: Create migrations tracking table
    echo "📋 STEP 1: Ensuring migrations tracking table exists..."
    if ! create_migrations_table; then
        echo "❌ Failed to create migrations tracking table"
        exit 1
    fi
    
    # Step 2: Get list of applied migrations
    echo ""
    echo "📋 STEP 2: Checking previously applied migrations..."
    applied_migrations=$(get_applied_migrations)
    
    if [ -n "$applied_migrations" ]; then
        echo "Found $(echo "$applied_migrations" | wc -l) previously applied migrations"
    else
        echo "No previously applied migrations found"
    fi
    
    # Step 3: Get all migration files
    echo ""
    echo "📋 STEP 3: Scanning for migration files..."
    all_migrations=($(get_migration_files))
    echo "Found ${#all_migrations[@]} total migration files"
    
    # Step 4: Determine which migrations need to be applied
    echo ""
    echo "📋 STEP 4: Determining new migrations to apply..."
    new_migrations=()
    
    for migration_file in "${all_migrations[@]}"; do
        migration_name=$(basename "$migration_file")
        
        # Check if this migration has already been applied
        if echo "$applied_migrations" | grep -q "^$migration_name$"; then
            echo "  ✓ Already applied: $migration_name"
        else
            echo "  → New migration: $migration_name"
            new_migrations+=("$migration_file")
        fi
    done
    
    # Step 5: Apply new migrations
    if [ ${#new_migrations[@]} -eq 0 ]; then
        echo ""
        echo "✨ No new migrations to apply. Database is up to date!"
        return 0
    fi
    
    echo ""
    echo "📋 STEP 5: Applying ${#new_migrations[@]} new migrations..."
    echo ""
    
    local success_count=0
    local fail_count=0
    
    for migration_file in "${new_migrations[@]}"; do
        if apply_migration "$migration_file"; then
            ((success_count++))
        else
            ((fail_count++))
            echo "⚠️ Stopping due to migration failure"
            break
        fi
        echo ""
    done
    
    # Final summary
    echo "═══════════════════════════════════════════════════════════════"
    if [ $fail_count -eq 0 ]; then
        echo "🎉 MIGRATION COMPLETE!"
        echo "✅ Successfully applied $success_count new migrations"
        echo "📊 Database is up to date with all migrations"
    else
        echo "⚠️ MIGRATION PARTIALLY COMPLETE"
        echo "✅ Successfully applied $success_count migrations"
        echo "❌ Failed to apply $fail_count migrations"
        echo "🔧 Fix the failed migration and run again"
    fi
    echo "═══════════════════════════════════════════════════════════════"
}

# Confirmation for production
if [ "$1" == "production" ]; then
    echo ""
    echo "⚠️ ⚠️ ⚠️  WARNING: PRODUCTION DATABASE ⚠️ ⚠️ ⚠️"
    echo "You are about to apply migrations to the PRODUCTION database."
    echo "This will modify the production schema."
    echo ""
    echo "Type 'yes' to continue or anything else to abort:"
    read confirmation
    
    if [ "$confirmation" != "yes" ]; then
        echo "❌ Aborted. No changes were made."
        exit 1
    fi
fi

# Run the main migration process
main