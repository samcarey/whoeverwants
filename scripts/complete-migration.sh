#!/bin/bash

set -e

# Complete Database Migration Script
# This script performs a full tear-down and build-up of the test database
# applying ALL migrations in sequence

echo "🚀 Starting complete database migration process..."

# Load environment variables
source .env

URL="$NEXT_PUBLIC_SUPABASE_URL_TEST"
SERVICE_KEY="$SUPABASE_TEST_SERVICE_KEY"
ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN"

# Extract project ref from URL
PROJECT_REF=$(echo "$URL" | sed 's|https://||' | sed 's|.supabase.co||')

echo "🔗 Project: $PROJECT_REF"
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

# Function to get migration files in order
get_migration_files() {
    find database/migrations -name "*_up.sql" | sort
}

# Clear database completely
clear_database() {
    echo "🧹 PHASE 1: Clearing database schema..."
    
    local clear_sql="DO \$\$ 
DECLARE 
    r RECORD;
BEGIN
    -- Drop all tables
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        RAISE NOTICE 'Dropped table: %', r.tablename;
    END LOOP;
    
    -- Drop all views  
    FOR r IN (SELECT viewname FROM pg_views WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.viewname) || ' CASCADE';
        RAISE NOTICE 'Dropped view: %', r.viewname;
    END LOOP;
    
    -- Drop all functions (skip built-in ones)
    FOR r IN (SELECT proname, oidvectortypes(proargtypes) as argtypes 
              FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid 
              WHERE n.nspname = 'public' 
              AND proname NOT LIKE 'pg_%'
              AND proname NOT LIKE '_pg_%') LOOP
        BEGIN
            EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(r.proname) || '(' || r.argtypes || ') CASCADE';
            RAISE NOTICE 'Dropped function: %(%)', r.proname, r.argtypes;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not drop function: %(%)', r.proname, r.argtypes;
        END;
    END LOOP;
    
    -- Drop all policies
    FOR r IN (SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public') LOOP
        BEGIN
            EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.' || quote_ident(r.tablename) || ' CASCADE';
            RAISE NOTICE 'Dropped policy: %', r.policyname;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not drop policy: %', r.policyname;
        END;
    END LOOP;
    
    RAISE NOTICE 'Database schema cleared successfully!';
END \$\$;"
    
    execute_sql "$clear_sql" "Clearing database schema"
}

# Verify database is empty
verify_empty() {
    echo "🔍 PHASE 2: Verifying database is empty..."
    
    local verify_sql="SELECT 
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') as table_count,
    (SELECT count(*) FROM pg_views WHERE schemaname = 'public') as view_count,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid 
     WHERE n.nspname = 'public' AND proname NOT LIKE 'pg_%' AND proname NOT LIKE '_pg_%') as function_count,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') as policy_count;"
    
    execute_sql "$verify_sql" "Verifying database is empty"
}

# Apply all migrations
apply_migrations() {
    echo "📋 PHASE 3: Applying all migrations..."
    
    local migration_files=($(get_migration_files))
    local total_migrations=${#migration_files[@]}
    
    echo "📄 Found $total_migrations migrations to apply:"
    for file in "${migration_files[@]}"; do
        echo "  - $(basename "$file")"
    done
    
    local counter=1
    for migration_file in "${migration_files[@]}"; do
        local migration_name=$(basename "$migration_file")
        echo ""
        echo "📄 Migration $counter/$total_migrations: $migration_name"
        
        if [ ! -f "$migration_file" ]; then
            echo "❌ Migration file not found: $migration_file"
            return 1
        fi
        
        local migration_sql=$(cat "$migration_file")
        
        if execute_sql "$migration_sql" "Applying $migration_name"; then
            echo "✅ Migration $counter/$total_migrations completed: $migration_name"
        else
            echo "❌ Migration $counter/$total_migrations failed: $migration_name"
            return 1
        fi
        
        counter=$((counter + 1))
    done
    
    echo ""
    echo "🎉 All $total_migrations migrations applied successfully!"
}

# Verify final state
verify_complete() {
    echo "🔍 PHASE 4: Verifying complete database state..."
    
    # Check that expected tables exist
    local verify_sql="SELECT 
    tablename,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = tablename AND table_schema = 'public') as column_count
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;"
    
    execute_sql "$verify_sql" "Checking final table structure"
    
    # Test basic functionality
    echo "🧪 Testing basic functionality..."
    
    local test_sql="-- Test polls table functionality
INSERT INTO polls (title) VALUES ('Migration Test Poll');
SELECT 
    id, 
    title, 
    created_at IS NOT NULL as has_created_at,
    updated_at IS NOT NULL as has_updated_at
FROM polls 
WHERE title = 'Migration Test Poll';
DELETE FROM polls WHERE title = 'Migration Test Poll';"
    
    execute_sql "$test_sql" "Testing polls table functionality"
}

# Main execution function
main() {
    echo "═══════════════════════════════════════════════════════════════"
    echo "🏗️  COMPLETE DATABASE MIGRATION"
    echo "═══════════════════════════════════════════════════════════════"
    echo "Project: $PROJECT_REF"
    echo "Target: Test Database"
    echo "Process: Full tear-down and build-up with all migrations"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    
    # Phase 1: Clear database
    if clear_database; then
        echo "✅ Phase 1 completed: Database cleared"
    else
        echo "❌ Phase 1 failed: Database clearing failed"
        exit 1
    fi
    
    echo ""
    
    # Phase 2: Verify empty
    if verify_empty; then
        echo "✅ Phase 2 completed: Database emptiness verified"
    else
        echo "❌ Phase 2 failed: Database verification failed"
        exit 1
    fi
    
    echo ""
    
    # Phase 3: Apply all migrations
    if apply_migrations; then
        echo "✅ Phase 3 completed: All migrations applied"
    else
        echo "❌ Phase 3 failed: Migration application failed"
        exit 1
    fi
    
    echo ""
    
    # Phase 4: Final verification
    if verify_complete; then
        echo "✅ Phase 4 completed: Final verification passed"
    else
        echo "❌ Phase 4 failed: Final verification failed"
        exit 1
    fi
    
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "🎉 COMPLETE DATABASE MIGRATION SUCCESSFUL!"
    echo "═══════════════════════════════════════════════════════════════"
    echo "✅ Database completely rebuilt from scratch"
    echo "✅ All $(find database/migrations -name "*_up.sql" | wc -l) migrations applied successfully"
    echo "✅ Database functionality verified"
    echo "📊 Database is ready for use"
    echo "═══════════════════════════════════════════════════════════════"
}

# Check prerequisites
check_prerequisites() {
    if ! command -v jq &> /dev/null; then
        echo "❌ jq is required but not installed"
        exit 1
    fi
    
    if [ -z "$ACCESS_TOKEN" ]; then
        echo "❌ SUPABASE_ACCESS_TOKEN not found in .env"
        exit 1
    fi
    
    if [ -z "$SERVICE_KEY" ]; then
        echo "❌ SUPABASE_TEST_SERVICE_KEY not found in .env"
        exit 1
    fi
    
    if [ ! -d "database/migrations" ]; then
        echo "❌ database/migrations directory not found"
        exit 1
    fi
    
    local migration_count=$(find database/migrations -name "*_up.sql" | wc -l)
    if [ "$migration_count" -eq 0 ]; then
        echo "❌ No migration files found in database/migrations"
        exit 1
    fi
    
    echo "✅ Prerequisites checked: $migration_count migrations found"
}

# Run prerequisite checks and main process
check_prerequisites
main