#!/bin/bash

set -e

# Complete Database Migration Script - PRODUCTION VERSION
# This script performs a full tear-down and build-up of the PRODUCTION database
# applying ALL migrations in sequence

echo "🚨 PRODUCTION DATABASE MIGRATION STARTING..."
echo "⚠️  WARNING: This will completely rebuild the PRODUCTION database!"
echo "⚠️  All existing data will be PERMANENTLY LOST!"
echo ""

# Load environment variables
source .env

URL="$NEXT_PUBLIC_SUPABASE_URL_PRODUCTION"
SERVICE_KEY="$SUPABASE_ACCESS_TOKEN_PRODUCTION"
ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN"

# Extract project ref from URL
PROJECT_REF=$(echo "$URL" | sed 's|https://||' | sed 's|.supabase.co||')

echo "🔗 Production Project: $PROJECT_REF"
echo "🌐 Production URL: $URL"
echo ""

# Safety confirmation
read -p "🚨 Type 'CONFIRM_PRODUCTION_REBUILD' to proceed: " confirmation
if [ "$confirmation" != "CONFIRM_PRODUCTION_REBUILD" ]; then
    echo "❌ Migration cancelled - confirmation not provided"
    exit 1
fi

echo ""
echo "🚀 Proceeding with PRODUCTION database migration..."

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
    echo "🧹 PHASE 1: Clearing PRODUCTION database schema..."
    
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
    
    RAISE NOTICE 'PRODUCTION database schema cleared successfully!';
END \$\$;"
    
    execute_sql "$clear_sql" "Clearing PRODUCTION database schema"
}

# Verify database is empty
verify_empty() {
    echo "🔍 PHASE 2: Verifying PRODUCTION database is empty..."
    
    local verify_sql="SELECT 
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') as table_count,
    (SELECT count(*) FROM pg_views WHERE schemaname = 'public') as view_count,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid 
     WHERE n.nspname = 'public' AND proname NOT LIKE 'pg_%' AND proname NOT LIKE '_pg_%') as function_count,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') as policy_count;"
    
    execute_sql "$verify_sql" "Verifying PRODUCTION database is empty"
}

# Apply all migrations
apply_migrations() {
    echo "📋 PHASE 3: Applying all migrations to PRODUCTION..."
    
    local migration_files=($(get_migration_files))
    local total_migrations=${#migration_files[@]}
    
    echo "📄 Found $total_migrations migrations to apply to PRODUCTION:"
    for file in "${migration_files[@]}"; do
        echo "  - $(basename "$file")"
    done
    
    local counter=1
    for migration_file in "${migration_files[@]}"; do
        local migration_name=$(basename "$migration_file")
        echo ""
        echo "📄 PRODUCTION Migration $counter/$total_migrations: $migration_name"
        
        if [ ! -f "$migration_file" ]; then
            echo "❌ Migration file not found: $migration_file"
            return 1
        fi
        
        local migration_sql=$(cat "$migration_file")
        
        if execute_sql "$migration_sql" "Applying $migration_name to PRODUCTION"; then
            echo "✅ PRODUCTION Migration $counter/$total_migrations completed: $migration_name"
        else
            echo "❌ PRODUCTION Migration $counter/$total_migrations failed: $migration_name"
            return 1
        fi
        
        counter=$((counter + 1))
    done
    
    echo ""
    echo "🎉 All $total_migrations migrations applied successfully to PRODUCTION!"
}

# Verify final state
verify_complete() {
    echo "🔍 PHASE 4: Verifying complete PRODUCTION database state..."
    
    # Check that expected tables exist
    local verify_sql="SELECT 
    tablename,
    (SELECT count(*) FROM information_schema.columns WHERE table_name = tablename AND table_schema = 'public') as column_count
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;"
    
    execute_sql "$verify_sql" "Checking final PRODUCTION table structure"
    
    # Test basic functionality
    echo "🧪 Testing basic PRODUCTION functionality..."
    
    local test_sql="-- Test polls table functionality in PRODUCTION
INSERT INTO polls (title) VALUES ('PRODUCTION Migration Test Poll');
SELECT 
    id, 
    title, 
    created_at IS NOT NULL as has_created_at,
    updated_at IS NOT NULL as has_updated_at
FROM polls 
WHERE title = 'PRODUCTION Migration Test Poll';
DELETE FROM polls WHERE title = 'PRODUCTION Migration Test Poll';"
    
    execute_sql "$test_sql" "Testing PRODUCTION polls table functionality"
}

# Main execution function
main() {
    echo "═══════════════════════════════════════════════════════════════"
    echo "🏭 PRODUCTION DATABASE MIGRATION"
    echo "═══════════════════════════════════════════════════════════════"
    echo "Project: $PROJECT_REF"
    echo "Target: PRODUCTION Database"
    echo "Process: Full tear-down and build-up with all migrations"
    echo "⚠️  WARNING: PRODUCTION DATA WILL BE PERMANENTLY LOST!"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    
    # Phase 1: Clear database
    if clear_database; then
        echo "✅ Phase 1 completed: PRODUCTION Database cleared"
    else
        echo "❌ Phase 1 failed: PRODUCTION Database clearing failed"
        exit 1
    fi
    
    echo ""
    
    # Phase 2: Verify empty
    if verify_empty; then
        echo "✅ Phase 2 completed: PRODUCTION Database emptiness verified"
    else
        echo "❌ Phase 2 failed: PRODUCTION Database verification failed"
        exit 1
    fi
    
    echo ""
    
    # Phase 3: Apply all migrations
    if apply_migrations; then
        echo "✅ Phase 3 completed: All migrations applied to PRODUCTION"
    else
        echo "❌ Phase 3 failed: PRODUCTION Migration application failed"
        exit 1
    fi
    
    echo ""
    
    # Phase 4: Final verification
    if verify_complete; then
        echo "✅ Phase 4 completed: PRODUCTION Final verification passed"
    else
        echo "❌ Phase 4 failed: PRODUCTION Final verification failed"
        exit 1
    fi
    
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "🎉 PRODUCTION DATABASE MIGRATION SUCCESSFUL!"
    echo "═══════════════════════════════════════════════════════════════"
    echo "✅ PRODUCTION Database completely rebuilt from scratch"
    echo "✅ All $(find database/migrations -name "*_up.sql" | wc -l) migrations applied successfully to PRODUCTION"
    echo "✅ PRODUCTION Database functionality verified"
    echo "📊 PRODUCTION Database is ready for use"
    echo "⚠️  Remember: All previous PRODUCTION data has been permanently lost"
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
    
    if [ -z "$URL" ]; then
        echo "❌ NEXT_PUBLIC_SUPABASE_URL_PRODUCTION not found in .env"
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
    
    echo "✅ PRODUCTION Prerequisites checked: $migration_count migrations found"
}

# Run prerequisite checks and main process
check_prerequisites
main