# WhoeverWants Development Environment

## Project Overview

**WhoeverWants** is an anonymous polling application for group decision-making. Users create and vote on polls without accounts or sign-ups, sharing via link.

- **Live site**: https://whoeverwants.com
- **Repository**: https://github.com/samcarey/whoeverwants
- **License**: Dual MIT / Apache 2.0

## Active Plan

The Supabase-to-Python migration and infrastructure improvements (Phases 1-10) are complete. The current architecture is: Vercel (frontend) + DigitalOcean droplet (FastAPI API + PostgreSQL).

## DigitalOcean Droplet (Production Server)

The production server is a DigitalOcean droplet that Claude manages remotely. **You have full control of this server.**

### Server Specs
| Property | Value |
|----------|-------|
| Hostname | `whoeverwants` |
| IP | `142.93.60.29` |
| OS | Ubuntu 24.04 LTS |
| RAM | 1 GB |
| Disk | 24 GB |
| User | `root` |
| Purpose | Hosts the Python API server and PostgreSQL (API-only; frontend on Vercel) |

### Remote Command Execution

Run commands on the droplet from this environment using `scripts/remote.sh`:

```bash
# Basic usage
bash scripts/remote.sh "command" [working_dir] [timeout_seconds]

# Examples
bash scripts/remote.sh "hostname && uptime"
bash scripts/remote.sh "git pull" /root/whoeverwants
bash scripts/remote.sh "docker compose up -d" /root/whoeverwants 180
bash scripts/remote.sh "docker compose logs --tail 50" /root/whoeverwants
bash scripts/remote.sh "systemctl status nginx"
bash scripts/remote.sh "psql -U postgres -c 'SELECT 1'"
```

The script reads `DROPLET_API_URL` and `DROPLET_API_TOKEN` from environment variables (preferred) or falls back to `.env`.

### Required Environment Variables

The following environment variables must be available. In the Claude Code web environment, these are pre-set as environment variables (not in a `.env` file).

```
DROPLET_API_URL=https://142-93-60-29.sslip.io
DROPLET_API_TOKEN=<bearer token>
VERCEL_API_TOKEN=<vercel api token>
GITHUB_API_TOKEN=<github fine-grained PAT>
```

- `DROPLET_API_URL` / `DROPLET_API_TOKEN` — Authenticate requests to the droplet's command execution API (via sslip.io for TLS). Used by `scripts/remote.sh`.
- `VERCEL_API_TOKEN` — Authenticate requests to the [Vercel REST API](https://vercel.com/docs/rest-api) for managing frontend deployments.
- `GITHUB_API_TOKEN` — GitHub fine-grained Personal Access Token scoped to `samcarey/whoeverwants`. Permissions: Pull Requests (R/W), Issues (Read), Contents (R/W), Commit Statuses (Read), Actions (Read). Used for creating PRs, reading issues, and checking CI status via the GitHub REST API.

> **SECURITY**: These tokens must NEVER be committed to git — not in CLAUDE.md, `.env`, or any tracked file. Store them only in environment variables. The droplet token was previously leaked via a git commit (fa805e7), leading to a Kinsing cryptominer compromise that required a full droplet rebuild (old IP 157.245.129.162 → current 142.93.60.29).

### Security Hardening

The droplet is hardened with:
- **UFW firewall**: Only ports 22 (SSH), 80 (HTTP), 443 (HTTPS) are open
- **SSH**: Password auth disabled, key-only login (`PermitRootLogin prohibit-password`)
- **cmd-api**: Request logging (timestamp, IP, command) and rate limiting (60 req/min per IP)
- **FastAPI**: Rate limiting (120 GET/min, 30 POST/min per IP)
- **Automated backups**: Daily pg_dump at 3 AM, 14-day retention
- **Health checks**: Every 5 minutes with auto-recovery

### Development Workflow

**Frontend** (Next.js — auto-deployed per-user dev servers):
1. **Write code** in this environment (Claude Code sandbox)
2. **Commit and push** to GitHub
3. GitHub webhook auto-updates your dev server on the droplet (hot reload — no rebuild)
4. Your dev site URL (based on `GIT_AUTHOR_EMAIL`) stays the same across all branches

**Production Frontend** (Vercel):
- Vercel auto-deploys on push to `main` → `whoeverwants.com`

**Backend** (Python API on droplet — auto-deployed on push to main):
- Merging/pushing to `main` auto-triggers: git pull → Docker rebuild → migration check → health verify
- Deploy logs: `bash scripts/remote.sh "tail -50 /var/log/dev-webhook.log" /root`
- Manual rebuild: `bash scripts/remote.sh "docker compose up -d --build" /root/whoeverwants`
- API logs: `bash scripts/remote.sh "docker compose logs --tail 100" /root/whoeverwants`

You do NOT need SSH — all server management goes through `scripts/remote.sh`.

**Per-User Dev Servers** (automatic on push):
- Every push to GitHub auto-updates your dev server via webhook
- Uses `next dev` (hot reload) — file changes apply in seconds, no full rebuild
- Only restarts if `package-lock.json` changes (new dependencies)
- URL is based on your `GIT_AUTHOR_EMAIL`: `<email-slug>.dev.whoeverwants.com`
  - Example: `sam@example.com` → `https://sam-at-example-com.dev.whoeverwants.com`
- URL stays the same regardless of branch — bookmark it
- Claude/bot emails (`*@anthropic.com`) are ignored
- Dev servers use the production API — they test frontend changes only
- Auto-cleaned after 7 days of inactivity

```bash
# List active dev servers
bash scripts/remote.sh "bash /root/whoeverwants/scripts/dev-server-manager.sh list"

# Manually trigger a dev server update
bash scripts/remote.sh "bash /root/whoeverwants/scripts/dev-server-manager.sh upsert user@example.com claude/my-branch" /root 600

# Destroy a dev server
bash scripts/remote.sh "bash /root/whoeverwants/scripts/dev-server-manager.sh destroy user-at-example-com"
```

**Preview Environments** (per-branch API testing):
1. **Push branch** to GitHub
2. **Create preview API**: `bash scripts/deploy-preview.sh` (or manually via `scripts/remote.sh`)
3. Preview APIs are auto-cleaned after 7 days

```bash
# Quick deploy preview for current branch
bash scripts/deploy-preview.sh

# Or manually manage previews on the droplet
bash scripts/remote.sh "bash /root/whoeverwants/scripts/preview-manager.sh list"
bash scripts/remote.sh "bash /root/whoeverwants/scripts/preview-manager.sh destroy <slug>"
```

### Creating Pull Requests

The `gh` CLI is **not available** in this environment. Use the GitHub REST API with `curl` and `$GITHUB_API_TOKEN` instead:

```bash
curl -s -X POST \
  -H "Authorization: token $GITHUB_API_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/samcarey/whoeverwants/pulls \
  -d '{
    "title": "PR title here",
    "head": "branch-name",
    "base": "main",
    "body": "## Summary\n- Change 1\n- Change 2\n\n## Test plan\n- [ ] Test item"
  }'
```

The response JSON contains `html_url` with the PR link. Extract it with:

```bash
| python3 -c "import sys,json; print(json.load(sys.stdin)['html_url'])"
```

### Droplet Setup & Provisioning

Full setup documentation is in **[docs/droplet-setup.md](./docs/droplet-setup.md)**. To provision a new droplet from scratch:

```bash
ssh root@<DROPLET_IP> 'bash -s' < scripts/provision-droplet.sh <API_TOKEN>
```

This installs Docker, Caddy, the command execution API, clones the repo, starts all services, and applies database migrations.

### Important Notes
- The droplet has its own clone of this repo at `/root/whoeverwants`
- Never transfer files manually — commit here, pull there
- The remote execution API has a configurable timeout (default 120s, max via 3rd arg)
- The API returns stdout, stderr, and exit code for every command

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15.3.3 (App Router, `force-dynamic` routes) |
| UI | React 18.3.1, Tailwind CSS 4, Geist font |
| Language | TypeScript 5 (strict mode, `@/*` path alias) |
| Backend | Python (FastAPI), managed by **uv** |
| Database | PostgreSQL 16 (local, via Docker) |
| Python tooling | **uv** — package management, virtual environments, Python version management |
| Unit tests | Vitest 3.2.4, Testing Library, jsdom |
| Python tests | pytest (managed via uv) |
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
│       ├── log/route.ts            # Server-side logging endpoint (dev only)
│       ├── debug-logs/route.ts     # Debug log retrieval
│       ├── last-compile/route.ts   # Build timestamp
│       ├── test-pushover/          # Push notification testing
│       └── notify-claude-input/    # Claude notification integration
│
├── components/                     # 29 React components
│   ├── PollList.tsx                # Home page poll list with sections
│   ├── PollResults.tsx             # Results display (all 4 poll types)
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
│   ├── ProfileButton.tsx           # Profile access button
│   ├── GradientBorderButton.tsx    # Styled gradient button
│   ├── ClientOnly.tsx              # Client-only render wrapper
│   ├── ModalPortal.tsx             # Modal portal container
│   ├── HeaderPortal.tsx            # Header portal container
│   ├── ResponsiveScaling.tsx       # Mobile viewport scaling
│   ├── BuildTimer.tsx              # Build timestamp display
│   └── CounterInput.tsx            # Numeric counter input
│
├── lib/                            # 17 utility modules
│   ├── api.ts                      # Python API client (fetch-based)
│   ├── types.ts                    # Poll, Vote, PollResults type definitions
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
├── database/migrations/            # SQL migration files (001-064, up + down)
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
├── scripts/                        # Utility scripts
│   ├── remote.sh                   # Execute commands on droplet
│   ├── publish.sh                  # Full deployment workflow
│   ├── provision-droplet.sh        # Droplet setup from scratch
│   ├── deploy-preview.sh           # Deploy preview API environment
│   ├── preview-manager.sh          # Manage preview API instances
│   ├── dev-server-manager.sh       # Per-user dev server lifecycle
│   ├── health-check.sh             # Production health monitoring
│   ├── backup-db.sh                # Database backup (runs on droplet)
│   ├── debug-console.cjs           # Playwright browser console capture
│   ├── debug-react-state.cjs       # React state debugging
│   └── watch-and-update-timestamp.cjs # Build timestamp watcher
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

# Debugging
npm run debug:console [url]    # Capture browser console via Playwright
npm run debug:react [id] [act] # Debug React component state

# Deployment
npm run publish                # Full workflow: commit, merge, push, migrate

# Python Server (run from server/ directory)
uv run pytest                  # Run Python tests
uv run uvicorn main:app        # Run API server locally
uv add <package>               # Add a dependency (always use latest version)
uv add --dev <package>         # Add a dev dependency
uv sync                        # Install all deps from lock file
uv lock                        # Regenerate lock file
```

---

## CRITICAL RULES FOR AI ASSISTANTS

The sections below contain mandatory rules. Follow them exactly.

- Never ask the user to look at the browser console. Instead, send logs to the server's `/api/log` endpoint and have them run the test manually, then analyze the resulting logs.
- Never ask the user to check the browser console.
- **Keep droplet setup docs current**: When you change anything about the droplet infrastructure (Caddy config, Docker Compose, systemd services, provisioning steps, new services, port changes, etc.), update **both** `docs/droplet-setup.md` and `scripts/provision-droplet.sh` to reflect the change. These files must always describe how to reproduce the current droplet from scratch.

### Python Tooling: uv (Mandatory)

**All Python package management and environment management MUST use [uv](https://docs.astral.sh/uv/).** Never use `pip`, `pip-compile`, `poetry`, `conda`, `pipenv`, or `venv` directly.

- **Package management**: Use `pyproject.toml` (not `requirements.txt`). Manage deps with `uv add`, `uv remove`.
- **Running commands**: Use `uv run` to execute Python scripts and tools (e.g., `uv run pytest`, `uv run uvicorn`).
- **Lock file**: `uv.lock` is the lock file. Commit it to version control.
- **Docker**: The Dockerfile installs uv and uses it to sync dependencies. Never use `pip install` in Dockerfiles.
- **Version policy**: Before adding any new Python dependency, **always look up the latest version** (via web search or PyPI) and use that version. Do not guess or use outdated versions from memory.
- **Local development**: Use `uv run` for all local Python commands. uv manages the virtual environment automatically.

```bash
# Examples
uv add fastapi                  # Add a dependency (latest version)
uv add --dev pytest             # Add a dev dependency
uv remove somepackage           # Remove a dependency
uv run pytest                   # Run tests
uv run uvicorn main:app         # Run the server locally
uv sync                         # Install all deps from lock file
```

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

## Database Migrations

SQL migration files live in `database/migrations/` (001-064, up + down). All 64 migrations are applied on the production droplet. New migrations are applied manually via `psql` on the droplet:

```bash
# Apply a new migration on the droplet
bash scripts/remote.sh "docker exec -i whoeverwants-db-1 psql -U whoeverwants whoeverwants < /root/whoeverwants/database/migrations/065_description_up.sql" /root/whoeverwants

# Verify migration applied
bash scripts/remote.sh "docker exec whoeverwants-db-1 psql -U whoeverwants -c 'SELECT * FROM _migrations ORDER BY id DESC LIMIT 5;'"
```

### Writing New Migrations

1. **Use additive changes**: Add columns with DEFAULT values or allow NULL
2. **Avoid destructive changes**: Don't DROP columns or tables with data
3. **Handle existing data**: Provide migration logic for existing rows

---

## Database Constraint Debugging

### When "Failed to submit vote" Errors Occur

**ALWAYS add comprehensive logging FIRST before attempting fixes:**

1. **Add server-side logging immediately** to capture exact database errors
2. **Check API logs**: `bash scripts/remote.sh "docker compose logs --tail 100" /root/whoeverwants`
3. **Look for constraint violations** - they often "stack" (fixing one reveals another)

### Common Constraint Issues (in order of likelihood):
1. `votes_vote_type_check` - Missing vote type in allowed types
2. `vote_yes_no_valid` - Outdated constraint blocking new vote types
3. `vote_structure_valid` - Structure validation for vote types

### Key Lesson:
**PostgreSQL only reports the FIRST failing constraint.** After fixing one constraint, ALWAYS test again immediately - another constraint may be blocking. The nomination voting fix required fixing TWO separate constraints that were hiding behind each other.

### Quick Debug Commands:
```bash
# Check API logs on droplet
bash scripts/remote.sh "docker compose logs --tail 100" /root/whoeverwants

# List all check constraints on a table
bash scripts/remote.sh "docker exec whoeverwants-db-1 psql -U whoeverwants -c \"SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'votes'::regclass AND contype = 'c';\""
```

**Time-saving tip**: Don't guess at the problem. Add logging, get the exact error, then fix the specific constraint.

### API Development Pitfalls

- **Catch-all fallthrough in `get_results()`**: When adding new poll types, `server/routers/polls.py` has a catch-all return at the bottom returning `yes_count=None`. Any poll type without an explicit handler silently falls through and the frontend interprets `None` as `0`. Always add an explicit handler for each poll type.
- **Frontend TODO stubs cause silent failures**: If the backend adds a new endpoint, check whether the frontend has TODO stubs (e.g., `setParticipants([])`) that need to be connected. Stubs cause incorrect UI without errors.

### CI/GitHub Actions Pitfalls

- **Vitest 3.x requires `@vitest/coverage-v8`** — the old `c8` provider is removed. Match the coverage package version to the vitest major version.
- **Next.js static export + `"use client"`**: `generateStaticParams()` cannot coexist with `"use client"` in the same file. For dynamic routes in static export, delete the route and rely on SPA fallback.
- **PR comment workflows** need explicit `permissions: pull-requests: write` in the workflow YAML.
- **GitHub Pages environments** only allow deploys from the configured branch (usually `main`). Restrict deploy workflow triggers to `main` to avoid noisy failures on feature branches.
