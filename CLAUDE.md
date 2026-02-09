# WhoeverWants Development Environment

## Project Overview

**WhoeverWants** is an anonymous polling application for group decision-making. Users create and vote on polls without accounts or sign-ups, sharing via link.

- **Live site**: https://whoeverwants.com
- **Repository**: https://github.com/samcarey/whoeverwants
- **License**: Dual MIT / Apache 2.0

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15.3.3 (App Router, `force-dynamic` routes) |
| UI | React 18.3.1, Tailwind CSS 4, Geist font |
| Language | TypeScript 5 (strict mode, `@/*` path alias) |
| Database | Supabase (PostgreSQL with RLS, PostgREST API) |
| Unit tests | Vitest 3.2.4, Testing Library, jsdom |
| E2E tests | Playwright 1.55.0 (Chromium, Firefox, WebKit) |
| CI | GitHub Actions (Node 18/20 matrix, lint, coverage) |
| PWA | Service workers, manifest.json, Apple web app support |

## Codebase Structure

```
whoeverwants/
├── app/                            # Next.js App Router
│   ├── layout.tsx                  # Root layout (fonts, viewport, service worker)
│   ├── template.tsx                # Page template wrapper
│   ├── page.tsx                    # Home page (poll list, typing animation)
│   ├── globals.css                 # Tailwind global styles
│   ├── create-poll/page.tsx        # Poll creation form
│   ├── p/[shortId]/                # Dynamic poll page (UUID-based routing)
│   │   ├── page.tsx                # Poll loader with access control
│   │   └── PollPageClient.tsx      # Full poll view (voting, results, management)
│   ├── poll/page.tsx               # Alternate poll endpoint
│   ├── profile/page.tsx            # User profile (name management)
│   └── api/                        # Server-side API routes
│       ├── log/route.ts            # Server-side logging endpoint
│       ├── debug-logs/route.ts     # Debug log retrieval
│       ├── last-compile/route.ts   # Build timestamp
│       ├── polls/discover-related/ # Follow-up/fork poll discovery
│       ├── fix-vote-policy/        # Vote policy fixes
│       ├── admin/fix-rls/          # RLS admin fixes
│       ├── test-pushover/          # Push notification testing
│       └── notify-claude-input/    # Claude notification integration
│
├── components/                     # 34 React components
│   ├── PollList.tsx                # Home page poll list with sections
│   ├── PollResults.tsx             # Results display (all 4 poll types)
│   ├── PollActionsCard.tsx         # Poll action buttons
│   ├── PollManagementButtons.tsx   # Creator controls (close/reopen/duplicate)
│   ├── YesNoAbstainButtons.tsx     # Yes/No/Abstain voting buttons
│   ├── RankableOptions.tsx         # Drag-to-rank interface
│   ├── NominationVotingInterface.tsx # Nomination poll voting
│   ├── NominationsList.tsx         # Display nominations with vote counts
│   ├── CompactRankedChoiceResults.tsx # Ranked choice round display
│   ├── MinMaxCounter.tsx           # Participation min/max selectors
│   ├── ParticipationConditions.tsx # Voter condition UI
│   ├── OptionsInput.tsx            # Poll options/nominations input
│   ├── Countdown.tsx               # Deadline countdown timer
│   ├── ConfirmationModal.tsx       # Confirm destructive actions
│   ├── FollowUpModal.tsx           # Create follow-up poll modal
│   ├── FollowUpHeader.tsx          # Header showing parent poll link
│   ├── ForkHeader.tsx              # Header showing forked-from link
│   ├── FollowUpButton.tsx          # Create follow-up button
│   ├── ForkButton.tsx              # Fork poll button
│   ├── DuplicateButton.tsx         # Duplicate poll button
│   ├── VoterList.tsx               # List of voters on a poll
│   ├── FloatingCopyLinkButton.tsx  # Copy poll URL button
│   ├── UrlCopy.tsx                 # URL copy utility
│   ├── ProfileButton.tsx           # Profile access button
│   ├── GradientBorderButton.tsx    # Styled gradient button
│   ├── SuccessPopup.tsx            # Success notification popup
│   ├── OptimizedLoader.tsx         # Loading spinner
│   ├── ClientOnly.tsx              # Client-only render wrapper
│   ├── ModalPortal.tsx             # Modal portal container
│   ├── HeaderPortal.tsx            # Header portal container
│   ├── PageLayout.tsx              # Page layout wrapper
│   ├── ResponsiveScaling.tsx       # Mobile viewport scaling
│   ├── BuildTimer.tsx              # Build timestamp display
│   └── CounterInput.tsx            # Numeric counter input
│
├── lib/                            # 16 utility modules
│   ├── supabase.ts                 # Supabase client, Poll/Vote/PollResults types,
│   │                               # core queries (getPollResults, submitVote, etc.)
│   ├── simplePollQueries.ts        # getAccessiblePolls, getPollWithAccess
│   ├── pollCreator.ts              # Poll creation & creator secret management
│   ├── browserPollAccess.ts        # localStorage-based poll access tracking
│   ├── pollAccess.ts               # Database-backed poll access tracking
│   ├── pollDiscovery.ts            # Discover follow-up/fork relationships
│   ├── userProfile.ts              # User name get/save (localStorage)
│   ├── forgetPoll.ts               # Remove poll from browser's access list
│   ├── debugLogger.ts              # Server/client logging utility
│   ├── base62.ts                   # Base62 encoding for short IDs
│   ├── prefetch.ts                 # Next.js page prefetching
│   ├── mobile-optimization.ts      # iOS viewport handling
│   ├── instant-loading.ts          # Page load optimization
│   ├── last-compile-time.ts        # Build timestamp tracking
│   ├── usePageTitle.ts             # Dynamic page title hook
│   └── pushoverNotifications.ts    # Push notification integration
│
├── database/migrations/            # 93 SQL migration files (001-063, up + down)
│   ├── 001-015: Core schema (polls, votes, results, ranked choice, RLS)
│   ├── 016-041: Short IDs, poll access, nomination fields, RLS policies
│   ├── 042-050: Nomination poll type, vote constraints, editing
│   ├── 051-056: Participation poll type, auto-close triggers
│   └── 057-063: Voter conditions, participation priority algorithm
│
├── tests/
│   ├── __tests__/                  # Vitest unit/integration tests
│   │   ├── ranked-choice/          # IRV algorithm tests
│   │   ├── ballot-logic/           # Ballot validation tests
│   │   ├── voting-algorithms/      # Algorithm correctness tests
│   │   ├── integration/            # API integration tests
│   │   ├── components/             # Component tests
│   │   └── edge-cases/             # Edge case tests
│   ├── e2e/                        # Playwright E2E tests
│   │   ├── specs/                  # 9+ test specs
│   │   ├── pages/                  # Page objects (BasePage, HomePage, etc.)
│   │   ├── fixtures/               # Test data
│   │   └── config/                 # Playwright config
│   ├── helpers/                    # Test utilities
│   └── setup.js                    # Vitest setup (dotenv, mocks)
│
├── scripts/                        # 50+ utility scripts
│   ├── apply-migrations.sh         # Additive migration runner (RECOMMENDED)
│   ├── complete-migration.sh       # Full test DB rebuild (DESTRUCTIVE)
│   ├── complete-migration-production.sh  # Full prod DB rebuild (DESTRUCTIVE)
│   ├── direct-api-migration.sh     # DB clearing utility
│   ├── publish.sh                  # Full deployment workflow
│   ├── debug-console.cjs           # Playwright browser console capture
│   └── debug-react-state.cjs       # React state debugging
│
├── public/                         # Static assets
│   ├── manifest.json               # PWA manifest
│   ├── sw.js, sw-mobile.js         # Service workers
│   └── icon-*.svg                  # App icons (192-512px)
│
├── .github/workflows/              # CI pipelines
│   ├── test.yml                    # Tests on push/PR (Node 18/20, lint, coverage)
│   └── pr-checks.yml               # PR quality gates
│
└── Configuration
    ├── next.config.ts               # Webpack, caching headers, trailing slash
    ├── tsconfig.json                # ES2017, strict, @/* paths
    ├── vitest.config.js             # jsdom, single-fork, 30s timeout
    ├── postcss.config.mjs           # Tailwind CSS
    └── .eslintrc.json               # next/core-web-vitals
```

## Key Concepts

### Poll Types

| Type | Description | Vote Data |
|------|-------------|-----------|
| `yes_no` | Simple binary vote | `{ vote: "yes" \| "no" }` |
| `ranked_choice` | Instant Runoff Voting (IRV) with Borda tiebreak | `{ rankings: string[] }` |
| `nomination` | Nominate options, then vote on them | `{ nominations: string[] }` |
| `participation` | RSVP with min/max constraints & voter conditions | `{ participating: boolean, conditions: {...} }` |

### Access Control Model

- **No user accounts** - fully anonymous
- **Browser-based access** via localStorage (`browserPollAccess.ts`)
- Poll URLs grant access: visiting `/p/[id]` registers access
- Creator authentication via `creator_secret` (stored in localStorage)
- Database-level RLS (Row Level Security) policies on all tables

### Data Flow

1. **Poll creation**: `create-poll/page.tsx` -> `pollCreator.ts` -> Supabase `polls` table
2. **Voting**: `PollPageClient.tsx` -> `supabase.ts:submitVote()` -> Supabase `votes` table
3. **Results**: `PollResults.tsx` -> `supabase.ts:getPollResults()` -> `poll_results` view
4. **Access tracking**: `simplePollQueries.ts:getPollWithAccess()` -> localStorage + `poll_access` table

### Environment Selection

`lib/supabase.ts` selects database by `NODE_ENV`:
- `production` -> `NEXT_PUBLIC_SUPABASE_URL_PRODUCTION` / `NEXT_PUBLIC_SUPABASE_ANON_KEY_PRODUCTION`
- Everything else -> `NEXT_PUBLIC_SUPABASE_URL_TEST` / `NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST`

## Commands Quick Reference

```bash
# Development
npm run dev                    # Start dev server (port 3000, force-webpack)
npm run build                  # Production build
npm run lint                   # ESLint

# Testing
npm run test:run               # Run all unit tests once
npm run test                   # Watch mode
npm run test:coverage          # Coverage report
npm run test:algorithms        # Ranking algorithm tests only
npm run test:e2e               # Playwright E2E tests

# Database
npm run db:migrate             # Apply new migrations (test)
npm run db:migrate:production  # Apply new migrations (production)
npm run db:rebuild-test        # DESTRUCTIVE: full test DB rebuild
npm run db:rebuild-production  # DESTRUCTIVE: full prod DB rebuild

# Debugging
npm run debug:console [url]    # Capture browser console via Playwright
npm run debug:react [id] [act] # Debug React component state

# Deployment
npm run publish                # Full workflow: commit, merge, push, migrate
```

---

## CRITICAL RULES FOR AI ASSISTANTS

The sections below contain mandatory rules. Follow them exactly.

- Never ask the user to look at the browser console. Instead, send logs to the server's `/api/log` endpoint and have them run the test manually, then analyze the resulting logs.
- Never ask the user to check the browser console.

## URL Testing Protocol

**NEVER mention a URL as working without testing it first.**

Before claiming any URL is accessible, ALWAYS run:
```bash
curl -s -I http://localhost:3000 | head -3
```

**Only mention URLs after confirming 200 OK responses.**

## Dev Server Port Management

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

## Hydration Error Prevention

**React hydration errors occur when server-rendered HTML doesn't match client-rendered HTML.**

### Common Causes & Solutions

#### NEVER do this:
```typescript
// Date/time calculations that differ between server/client
const getTodayDate = () => {
  const today = new Date(); // Different on server vs client!
  return `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
};

// Conditional rendering based on client-side checks
min={isClient ? getTodayDate() : undefined} // Hydration mismatch!

// Direct access to window/localStorage in render
const value = localStorage.getItem('key') || 'default'; // Server doesn't have localStorage
```

#### DO this instead:
```typescript
// Guard date calculations with typeof window check
const getTodayDate = () => {
  if (typeof window === 'undefined') {
    return ''; // Same empty value on server
  }
  const today = new Date(); // Only runs on client
  return `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
};

// Use useEffect for client-only operations
useEffect(() => {
  if (isClient && !customDate) {
    setCustomDate(getTodayDate()); // Set after hydration
  }
}, [isClient, customDate]);

// Initialize with empty values, populate in useEffect
const [customDate, setCustomDate] = useState(''); // Server/client both start empty
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

## Browser Console Debugging

**Claude can read browser console output using Playwright to debug React applications.**

### When to Use

- **React state issues** that don't appear in server logs
- **Client-side JavaScript errors** and warnings
- **Database fetch errors** visible only in browser
- **localStorage/sessionStorage debugging**

### Quick Console Capture

```bash
# Permanent console debugging utility
node scripts/debug-console.cjs [poll-id-or-url]

# npm scripts:
npm run debug:console [poll-id-or-url]
npm run debug:react [poll-id] [action]

# Examples:
node scripts/debug-console.cjs f1eb5036-fb77-4baa-9f23-a2774c576c5b
node scripts/debug-console.cjs /create-poll
npm run debug:react poll-123 vote      # Debug voting process
npm run debug:react poll-123 revisit   # Debug vote retrieval
```

### Browser Console vs Server Logs

- **Server logs** (`sudo journalctl -u whoeverwants-dev -f`) - server-side errors, API routes
- **Browser console** (via Playwright capture) - client-side React state, component lifecycle, database fetch errors

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

1. **No max constraint** -> Highest priority (infinite flexibility)
2. **Higher max value** -> Higher priority (more room for others)
3. **Lower min value** -> Higher priority (easier to satisfy)
4. **Earlier timestamp** -> Tiebreaker (first-come-first-served)

### Implementation Strategy

The algorithm uses a **greedy selection with priority ordering**:

1. Calculate all voters who said "yes" to participating
2. Sort voters by priority (most flexible first)
3. Greedily include voters in priority order:
   - Include voter if their constraints are satisfied by current count
   - Skip voter if including them would violate anyone's constraints
4. Return the final stable set of participating voters

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
- If port 3000 is busy, follow the port conflict resolution steps above
- The service runs with your user permissions (not as root)

## Troubleshooting: Development Server Issues

### Problem: Dev Server Not Rendering

#### 1. Port Conflicts
Next.js automatically switches ports when 3000 is busy. Always ensure it's running on port 3000.

```bash
# Check which port Next.js actually started on
lsof -i :3000

# If port 3000 is busy, kill the process and restart the service
kill -9 [PID]
rm -rf .next
launchctl unload ~/Library/LaunchAgents/com.whoeverwants.dev.plist && launchctl load ~/Library/LaunchAgents/com.whoeverwants.dev.plist
```

#### 2. React Hydration Errors
Hydration errors cause the app to show permanent loading spinners.

**Common Cause:** Date/time calculations in render functions
```typescript
// BAD - causes hydration mismatch
const now = new Date();
const openPolls = polls.filter(poll =>
  new Date(poll.response_deadline) > now
);
```

**Fix:** Move date logic to `useEffect`
```typescript
// GOOD - avoids hydration issues
const [openPolls, setOpenPolls] = useState<Poll[]>([]);

useEffect(() => {
  if (typeof window === 'undefined') return;
  const now = new Date();
  const open = polls.filter(poll =>
    new Date(poll.response_deadline) > now
  );
  setOpenPolls(open);
}, [polls]);
```

#### 3. Missing JavaScript Build Assets
404 errors for `main-app.js`, `webpack.js` files indicate build corruption.

```bash
rm -rf .next/
npm run dev
```

#### 4. Complete Recovery Steps

1. Clear build cache: `rm -rf .next/`
2. Check for hydration errors in code (search for `new Date()` in render functions)
3. Identify actual port: `lsof -i :3000`
4. Restart dev server service: `launchctl unload ~/Library/LaunchAgents/com.whoeverwants.dev.plist && launchctl load ~/Library/LaunchAgents/com.whoeverwants.dev.plist`
5. Verify URL works: `curl -s -I http://localhost:3000 | head -3`

#### 5. Debug Browser Console
```bash
node scripts/debug-console.cjs
```

**Success Indicators:**
- No hydration warnings in browser console
- "Loading spinner present: false"
- API calls successfully loading data
- Local URL returns HTTP 200

---

## Database Migration System

This project uses an **additive migration system** that preserves existing data while applying schema changes. There are currently **63 numbered migrations** (001-063) with both up and down files.

### Quick Commands

#### Recommended: Additive Migrations (Preserves Data)
```bash
npm run db:migrate             # Apply NEW migrations to TEST database
npm run db:migrate:production  # Apply NEW migrations to PRODUCTION database
```

#### Destructive Operations (Use With Caution)

**WARNING**: The commands below will DELETE ALL DATA.

```bash
npm run db:rebuild-test           # Full test DB rebuild
npm run db:rebuild-production     # Full prod DB rebuild (requires confirmation)
npm run db:clear-test             # Clear test schema only
```

### How It Works

The migration system uses **Supabase Management API** to execute SQL directly, bypassing PostgreSQL connection issues in containerized environments like GitHub Codespaces.

#### Key Scripts

| Script | Purpose |
|--------|---------|
| `scripts/apply-migrations.sh` | Additive migration runner (RECOMMENDED) |
| `scripts/complete-migration.sh` | Full test DB tear-down/rebuild (DESTRUCTIVE) |
| `scripts/complete-migration-production.sh` | Full prod DB tear-down/rebuild (DESTRUCTIVE) |
| `scripts/direct-api-migration.sh` | DB clearing utility (TEST only) |

#### Migration File Format
- Location: `database/migrations/`
- Naming: `XXX_description_up.sql` / `XXX_description_down.sql`
- Applied in alphabetical order
- Tracked in `_migrations` table (additive mode only)

### Authentication & Configuration

**Environment variables from `.env`:**

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL_TEST` | Test database URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST` | Test anon key |
| `SUPABASE_TEST_SERVICE_KEY` | Test service role key |
| `NEXT_PUBLIC_SUPABASE_URL_PRODUCTION` | Production database URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY_PRODUCTION` | Production anon key |
| `SUPABASE_ACCESS_TOKEN_PRODUCTION` | Production service role key |
| `SUPABASE_ACCESS_TOKEN` | Management API access token (shared) |

### Writing New Migrations

1. **Use additive changes**: Add columns with DEFAULT values or allow NULL
2. **Avoid destructive changes**: Don't DROP columns or tables with data
3. **Handle existing data**: Provide migration logic for existing rows
4. **Test thoroughly**: Run migrations on test database first

```sql
-- Example: good migration
ALTER TABLE polls ADD COLUMN IF NOT EXISTS
  view_count INTEGER DEFAULT 0;

UPDATE polls SET view_count = 0 WHERE view_count IS NULL;
```

### Migration History (Key Milestones)

| Range | Description |
|-------|-------------|
| 001-015 | Core schema: polls, votes, results view, ranked choice, RLS, creator auth |
| 016-025 | Short IDs (base62), poll access tracking, nomination vote fields |
| 026-041 | Vote editing, abstain support, voter names, follow-up/fork relationships |
| 042-050 | Nomination poll type, vote type constraints, nomination editing |
| 051-056 | Participation poll type, min/max participants, auto-close triggers |
| 057-063 | Voter conditions, conditional participation counting, priority algorithm |

### Database Status

| Database | Ref ID | Status |
|----------|--------|--------|
| Test | kfngceqepnzlljkwedtd | All 63 migrations applied |
| Production | kifnvombihyfwszuwqvy | All 63 migrations applied |

### Safety Guidelines

- **Test DB**: Safe to rebuild anytime (`npm run db:rebuild-test`)
- **Production DB**: EXTREME CAUTION. Must type `CONFIRM_PRODUCTION_REBUILD`. ALL DATA PERMANENTLY LOST.

---

## Database Constraint Debugging

### When "Failed to submit vote" Errors Occur

**ALWAYS add comprehensive logging FIRST before attempting fixes:**

1. **Add server-side logging immediately** to capture exact database errors
2. **Check `/debug-logs/` directory** for detailed error messages
3. **Look for constraint violations** - they often "stack" (fixing one reveals another)

### Common Constraint Issues (in order of likelihood):
1. `votes_vote_type_check` - Missing vote type in allowed types
2. `vote_yes_no_valid` - Outdated constraint blocking new vote types
3. `vote_structure_valid` - Structure validation for vote types

### Key Lesson:
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
