# WhoeverWants Development Environment

## 🚀 AUTO-STARTING SERVICES

This project has systemd services configured to automatically run the development server and Pinggy tunnel on system boot.

### Service Status Check
**IMPORTANT**: Always check that these services are running when working on this project:

```bash
# Check if services are running
sudo systemctl status whoeverwants-dev whoeverwants-tunnel

# If not running, start them:
sudo systemctl start whoeverwants-dev
sudo systemctl start whoeverwants-tunnel
```

### Development URL
When services are running, the application is accessible at:
- **Public URL**: http://decisionbot.a.pinggy.link (requires Pinggy Pro)
- **Local URL**: http://localhost:3000

### Pinggy Pro Configuration
To use the persistent `decisionbot.a.pinggy.link` subdomain, you need to set your Pinggy Pro token:

```bash
# Add to ~/.bashrc or set before running tunnel
export PINGGY_TOKEN=your_pinggy_token_here
```

Without the token, the tunnel will use a free temporary URL that expires in 60 minutes.

### Service Details

#### 1. **whoeverwants-dev.service**
- Runs the Next.js development server (`npm run dev`)
- Auto-restarts on failure
- Listens on port 3000

#### 2. **whoeverwants-tunnel.service**
- Creates a Pinggy tunnel to expose port 3000 to the internet
- Domain: decisionbot.a.pinggy.link
- Depends on the dev service

### Service Management Commands

```bash
# View logs
sudo journalctl -u whoeverwants-dev -f      # Dev server logs
sudo journalctl -u whoeverwants-tunnel -f   # Tunnel logs

# Control services
sudo systemctl restart whoeverwants-dev     # Restart dev server
sudo systemctl restart whoeverwants-tunnel  # Restart tunnel
sudo systemctl stop whoeverwants-dev whoeverwants-tunnel    # Stop both
sudo systemctl start whoeverwants-dev whoeverwants-tunnel   # Start both

# Check status
sudo systemctl status whoeverwants-dev
sudo systemctl status whoeverwants-tunnel
```

### Initial Setup (If Services Not Installed)

If the services are not yet installed on the system:

```bash
# Run the setup script
sudo /home/ubuntu/whoeverwants/scripts/setup-services.sh
```

This will:
1. Copy service files to `/etc/systemd/system/`
2. Enable services to start on boot
3. Start the services immediately

### Service Files Location
- Service definitions: `/home/ubuntu/whoeverwants/services/`
- Setup script: `/home/ubuntu/whoeverwants/scripts/setup-services.sh`

### Troubleshooting

If services fail to start:
1. Check Node.js is available: `which node`
2. Check npm packages are installed: `cd /home/ubuntu/whoeverwants && npm install`
3. Check port 3000 is free: `sudo lsof -i :3000`
4. View detailed logs: `sudo journalctl -u whoeverwants-dev -n 100`

---

# Database Migration System

This project has a complete automated database migration system for Supabase test databases.

## Quick Commands

### Test Database Operations
```bash
# Tear down entire TEST database and rebuild with all migrations
./scripts/complete-migration.sh
# OR use npm script:
npm run db:rebuild-test

# Clear TEST database only
./scripts/direct-api-migration.sh clear
# OR use npm script:
npm run db:clear-test
```

### Production Database Operations
```bash
# ⚠️ DANGER: Tear down entire PRODUCTION database and rebuild with all migrations
# This PERMANENTLY DELETES all production data!
./scripts/complete-migration-production.sh
# OR use npm script:
npm run db:rebuild-production
```

## How It Works

The migration system uses **Supabase Management API** to execute SQL directly, bypassing PostgreSQL connection issues in containerized environments like GitHub Codespaces.

### Key Components

1. **`scripts/complete-migration.sh`** - Full TEST database tear-down/rebuild
   - Clears all tables, views, functions, policies from test database
   - Applies ALL migrations in `database/migrations/` in order
   - Verifies each step with comprehensive checks
   - Tests final functionality

2. **`scripts/complete-migration-production.sh`** - Full PRODUCTION database tear-down/rebuild
   - ⚠️ **DANGER**: Permanently deletes ALL production data
   - Requires manual confirmation: type `CONFIRM_PRODUCTION_REBUILD`
   - Same process as test script but targets production database
   - Includes multiple safety warnings

3. **`scripts/direct-api-migration.sh`** - Database clearing utility (TEST only)
   - Can clear database schema without running migrations
   - Uses same API approach as complete script

4. **Migration Files Location**: `database/migrations/`
   - Format: `XXX_description_up.sql` (e.g., `001_create_polls_table_up.sql`)
   - Script automatically finds and sorts all `*_up.sql` files

### Authentication & Configuration

The system uses these environment variables from `.env`:

**For Test Database:**
- `NEXT_PUBLIC_SUPABASE_URL_TEST` - Test database URL
- `SUPABASE_TEST_SERVICE_KEY` - Service role key for API access
- `SUPABASE_ACCESS_TOKEN` - Personal access token for Management API

**For Production Database:**
- `NEXT_PUBLIC_SUPABASE_URL_PRODUCTION` - Production database URL
- `SUPABASE_ACCESS_TOKEN_PRODUCTION` - Production service role key
- `SUPABASE_ACCESS_TOKEN` - Personal access token for Management API (same as test)

### API Approach Details

Instead of direct PostgreSQL connections (which are blocked in many cloud environments), the system uses:

1. **Supabase Management API** (`https://api.supabase.com/v1/projects/{ref}/database/query`)
   - Executes arbitrary SQL with Management API access token
   - Returns HTTP 200/201 for success
   - Handles complex multi-statement SQL blocks

2. **PostgREST API** (`https://{project}.supabase.co/rest/v1/`)
   - Used for verification queries (checking table existence, etc.)
   - Uses service role key for authentication

### Migration Process

1. **PHASE 1: Clear Database**
   - Drops all tables, views, functions, policies in public schema
   - Uses PL/pgSQL DO blocks for batch operations
   - Preserves system/extension objects

2. **PHASE 2: Verify Empty**
   - Confirms all user objects removed
   - Counts remaining objects (should be 0)

3. **PHASE 3: Apply Migrations**
   - Finds all `*_up.sql` files in `database/migrations/`
   - Sorts them alphabetically (001, 002, etc.)
   - Applies each migration sequentially
   - Stops on first failure

4. **PHASE 4: Final Verification**
   - Lists all created tables and column counts
   - Tests basic functionality (insert/select/delete)
   - Confirms database is ready for use

## Current Migrations

The project has 15 migrations total:
1. `001_create_polls_table_up.sql` - Basic polls table
2. `002_add_response_deadline_up.sql` - Response deadlines
3. `003_add_poll_type_and_options_up.sql` - Poll types/options
4. `004_create_votes_table_up.sql` - Voting system
5. `005_create_poll_results_view_up.sql` - Results view
6. `006_create_ranked_choice_rounds_table_up.sql` - Ranked choice
7. `007_add_creator_secret_up.sql` - Creator auth
8. `008_create_ranked_choice_function_up.sql` - RC algorithm
9. `009_update_poll_results_view_up.sql` - Updated results
10. `010_fix_ranked_choice_rls_v2_up.sql` - RLS fixes
11. `011_fix_array_handling_up.sql` - Array handling
12. `012_fix_remaining_options_bug_up.sql` - Options bug fix
13. `013_add_is_closed_field_up.sql` - Poll closing
14. `014_fix_ranked_choice_bug_up.sql` - RC bug fix
15. `015_add_polls_update_policy_up.sql` - Update policies

## Troubleshooting

### Common Issues
- **jq not found**: Install with `apt-get install jq` or similar
- **Access token missing**: Ensure `SUPABASE_ACCESS_TOKEN` is set in `.env`
- **HTTP 401/403**: Check that access token has project permissions
- **Migration fails**: Check SQL syntax in individual migration files

### Network Issues
This system specifically works around PostgreSQL connection issues in:
- GitHub Codespaces
- Docker containers  
- Restricted network environments
- IPv6 connectivity problems

The Management API approach bypasses these limitations entirely.

## Success Indicators

When complete migration succeeds, you'll see:
```
🎉 COMPLETE DATABASE MIGRATION SUCCESSFUL!
✅ Database completely rebuilt from scratch
✅ All 15 migrations applied successfully  
✅ Database functionality verified
📊 Database is ready for use
```

The database will be completely reset and rebuilt with the latest schema.

## Database Status Summary

### Test Database (kfngceqepnzlljkwedtd)
- **URL**: https://kfngceqepnzlljkwedtd.supabase.co
- **Status**: ✅ **READY** - All 15 migrations applied
- **Last Updated**: Most recent migration run
- **Data**: Test data only (safe to rebuild)

### Production Database (kifnvombihyfwszuwqvy)  
- **URL**: https://kifnvombihyfwszuwqvy.supabase.co
- **Status**: ✅ **READY** - All 15 migrations applied
- **Last Updated**: Most recent migration run
- **Data**: ⚠️ **PRODUCTION** - Contains live user data when active

## Safety Guidelines

### Test Database
- ✅ Safe to rebuild anytime with `./scripts/complete-migration.sh`
- ✅ No confirmation required
- ✅ Use for development and testing

### Production Database
- ⚠️ **EXTREME CAUTION** required
- ⚠️ Must type `CONFIRM_PRODUCTION_REBUILD` to proceed
- ⚠️ **ALL PRODUCTION DATA WILL BE PERMANENTLY LOST**
- ⚠️ Only use for fresh deployments or complete resets
- ⚠️ Consider data backup strategies before running