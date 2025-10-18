# WhoeverWants Development Environment

## ⚠️ CRITICAL: URL TESTING PROTOCOL

**NEVER mention a URL as working without testing it first.**

Before claiming any URL is accessible, ALWAYS run:
```bash
# Test local dev server (check which port Next.js is actually using)
curl -s -I http://localhost:3000 | head -3
```

**Only mention URLs after confirming 200 OK responses.**

## ⚠️ CRITICAL: DEV SERVER PORT MANAGEMENT

**The development server MUST ALWAYS run on port 3000.** Never allow Next.js to auto-select alternative ports like 3001, 3002, etc.

### Why Port 3000 is Required:
- Tailscale network access is configured for port 3000
- Multiple dev servers cause cache conflicts and debugging issues

### If Port 3000 is Busy:
```bash
# 1. Find what's using port 3000
lsof -i :3000

# 2. Check for multiple npm/node processes
ps aux | grep -E "(npm|node|next)" | grep -v grep

# 3. Kill ALL existing dev servers (use actual PIDs from step 2)
kill -9 [PID1] [PID2] [PID3]

# 4. Clear Next.js cache and restart the background service
rm -rf .next
launchctl unload ~/Library/LaunchAgents/com.whoeverwants.dev.plist && launchctl load ~/Library/LaunchAgents/com.whoeverwants.dev.plist
```

**Note:** The dev server runs as a macOS background service (LaunchAgent), not manually via `npm run dev`.

### Port Verification:
Always verify the dev server started on port 3000:
```bash
curl -s -I http://localhost:3000 | head -3
```

**NEVER proceed with development if the server is running on any port other than 3000.**

## ⚠️ CRITICAL: HYDRATION ERROR PREVENTION

**React hydration errors occur when server-rendered HTML doesn't match client-rendered HTML.**

### Common Causes & Solutions

#### ❌ **NEVER do this:**
```typescript
// Date/time calculations that differ between server/client
const getTodayDate = () => {
  const today = new Date(); // ← Different on server vs client!
  return `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
};

// Conditional rendering based on client-side checks
min={isClient ? getTodayDate() : undefined} // ← Hydration mismatch!

// Direct access to window/localStorage in render
const value = localStorage.getItem('key') || 'default'; // ← Server doesn't have localStorage
```

#### ✅ **DO this instead:**
```typescript
// Guard date calculations with typeof window check
const getTodayDate = () => {
  if (typeof window === 'undefined') {
    return ''; // ← Same empty value on server
  }
  const today = new Date(); // ← Only runs on client
  return `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
};

// Use useEffect for client-only operations
useEffect(() => {
  if (isClient && !customDate) {
    setCustomDate(getTodayDate()); // ← Set after hydration
  }
}, [isClient, customDate]);

// Initialize with empty values, populate in useEffect
const [customDate, setCustomDate] = useState(''); // ← Server/client both start empty
```

### Testing for Hydration Issues

After making changes that involve:
- Date/time calculations
- localStorage access
- Conditional rendering based on `typeof window`
- Math.random() or other non-deterministic functions

**ALWAYS test thoroughly** as hydration errors can cause rendering issues.

### Quick Fix Checklist

1. **Replace `new Date()` calls** with `typeof window` guards
2. **Move client-specific logic** to `useEffect` hooks
3. **Initialize state with empty/neutral values** that match server rendering
4. **Test localhost after changes**

### Emergency Fix Pattern

If you encounter hydration errors:

```typescript
// Emergency pattern - always works
const [isClient, setIsClient] = useState(false);

useEffect(() => {
  setIsClient(true);
}, []);

// Only render dynamic content after client hydration
{isClient ? <DynamicComponent /> : <div>Loading...</div>}
```

---

## 🔍 BROWSER CONSOLE DEBUGGING

**Claude can read browser console output using Playwright/Puppeteer to debug React applications.**

### When to Use Browser Console Debugging

- **React state issues** that don't appear in server logs
- **Client-side JavaScript errors** and warnings
- **Database fetch errors** visible only in browser
- **localStorage/sessionStorage debugging**
- **Component lifecycle debugging** with console.log statements

### Quick Console Capture Method

```bash
# Use the permanent console debugging utility
node scripts/debug-console.cjs [poll-id-or-url]

# Or use npm scripts:
npm run debug:console [poll-id-or-url]
npm run debug:react [poll-id] [action]

# Examples:
node scripts/debug-console.cjs f1eb5036-fb77-4baa-9f23-a2774c576c5b
node scripts/debug-console.cjs /create-poll
node scripts/debug-console.cjs  # captures homepage

# React-specific debugging:
npm run debug:react poll-123 vote      # Debug voting process
npm run debug:react poll-123 revisit   # Debug vote retrieval
```

### Manual Browser Console Debugging

1. **Add console.log statements** to React components
2. **Run the console capture script** to visit the page
3. **Analyze captured output** for errors and state issues
4. **Clean up debug statements** after fixing the issue

### Debugging React Components

Add temporary debugging to React components:
```typescript
// In React component
useEffect(() => {
  console.log('Component state:', { someState, anotherState });
  console.log('Props received:', props);
}, [someState, anotherState, props]);

// For debugging API calls
const fetchData = async () => {
  console.log('Fetching data with params:', params);
  try {
    const result = await apiCall(params);
    console.log('API result:', result);
  } catch (error) {
    console.error('API error:', error);
  }
};
```

### Browser Console vs Server Logs

- **Server logs** (`sudo journalctl -u whoeverwants-dev -f`) - server-side errors, API routes
- **Browser console** - client-side React state, component lifecycle, database fetch errors
- **Use browser console for React debugging** - state management, component rendering, client-side API calls

### Important Notes

- **Playwright captures real browser console output** - works with actual React app
- **React Testing Library uses jsdom** - simulated DOM, no real browser console
- **Always clean up debug statements** after fixing issues
- **Use sparingly** - too many console.logs can impact performance

---

## Participation Poll Philosophy: Maximizing Inclusion

### Core Principle

**When multiple stable participant configurations exist, prioritize voters with fewer constraints to maximize future participation opportunities.**

### Why This Matters

Participation polls create interdependent constraints where each voter's willingness to participate depends on how many others participate. This can create scenarios where multiple valid "stable" configurations exist.

**Example scenario:**
- Poll requires 1-2 participants (set by creator)
- Voter A votes YES with conditions: exactly 1 participant (min=1, max=1)
- Voter B votes YES with conditions: 1+ participants (min=1, max=none)

Both configurations are mathematically valid:
- Configuration 1: Only Voter A participates (count=1, satisfies A's constraints)
- Configuration 2: Only Voter B participates (count=1, satisfies B's constraints)

### Selection Algorithm

We choose **Configuration 2** (Voter B) because:

1. **Flexibility**: Voter B's lack of max constraint means additional voters could join later
2. **Inclusivity**: Maximizes the chance that more people can participate
3. **Fairness**: Voters with restrictive constraints (like "exactly N") shouldn't block more flexible voters

### Priority Ranking

When selecting among competing voters, we rank by:

1. **No max constraint** → Highest priority (infinite flexibility)
2. **Higher max value** → Higher priority (more room for others)
3. **Lower min value** → Higher priority (easier to satisfy)
4. **Earlier timestamp** → Tiebreaker (first-come-first-served)

### Implementation Strategy

The algorithm uses a **greedy selection with priority ordering**:

1. Calculate all voters who said "yes" to participating
2. Sort voters by priority (most flexible first)
3. Greedily include voters in priority order:
   - Include voter if their constraints are satisfied by current count
   - Skip voter if including them would violate anyone's constraints
4. Return the final stable set of participating voters

### Benefits

- **Scalable**: Works for any number of voters with diverse constraints
- **Predictable**: Voters understand that flexibility increases their participation chances
- **Optimal**: Maximizes the potential for future participation growth
- **Fair**: Doesn't arbitrarily favor first voters; favors accommodating voters

### Edge Cases Handled

- **Oscillation**: When no fixed point exists, algorithm still converges
- **All-or-nothing voters**: Those with restrictive maxes get lower priority
- **Mixed constraints**: Algorithm finds optimal subset efficiently
- **Empty result**: If no stable configuration exists, event doesn't happen (count=0)

---

## Custom Claude Commands

### /publish
Complete deployment workflow - commit, merge to main, push, and apply database migrations:

```bash
npm run publish
```

This command will:
1. Commit any uncommitted changes (with option to customize message)
2. Push current branch to origin
3. Checkout and pull latest main
4. Merge current branch into main
5. Check for and optionally apply new database migrations to production
6. Push main to origin
7. Optionally delete the feature branch

**Usage:**
- Run from any feature branch (not main)
- Automatically handles git operations with Claude co-authorship
- Tracks which migrations have been applied to production
- Provides interactive prompts for important decisions

## Development Server Access

**The development server runs as a macOS background service and should ALWAYS be running.**

The service is configured via LaunchAgent at `~/Library/LaunchAgents/com.whoeverwants.dev.plist` and:
- Starts automatically on login
- Restarts automatically if it crashes
- Logs to `dev-server.log` and `dev-server-error.log` in the project root

### Access Points
- **Local URL**: http://localhost:3000
- **Tailscale network**: Use Tailscale to access from other devices on your network

### Service Management Commands

```bash
# Check if service is running
launchctl list | grep whoeverwants

# Stop the service
launchctl unload ~/Library/LaunchAgents/com.whoeverwants.dev.plist

# Start the service
launchctl load ~/Library/LaunchAgents/com.whoeverwants.dev.plist

# Restart the service
launchctl unload ~/Library/LaunchAgents/com.whoeverwants.dev.plist && launchctl load ~/Library/LaunchAgents/com.whoeverwants.dev.plist

# View logs
tail -f dev-server.log        # Server output
tail -f dev-server-error.log  # Error logs
```

### Important Notes
- The service **always ensures port 3000 is available** before starting
- If port 3000 is busy, follow the port conflict resolution steps below
- The service runs with your user permissions (not as root)

## 🔧 TROUBLESHOOTING: Development Server Issues

### Problem: Dev Server Not Rendering

If the development server appears to be running but the site doesn't load properly, check these issues:

#### **1. Port Conflicts**
Next.js automatically switches ports when 3000 is busy. Always ensure it's running on port 3000.

**Fix Process:**
1. Check which port Next.js actually started on:
   ```bash
   lsof -i :3000
   ```

2. If port 3000 is busy, kill the process and restart the service:
   ```bash
   kill -9 [PID]
   rm -rf .next
   launchctl unload ~/Library/LaunchAgents/com.whoeverwants.dev.plist && launchctl load ~/Library/LaunchAgents/com.whoeverwants.dev.plist
   ```

**Note:** The dev server runs as a background service. Use `launchctl` commands instead of manual `npm run dev`.

#### **2. React Hydration Errors**
Hydration errors cause the app to show permanent loading spinners.

**Common Cause:** Date/time calculations in render functions
```typescript
// ❌ BAD - causes hydration mismatch
const now = new Date(); // Different on server vs client
const openPolls = polls.filter(poll => 
  new Date(poll.response_deadline) > now
);
```

**Fix:** Move date logic to `useEffect`
```typescript
// ✅ GOOD - avoids hydration issues  
const [openPolls, setOpenPolls] = useState<Poll[]>([]);

useEffect(() => {
  if (typeof window === 'undefined') return;
  
  const now = new Date(); // Only runs on client
  const open = polls.filter(poll => 
    new Date(poll.response_deadline) > now
  );
  setOpenPolls(open);
}, [polls]);
```

#### **3. Missing JavaScript Build Assets**
404 errors for `main-app.js`, `webpack.js` files indicate build corruption.

**Fix:** Clear Next.js cache and restart
```bash
rm -rf .next/
npm run dev
```

#### **4. Complete Recovery Steps**
When dev server has multiple issues:

1. **Clear build cache:**
   ```bash
   rm -rf .next/
   ```

2. **Check for hydration errors in code:**
   - Search for `new Date()` in render functions
   - Move to `useEffect` hooks with `typeof window` guards

3. **Identify actual port:**
   ```bash
   lsof -i :3000
   ```

4. **Restart dev server service:**
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.whoeverwants.dev.plist && launchctl load ~/Library/LaunchAgents/com.whoeverwants.dev.plist
   ```

5. **Verify URL works:**
   ```bash
   curl -s -I http://localhost:3000 | head -3
   ```

#### **5. Debug Browser Console**
Use the included debug script to capture browser console logs:
```bash
node debug-console.cjs
```
This helps identify hydration errors and JavaScript loading issues.

**Success Indicators:**
- No hydration warnings in browser console
- "Loading spinner present: false"
- API calls successfully loading data
- Local URL returns HTTP 200

---

# Database Migration System

This project uses an **additive migration system** that preserves existing data while applying schema changes.

## Quick Commands

### 🟢 Recommended: Additive Migrations (Preserves Data)
```bash
# Apply only NEW migrations to TEST database (preserves existing data)
npm run db:migrate

# Apply only NEW migrations to PRODUCTION database (preserves existing data)
npm run db:migrate:production
```

### ⚠️ Destructive Operations (Use With Caution)

**WARNING**: The commands below will DELETE ALL DATA. Only use when absolutely necessary.

```bash
# DANGER: Tear down entire TEST database and rebuild with all migrations
# This DELETES all test data!
npm run db:rebuild-test

# DANGER: Tear down entire PRODUCTION database and rebuild with all migrations
# This PERMANENTLY DELETES all production data!
npm run db:rebuild-production

# Clear TEST database only (deletes all data)
npm run db:clear-test
```

## How It Works

The migration system uses **Supabase Management API** to execute SQL directly, bypassing PostgreSQL connection issues in containerized environments like GitHub Codespaces.

### Key Components

#### 1. **`scripts/apply-migrations.sh`** - Additive migration system (RECOMMENDED)
   - Tracks which migrations have been applied using a `_migrations` table
   - Only applies NEW migrations, preserving all existing data
   - Supports both test and production databases
   - Safe to run multiple times - skips already-applied migrations
   - Wraps each migration in a transaction for safety

#### 2. **`scripts/complete-migration.sh`** - Full TEST database tear-down/rebuild (DESTRUCTIVE)
   - ⚠️ **DELETES ALL DATA** in test database
   - Clears all tables, views, functions, policies from test database
   - Applies ALL migrations in `database/migrations/` in order
   - Use only when you need a completely fresh database

#### 3. **`scripts/complete-migration-production.sh`** - Full PRODUCTION database tear-down/rebuild (DESTRUCTIVE)
   - ⚠️ **DANGER**: Permanently deletes ALL production data
   - Requires manual confirmation: type `CONFIRM_PRODUCTION_REBUILD`
   - Should almost NEVER be used in production

#### 4. **`scripts/direct-api-migration.sh`** - Database clearing utility (DESTRUCTIVE)
   - Clears database schema without running migrations
   - TEST only - cannot be used on production

#### 5. **Migration Files Location**: `database/migrations/`
   - Format: `XXX_description_up.sql` (e.g., `001_create_polls_table_up.sql`)
   - Migrations are applied in alphabetical order
   - New fields should have sensible defaults or allow NULL for existing rows

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

#### Additive Migration Process (RECOMMENDED)

1. **Check Migration Tracking Table**
   - Creates `_migrations` table if it doesn't exist
   - Queries for previously applied migrations

2. **Identify New Migrations**
   - Scans `database/migrations/` for all `*_up.sql` files
   - Compares with applied migrations list
   - Identifies which migrations are new

3. **Apply New Migrations Only**
   - Each migration is wrapped in a transaction
   - Records successful migrations in tracking table
   - Stops on first failure to maintain consistency
   - Existing data is preserved

4. **Verification**
   - Reports number of migrations applied
   - Shows current migration status

#### Destructive Migration Process (USE WITH CAUTION)

1. **PHASE 1: Clear Database** (⚠️ DELETES ALL DATA)
   - Drops all tables, views, functions, policies in public schema
   - Completely wipes the database

2. **PHASE 2: Apply All Migrations**
   - Applies every migration from scratch
   - Creates a fresh database schema
   - No data is preserved from before

## Writing New Migrations

When creating new migrations:

1. **Use additive changes**: Add columns with DEFAULT values or NULL
2. **Avoid destructive changes**: Don't DROP columns or tables with data
3. **Handle existing data**: Provide migration logic for existing rows
4. **Test thoroughly**: Run migrations on test database first

Example of a good migration:
```sql
-- Add new column with default value for existing rows
ALTER TABLE polls ADD COLUMN IF NOT EXISTS 
  view_count INTEGER DEFAULT 0;

-- Update existing rows if needed
UPDATE polls SET view_count = 0 WHERE view_count IS NULL;
```

## Current Migrations

The project has multiple migrations that build the schema incrementally:
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
- never ask me to look at the console for logs to debug. instead send logs to the server's log endpoint and then tell me to run my test manually and then analyze the resulting logs
- never ask me to check the browser console

## 🚨 CRITICAL: Database Constraint Debugging

### When "Failed to submit vote" Errors Occur

**ALWAYS add comprehensive logging FIRST before attempting fixes:**

1. **Add server-side logging immediately** to capture exact database errors
2. **Check `/debug-logs/` directory** for detailed error messages
3. **Look for constraint violations** - they often "stack" (fixing one reveals another)

### Common Constraint Issues (in order of likelihood):
1. `votes_vote_type_check` - Missing 'nomination' in allowed types (migration 048)
2. `vote_yes_no_valid` - Outdated constraint blocking nominations (migration 047)
3. `vote_structure_valid` - Structure validation for vote types (migration 043/044)

### Key Lesson from Nomination Voting Debug:
**PostgreSQL only reports the FIRST failing constraint.** After fixing one constraint, ALWAYS test again immediately - another constraint may be blocking. The nomination voting fix required fixing TWO separate constraints that were hiding behind each other.

### Quick Debug Commands:
```bash
# Check latest logs
cat debug-logs/nomination-vote-$(date +%Y-%m-%d).log | tail -50

# Apply specific migration
./scripts/apply-single-migration.sh database/migrations/048_fix_vote_type_check_constraint_up.sql

# Clear cache and restart
rm -rf .next && npm run dev
```

**Time-saving tip**: Don't guess at the problem. Add logging, get the exact error, then fix the specific constraint.