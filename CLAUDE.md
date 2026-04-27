# WhoeverWants Development Environment

## Project Overview

**WhoeverWants** is an anonymous questioning application for group decision-making. Users create and vote on questions without accounts or sign-ups, sharing via link.

- **Live site**: https://whoeverwants.com
- **Repository**: https://github.com/samcarey/whoeverwants
- **License**: Dual MIT / Apache 2.0

## Active Plan

The Supabase-to-Python migration and infrastructure improvements (Phases 1-10) are complete. The current architecture is: Vercel (frontend) + DigitalOcean droplet (FastAPI API + PostgreSQL).

**Next major change: poll redesign.** Every question becomes a poll wrapping one or more questions. The What/When/Where button bar replaces the single "+" FAB on threads/home. The legacy participation question type was removed in migration 094 — see "Participation Questions (Removed)" below.

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

**Full-Stack Dev Servers** (auto-deployed per-user on push):
1. **Write code** in this environment (Claude Code sandbox)
2. **Commit and push** to GitHub
3. GitHub webhook creates/updates your full-stack dev server on the droplet
4. Your dev site URL (based on `GIT_AUTHOR_EMAIL`) stays the same across all branches

Each dev server gets its own:
- **Next.js frontend** on port 3001-3005
- **FastAPI backend** on port 8001-8005 (runs via `uv run uvicorn`, 1 worker)
- **PostgreSQL database** (separate DB in the shared PostgreSQL container, e.g., `dev_sam_at_samcarey_com`)
- **All migrations from the branch** auto-applied on creation and update

**Production Frontend** (Vercel):
- Vercel auto-deploys on push to `main` → `whoeverwants.com`

**Production Backend** (Python API on droplet — auto-deployed on push to main):
- Merging/pushing to `main` auto-triggers: git pull → Docker rebuild → migration check → health verify
- Deploy logs: `bash scripts/remote.sh "tail -50 /var/log/dev-webhook.log" /root`
- Manual rebuild: `bash scripts/remote.sh "docker compose up -d --build" /root/whoeverwants`
- API logs: `bash scripts/remote.sh "docker compose logs --tail 100" /root/whoeverwants`

You do NOT need SSH — all server management goes through `scripts/remote.sh`.

**Per-User Dev Servers** (automatic on push):
- Every push to GitHub auto-updates your dev server via webhook (restarts both frontend and API)
- Frontend uses `next dev` with `PYTHON_API_URL` pointing to the local API
- API runs via `uv run uvicorn` with `DATABASE_URL` pointing to the dev database
- Migrations from the branch are auto-applied to the dev database on each update
- **After pushing, wait for the dev server to be ready.** The server takes ~30-60 seconds. Question with `bash scripts/remote.sh "curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>"` until it returns 200.
- URL is based on your `GIT_AUTHOR_EMAIL`: `<email-slug>.dev.whoeverwants.com`
  - Example: `sam@example.com` → `https://sam-at-example-com.dev.whoeverwants.com`
- URL stays the same regardless of branch — bookmark it
- Claude/bot emails (`*@anthropic.com`) are ignored
- Dev servers are fully isolated — each has its own API and database
- Auto-cleaned after 7 days of inactivity

```bash
# List active dev servers (shows frontend and API status)
bash scripts/remote.sh "bash /root/whoeverwants/scripts/dev-server-manager.sh list"

# Manually trigger a dev server update
bash scripts/remote.sh "bash /root/whoeverwants/scripts/dev-server-manager.sh upsert user@example.com claude/my-branch" /root 600

# Destroy a dev server (also drops its database)
bash scripts/remote.sh "bash /root/whoeverwants/scripts/dev-server-manager.sh destroy user-at-example-com"

# Check dev API health
bash scripts/remote.sh "curl -s http://localhost:<api_port>/health"

# Check dev API logs
bash scripts/remote.sh "tail -50 /root/dev-servers/<slug>/api.log"
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
| Framework | Next.js 16.2.0 (App Router, `force-dynamic` routes) |
| UI | React 19.2.4, Tailwind CSS 4, Geist font |
| Language | TypeScript 5 (strict mode, `@/*` path alias) |
| Backend | Python (FastAPI), managed by **uv** |
| Database | PostgreSQL 16 (local, via Docker) |
| Python tooling | **uv** — package management, virtual environments, Python version management |
| Unit tests | Vitest 3.2.4, Testing Library, jsdom |
| Python tests | pytest (managed via uv) |
| E2E tests | Playwright 1.55.0 (Chromium, Firefox, WebKit) |
| CI | GitHub Actions (Node 18/20 matrix, lint, coverage) |
| PWA | Service workers, manifest.json, Apple web app support |
| iOS | Capacitor 8 WebView shell (`capacitor.config.ts`), remote-URL loading; built on Mac mini self-hosted runner, distributed via TestFlight |

## Codebase Structure

```
whoeverwants/
├── app/                            # Next.js App Router
│   ├── layout.tsx                  # Root layout (fonts, viewport, service worker)
│   ├── template.tsx                # Page template wrapper
│   ├── page.tsx                    # Home page (question list, typing animation)
│   ├── globals.css                 # Tailwind global styles
│   ├── create-question/page.tsx        # Question creation form
│   ├── p/[shortId]/                # Dynamic question page (UUID-based routing)
│   │   └── page.tsx                # Question loader → resolves to ThreadContent
│   ├── thread/[threadId]/page.tsx   # Thread view (questions in follow-up chain)
│   ├── question/page.tsx               # Alternate question endpoint
│   ├── settings/page.tsx           # User settings (name, location, clear data)
│   └── api/                        # Server-side API routes
│       ├── test-pushover/          # Push notification testing
│       └── notify-claude-input/    # Claude notification integration
│
├── components/                     # 30 React components
│   ├── QuestionBallot.tsx           # Per-question ballot UI (mounted inside thread cards)
│   ├── QuestionBallot/
│   │   └── voteDataBuilders.ts     # buildVoteData + buildPollVoteItem (shared by QuestionBallot + thread page)
│   ├── ThreadHeader.tsx            # Fixed thread header with back arrow + respondent circles
│   ├── QuestionList.tsx                # Home page question list with sections
│   ├── QuestionResults.tsx             # Results display (all 4 question types)
│   ├── QuestionManagementButtons.tsx   # Creator controls (close/reopen/duplicate)
│   ├── YesNoAbstainButtons.tsx     # Yes/No/Abstain voting buttons
│   ├── RankableOptions.tsx         # Drag-to-rank interface (re-exports tier helpers from rankable/tiers.ts)
│   ├── rankable/                   # RankableOptions sub-modules
│   │   ├── tiers.ts                # Pure tier helpers (pairKey, computeTierIndices, computeDropTarget, ...)
│   │   ├── storage.ts              # localStorage persistence + shuffleArray + createRankedOptions
│   │   └── visuals.tsx             # LinkIcon, GripLines, DragHandleVisual, TierCardRows, LinkCircle
│   ├── SuggestionVotingInterface.tsx # Suggestion question voting
│   ├── SuggestionsList.tsx         # Display suggestions with vote counts
│   ├── CompactRankedChoiceResults.tsx # Ranked choice round display
│   ├── ReadOnlyTierCards.tsx       # Read-only tier-card ranking display (shared)
│   ├── MinMaxCounter.tsx           # Time-question Duration counter
│   ├── TimeQuestionFields.tsx          # Time-question Duration + day/time windows
│   ├── OptionsInput.tsx            # Question options/suggestions input
│   ├── Countdown.tsx               # Deadline countdown timer
│   ├── ConfirmationModal.tsx       # Confirm destructive actions
│   ├── ThreadList.tsx              # Home page thread list (messaging-style)
│   ├── FollowUpModal.tsx           # Create follow-up question modal
│   ├── FollowUpHeader.tsx          # Header showing parent question link
│   ├── FollowUpButton.tsx          # Create follow-up button
│   ├── DuplicateButton.tsx         # Duplicate question button
│   ├── VoterList.tsx               # List of voters on a question
│   ├── FloatingCopyLinkButton.tsx  # Copy question URL button
│   ├── GradientBorderButton.tsx    # Styled gradient button
│   ├── ClientOnly.tsx              # Client-only render wrapper
│   ├── ModalPortal.tsx             # Modal portal container
│   ├── HeaderPortal.tsx            # Header portal container
│   ├── ResponsiveScaling.tsx       # Mobile viewport scaling
│   ├── CommitInfo.tsx              # Commit info modal (GitHub API, relative time)
│   └── CounterInput.tsx            # Numeric counter input
│
├── lib/                            # 19 utility modules
│   ├── api.ts                      # Python API client (fetch-based)
│   ├── types.ts                    # Question, Vote, QuestionResults type definitions
│   ├── simpleQuestionQueries.ts        # getAccessibleQuestions, getQuestionWithAccess
│   ├── questionCreator.ts              # Question creation & creator secret management
│   ├── browserQuestionAccess.ts        # localStorage-based question access tracking
│   ├── questionAccess.ts               # Database-backed question access tracking
│   ├── threadUtils.ts              # Thread grouping/sorting from poll-level follow_up_to chains
│   ├── questionListUtils.ts            # Shared question display utilities (relativeTime, badges, icons)
│   ├── votedQuestionsStorage.ts        # localStorage voted/abstained question parsing
│   ├── questionDiscovery.ts            # Discover follow-up relationships
│   ├── userProfile.ts              # User name get/save (localStorage)
│   ├── forgetQuestion.ts               # Remove question from browser's access list
│   ├── debugLogger.ts              # Console logging utility
│   ├── base62.ts                   # Base62 encoding for short IDs
│   ├── prefetch.ts                 # Next.js page prefetching
│   ├── questionCache.ts                # In-memory LRU cache for questions/results/votes/participants
│   ├── questionId.ts                   # isUuidLike + normalizePath helpers
│   ├── viewTransitions.ts          # iOS-style slide transitions via View Transitions API
│   ├── usePageReady.ts             # Hook writing data-page-ready for view transitions
│   ├── useMeasuredHeight.ts        # Hook measuring an element's offsetHeight via ResizeObserver
│   ├── instant-loading.ts          # Page load optimization
│   ├── usePageTitle.ts             # Dynamic page title hook
│   └── pushoverNotifications.ts    # Push notification integration
│
├── database/migrations/            # SQL migration files (001-094, up + down)
│   ├── 001-015: Core schema (questions, votes, results, ranked choice, RLS)
│   ├── 016-041: Short IDs, question access, suggestion fields, RLS policies
│   ├── 042-050: Suggestion question type, vote constraints, editing
│   ├── 051-063: Participation question machinery (since removed in 094)
│   ├── 064-093: Cleanup, time question, polls, backfill
│   └── 094: Drop participation question type entirely
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
├── social_tests/                   # Social scenario testing framework
│   ├── conftest.py                 # Fixtures, QuestionHelper, result collection
│   ├── generate_report.py          # Test runner → MD → HTML → droplet deploy
│   ├── testing_strategy.md         # Philosophy doc (embedded in report)
│   ├── reports/                    # Generated reports (gitignored)
│   └── tests/                      # Scenario test modules
│       ├── test_casual_decisions.py    # Yes/no & suggestion questions
│       ├── test_ranked_preferences.py  # Ranked choice / IRV scenarios
│       ├── test_event_planning.py      # Multi-stage event planning scenarios
│       ├── test_edge_cases.py          # Anonymity, editing, large groups
│       └── test_multi_stage.py         # Multi-question workflows (follow-up)
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
│   └── bench-navigation.mjs        # Playwright navigation-perf benchmark
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
    └── eslint.config.mjs             # ESLint flat config (next/core-web-vitals)
```

## Key Concepts

### Question Types

| Type | Description | Vote Data |
|------|-------------|-----------|
| `yes_no` | Simple binary vote | `{ vote: "yes" \| "no" }` |
| `ranked_choice` | Instant Runoff Voting (IRV) with Borda tiebreak; supports equal/tied rankings; optional suggestion phase | `{ rankings: string[], ranked_choice_tiers?: string[][], suggestions?: string[] }` |
| `time` | Two-phase availability (day/time windows) → preferences (likes/dislikes) | `{ voter_day_time_windows: [...], liked_slots?: string[], disliked_slots?: string[] }` |

### Access Control Model

- **No user accounts** - fully anonymous
- **Browser-based access** via localStorage (`browserQuestionAccess.ts`)
- Question URLs grant access: visiting `/p/[id]` registers access
- Creator authentication via `creator_secret` (stored in localStorage)
- Database-level RLS (Row Level Security) policies on all tables

### Threaded Messaging UI

- **Main page shows threads**, not individual questions. A thread is a chain of polls linked by `polls.follow_up_to` (Phase 3.5 source of truth). Sub-questions of one poll are siblings inside the chain. `lib/threadUtils.ts` groups questions into threads client-side via `Question.poll_follow_up_to`; legacy `questions.follow_up_to` is still populated for compatibility but no longer consulted by the FE chain logic.
- **Thread title** defaults to the deduplicated list of participant names (`creator_name` + `voter_names` from the API). Users can override it via `/thread/<id>/edit-title` → `POST /api/questions/<latest_id>/thread-title`. The override is stored in the `thread_title` column on the thread's latest question; `Thread.title` prefers this override and falls back to `Thread.defaultTitle` (the names string) when NULL. Follow-up questions inherit the parent's `thread_title` on creation via a `COALESCE` subquery in the INSERT — no extra round-trip.
- **Thread sorting**: threads with unvoted open questions first (by soonest deadline), then threads with no unvoted questions (by most recent activity).
- **Thread view** (`/thread/[threadId]`) shows questions oldest-first (messaging order). Cards expand in place on tap (see "Expandable Question Cards" below) — there is no separate standalone question page. The long-press modal exposes Copy + Forget, plus Reopen when the question is closed and the browser knows the creator secret (or is running in dev mode).
- **Floating bubble bar auto-follows-up** when on a thread page via `document.body.getAttribute('data-thread-latest-question-id')` — the thread page sets this attribute on mount. The home page does NOT render the bubble bar; it has the single "+" FAB instead, which navigates to `/thread/new/` (the empty placeholder). `/thread/new/` shows the bubble bar (since it matches `isThreadLikePage`); the user picks a category from there. If the user dismisses the modal without submitting, the empty placeholder remains visible with the bubble bar; tapping back returns to home. On submit from the empty placeholder, the new question has no `follow_up_to` so it becomes its own thread root.
- **Shared utilities**: `lib/questionListUtils.ts` (relativeTime, getCategoryIcon, badges), `lib/votedQuestionsStorage.ts` (loadVotedQuestions), `lib/timeUtils.ts:formatCreationTimestamp` (absolute "@ h:mm AM M/D/YY" timestamp used in the tooltip + the expanded card). QuestionList keeps its own full-featured `getResultBadge` with user-specific participation messages.
- **Backend**: `voter_names` field on accessible questions response — extracted from already-fetched votes when possible, DB query only for remaining open questions.
- **Thread page uses document scroll with a fixed header.** The header is `position: fixed; top: 0` and the content below reserves a matching `padding-top` via a `ResizeObserver` that measures the header. Nothing flex-col wraps the content — the body is the scroller. When adding new fixed page chrome, put it in the template or portal it out; don't introduce inner scroll containers.
- **`useThread(threadId)` is the canonical thread loader** (`lib/useThread.ts`). Returns `{thread, loading, error}`. Initializes synchronously from the in-memory cache via `buildThreadSyncFromCache` (from `lib/threadUtils.ts`) and only falls through to the async fetch path on cache miss — so cache hits don't trigger redundant `discoverRelatedQuestions` / `getAccessibleQuestions` round-trips. Also writes `data-page-ready` on `<html>` so view transitions capture a fully-rendered snapshot. Use this hook for any new page that needs the thread for a route id; don't re-implement the cache-first + fallback pattern inline.
- **Thread sub-routes:** `/thread/<id>/info` (participant list + total count, with Back/Edit buttons) and `/thread/<id>/edit-title` (input to set/clear the `thread_title` override). These render their own fixed headers. `isThreadRootView(pathname)` in `lib/questionId.ts` is the helper that distinguishes the thread root view (gets the thread-like FAB + bottom padding in the template) from sub-routes (plain layout, no FAB). Update that helper when adding more thread sub-routes.
- **Empty thread placeholder:** `/thread/new/` is the empty-thread route surfaced by tapping the home page's "+" FAB. It is NOT a separate route file — `ThreadPageInner` in `app/thread/[threadId]/page.tsx` checks `if (threadId === 'new') return <EmptyThreadView />` BEFORE running any of `ThreadContent`'s heavy fetch/state setup. `EmptyThreadView` renders the shared `ThreadHeader` with `title="New Thread"` and an instructional message; no fetch, no thread state. The placeholder matches `isThreadLikePage`, so the What/When/Where bubble bar is rendered by the template — the user picks a category from there to open the create modal. The thread "materializes" only when the user actually creates a question (the new question has no `follow_up_to` so it becomes its own thread root). If you ever need other placeholder thread routes (`/thread/anything-special`), reuse the same in-`ThreadPageInner` branch pattern.
- **Shared `ThreadHeader` component** lives at `components/ThreadHeader.tsx`. Props: `headerRef`, `title`, optional `participantNames` + `anonymousCount` (renders `RespondentCircles` when provided), optional `subtitle`, optional `onTitleClick` (makes the title block a button when provided), optional `onBack` (defaults to navigating to `/`), optional `rightSlot` (renders an action node on the right; when provided, the title becomes centered and the right padding tightens from `pr-4` to `pr-2`). Used by `ThreadContent` (real-thread props), `EmptyThreadView` (just `title`), the `/info` sub-route (`onBack` + `rightSlot=<Edit button>`), and the `/edit-title` sub-route (`onBack` + `rightSlot=<Save button>`). Don't re-implement the fixed `top:0 + padding-top:env(safe-area-inset-top) + headerRef + back button` markup in another thread route — extend `ThreadHeader` or import it.
- **Thread page back button always navigates to `/`**, regardless of in-app history. Earlier the button used `hasAppHistory() ? navigateBackWithTransition() : navigateWithTransition('/')`, but after creating a question on `/thread/new/`, the prior history entry was the now-empty placeholder — back popped the user back to it instead of home. Hard-coding `'/'` is the cleanest fix and matches the user's mental model ("back from a thread → main list"). The `/info` and `/edit-title` sub-routes still use the conditional-back pattern because their natural back target is the thread, not home.
- **`useEffect(..., [])` + conditional early return = ref never attaches.** When a page renders a loading placeholder on first paint and then swaps to the real content after an async load, an effect with empty deps runs once on the first render — when the real refs don't exist yet — and never re-fires, so observers like `ResizeObserver` silently fail to attach. Fix: gate the real content behind an inner component that only mounts when data is ready (`if (loading) return <Loading/>; return <Inner {...}/>`). Effects inside `Inner` then run against refs that definitely exist. Used in `app/thread/[threadId]/info/page.tsx` and `.../edit-title/page.tsx`.
- **`useMeasuredHeight(deps?)` (`lib/useMeasuredHeight.ts`) is the canonical hook for the fixed-header padding-top compensation pattern.** Returns `[ref, height]`. Pass `[loaded]` as deps when the element is gated behind a loading early return inside the same component (e.g. `ThreadContent` passes `[thread]`); use the default `[]` when the element mounts once with the component (e.g. `EmptyThreadView`, `Info`, `Editor` — those gate the placeholder at the parent level so their inner component only mounts post-load). Don't re-inline `useLayoutEffect + ResizeObserver + offsetHeight` in new thread chrome.

### Expandable Question Cards (Thread View)

- **One component, two routes.** `ThreadContent` (exported from `app/thread/[threadId]/page.tsx`) renders the thread list. The `/thread/<root>/` route mounts it with no initially-expanded card; the `/p/<questionId>/` route resolves the question → walks up `follow_up_to` via `findThreadRootRouteId` against the accessible-questions list → mounts `ThreadContent` with `initialExpandedQuestionId` set. There is no longer a standalone question page — `QuestionBallot` is only rendered inline inside an expanded card.
- **Template treatment of `/p/*`.** The template computes `isThreadLikePage = isQuestionPage || isThreadPage` and uses it for layout (flex-col overflow-hidden, no duplicate header/back button). The copy-link button is rendered per-card in the upper-right of each card's compact header (visible whether collapsed or expanded), not at the page-corner level, so users can copy a question's share link directly from the thread view without navigating to `/p/<id>/`. The title uses `flex-1 min-w-0` alongside the `shrink-0` button wrapper so it wraps (line-clamp-2) before colliding with the button. Tap-to-expand is gated off the button via `stopPropagation` on the button wrapper's click/touch events.
- **URL sync without remount.** On expand/collapse we call `window.history.replaceState` to toggle the URL between `/p/<id>/` and `/thread/<root>/` without triggering a Next.js navigation. CLAUDE.md warns that `history.replaceState` + App Router back-nav can fight, but here it's only for URL display (the browser's own back button still pops to the prior real history entry).
- **Content-fade expand animation.** Height is animated via CSS grid: the wrapper transitions `grid-template-rows` between `0fr` and `1fr`, and a child `overflow-hidden` div clips the pre-mounted content. No JS height measurement is needed for the animation itself.
- **Pre-mount expanded content on viewport entry.** A shared `IntersectionObserver` on the scroll list adds a card's id to `visibleQuestionIds` when it enters the viewport (with a 200px rootMargin). Cards in `visibleQuestionIds` render `QuestionBallot` inside the grid wrapper even while collapsed (so fetches + effects complete before the user taps). Expansion is then instant — the `display`-like change is the grid-rows transition, not a mount.
  - Observer effect depends on `[!!thread]`, not `[thread]` — otherwise every forget/reopen mutation would tear the observer down and re-observe every card.
  - **Don't `console.log` inside a `setState` updater function.** The log forwarder (`CommitInfo`) intercepts console methods and dispatches a synchronous event that can call `setState` during React reconciliation, producing a "Cannot update a component while rendering" warning. Keep logs in event handlers / effects.
- **Long-press lives on the compact header sub-div**, not the whole card. That way the long-press handler fires for taps on the card background / title / metadata regardless of whether the card is expanded, but presses inside the expanded `QuestionBallot` (voting buttons, Submit Vote, etc.) don't misfire. The same pattern means we don't need to thread handlers based on expansion state.
- **Synthetic-click-vs-long-press race.** A long-press that opens the modal fires a touch-release → browser synthesizes a click at the touch position → the click lands on the full-viewport modal backdrop and closes the modal on the same gesture. Fix: `FollowUpModal` timestamps `isOpen` and ignores backdrop clicks for 400ms after opening.
- **Concurrent expand + scroll animation.** Tapping a card below the viewport's useful band should scroll just enough to reveal the bottom of the expanded card, capped so the top never goes behind the fixed header. Two subtleties:
  1. `scrollTo({ behavior: 'smooth' })` gets **clamped by the list's current `scrollHeight`**. During the 300ms grid-rows growth, `scrollHeight` is still smaller than the final value, so a scroll target past the current max silently undershoots. Either defer scroll until `transitionend` (simple, but the scroll lags behind the expand), or manually rAF-animate `scrollTop` over the same 300ms — the clamping stops biting because scroll progress and `scrollHeight` growth happen in lockstep. The thread page uses the rAF approach.
  2. The target height is measured from the **overflow-hidden wrapper's `scrollHeight`**, not the card's. `card.scrollHeight` reports the mid-animation laid-out height; the wrapper's scrollHeight reports the natural content height regardless of whether the parent grid row is `0fr` or `1fr`.
- **Compact row height.** The status-line slots (category icon left, countdown/badge right) default to `w-8 h-8` — bumping them up to `w-11` adds ~12px of whitespace above every collapsed card's title. Keep slot sizes small; scale the SVG inside (`w-7 h-7` fits in a `w-8 h-8` button).
- **Tap toggles expand/collapse on the compact header only.** There is no collapse chevron — tapping the status line / title / metadata toggles the card. Taps inside the expanded `QuestionBallot` do NOT collapse (we tried bubbling a click handler on the grid wrapper with `target.closest('button, input, ...')` filtering; rejected because the "collapse on non-interactive tap" region was confusing — the user expects the top band, not the whole expanded body). Long-press still opens the follow-up modal regardless of expansion state.
- **Shared cross-component update channel.** When a question is closed/reopened from inside the expanded `QuestionBallot`, it dispatches `window.dispatchEvent(new CustomEvent('question:updated', { detail: { questionId, updates } }))`. The thread page listens and merges `updates` into its local `thread.questions` state (and any open `modalQuestion`). Without this, the thread state stayed stale after close-from-card and the long-press modal didn't show the Reopen row. Guard the `setThread` updater with `.some()` so no-match events don't allocate a new questions array.
  - **Don't dispatch `question:updated` from the same component that already called `setThread` for the same question.** The thread page's long-press-modal close/reopen flow updates `thread.questions` locally; if it ALSO dispatches the event, the component's own listener re-applies the same update (the `.some()` guard only checks the question exists, not whether updates are already applied), forcing a redundant questions-array allocation + re-render. The dispatch is only needed when the mutation originates from a DIFFERENT component (e.g. the old in-card close handler in `QuestionBallot`). Rule of thumb: "dispatch iff you just mutated local state someone else might not have". Close Question was moved to the thread-page modal explicitly to avoid this bounce.
- **`QUESTION_VOTES_CHANGED_EVENT` is the sibling channel for vote-list refresh.** After any vote submission/edit, `QuestionBallot` dispatches `window.dispatchEvent(new CustomEvent(QUESTION_VOTES_CHANGED_EVENT, { detail: { questionId } }))` (constant lives in `lib/api.ts`). Every `VoterList` listens and re-fetches if the `questionId` matches. This replaced the previous `refreshTrigger` prop plumbing (state in `QuestionBallot` → through `RankingSection` → into `VoterList`), which double-fired alongside the event for in-card VoterLists and required every new call site to thread the state. The event handler + the existing 10s questioning interval cover same-tab and background refresh; no prop wiring needed.
- **Write localStorage BEFORE dispatching `QUESTION_VOTES_CHANGED_EVENT`.** `markQuestionAsVoted` (the function that updates `votedQuestions` in localStorage) used to run AFTER the dispatch. Listeners like the thread page (which re-reads `loadVotedQuestions()` in the handler to clear the awaiting-response golden border on the just-voted card) saw the pre-vote state and the border stuck until a refresh. Also: run `markQuestionAsVoted` on vote edits too, not just new submissions — otherwise editing from "voted" to "abstained" never transitions `votedQuestions[id]` from `true` to `'abstained'`, so any UI that distinguishes the two (again, the golden border) goes stale.
- **`loadVotedQuestions()` always allocates fresh Sets.** The helper creates new `Set<string>` instances each call, so even when contents are identical, `setVotedQuestionIds(fresh.votedQuestionIds)` always schedules a re-render and re-runs every downstream memo/prop that depends on the Set identity. Any high-frequency caller (e.g. a `QUESTION_VOTES_CHANGED_EVENT` listener) should compare by contents before committing: `setVotedQuestionIds(prev => setsEqual(prev, fresh.votedQuestionIds) ? prev : fresh.votedQuestionIds)`. The thread page's vote-changed handler does this.
- **Pin list sort to a snapshot when the items display live state.** The thread page sorts awaiting questions to the bottom AND draws a golden border on them. If both read the same live state, voting in one card reshuffles the list and moves the card out from under the user's tap. Fix: `useMemo` the sorted array keyed on the thread identity only (disable-next-line exhaustive-deps so `votedQuestionIds`/`abstainedQuestionIds` aren't listed as deps). The sort captures "awaiting at thread-load"; the border reads live state. Only requirement: define the predicate and the `useMemo` ABOVE any early returns in the component so the hook call order stays stable on loading → loaded transitions.
- **Thread-card respondent list uses `VoterList singleLine`** (under the card at `col-start-2 row-start-3`, as the right-hand flex child of a `flex items-start` row that also holds the creator/date label on the left; VoterList gets `flex-1 min-w-0 justify-end` so it takes whatever width is left after the creator/date natural width). The mode hides the count/icon prefix, renders one horizontal row (`whitespace-nowrap overflow-hidden`), and collapses overflow into a trailing `+N` badge. Measurement is a `useLayoutEffect` + `ResizeObserver` on the container that walks each child's `offsetWidth`, reserves space for the `+N` badge, and sets `display: none` imperatively on items that don't fit (bubbles are imperatively hidden; the `+N` badge itself is React-state-driven via the `overflow` state + `style.display`). Keep the two mechanisms separate — don't imperatively set the badge's display inside the effect or React will fight the DOM on re-render.
- **Measuring a React-hidden element with `offsetWidth` returns 0.** The `+N` badge is toggled via `style={{ display: overflow > 0 ? undefined : 'none' }}` — so on the very first measure (or any measure where `overflow === 0`), `plusRef.offsetWidth` is `0`. If the measurement loop then decides some items don't fit (reserving only `GAP + 0`), it sets `overflow > 0`, React reveals the badge, and the rendered row now exceeds container width by the badge's real width. With `justify-end` + `overflow-hidden`, the excess gets clipped off the LEFT edge of the leftmost visible bubble. Fix: temporarily force `plusEl.style.display = ''` before reading `offsetWidth`, save and restore the previous value so we don't stomp React's state-driven display. Any future "measure an element React has hidden" pattern needs the same save/read/restore dance.
- **Single pending-action confirmation modal.** Forget, Reopen, Close Question, and End Availability Phase all share one `ConfirmationModal` driven by `pendingAction: { kind: 'forget' | 'reopen' | 'close' | 'cutoff-availability'; question: Question } | null`. Per-kind copy (title/message/confirmText/confirmButtonClass) lives in a module-level `PENDING_ACTION_COPY: Record<PendingActionKind, ...>` lookup table. The modal is conditionally mounted (`{pendingAction && (...)}`) so each prop is a single lookup rather than parallel ternaries; `ConfirmationModal` already returns null on `!isOpen`, so no animation is lost. To add a new kind, extend the union + the table; don't rewrite the ternaries. The `onConfirm` body keeps one `if/else if` branch per kind since each branch's state-update logic genuinely diverges — always use explicit `else if (action.kind === '...')` rather than a bare trailing `else`, so that future additions to the union surface as no-op branches rather than silently landing in whatever was written last.
- **Close Question and End Availability Phase live in the long-press modal, not the ballot.** `FollowUpModal` renders a red "Close Question" button (`onCloseQuestion` prop) when the question is open AND `getCreatorSecret(questionId)` is known (or dev), and an amber "End Availability Phase" button (`onCutoffAvailability` prop) when additionally `isInTimeAvailabilityPhase(question)` is true. The thread page wires both props → `setPendingAction({ kind, question })` → shared ConfirmationModal → mutation API call. For `close`: `apiCloseQuestion` + optimistic `setThread({ is_closed: true, close_reason: 'manual' })`. For `cutoff-availability`: `apiCutoffAvailability` + optimistic `setThread({ suggestion_deadline, options })` + follow-up `apiGetQuestionResults` to repopulate `questionResultsMap` since the end of the availability phase changes which results are meaningful (time-slot counts now exist). The questionResultsMap updater uses the same content-equality guard pattern as the viewport-intersection results-fetch in the thread page — always allocating a new Map defeats the `===`-identity shortcut on downstream memos. `QuestionBallot` no longer carries close/reopen/cutoff-availability handlers, state, confirmation modals, or `QuestionManagementButtons` — all deleted as dead code when the buttons moved. If you see `handleCloseClick` / `handleReopenClick` / `handleCutoffAvailabilityClick` referenced in any future PR, it's a merge conflict with stale code.
- **Initial-expand scroll target differs from tap-expand.** Landing on `/p/<id>/` (or being redirected there after creating a question) should position the expanded card's top flush with the bottom of the top bar, regardless of where the card would naturally sit. The tap-to-expand "keep in view" rules (only scroll when the compact header is hidden above the top bar or the card overflows the bottom) are wrong for the entry case — e.g., a card that fits entirely in the viewport but isn't near the top wouldn't scroll at all, leaving dead space. Fix: a `hasHandledInitialExpandRef` flag short-circuits the expand-scroll logic exactly once when `expandedQuestionId === initialExpandedQuestionId`, always setting `targetDelta = cardTopY - visibleTopY`. Also: the auto-scroll-to-bottom effect must skip itself when `initialExpandedQuestionId` is set, otherwise it fires first (rAF) and fights the expand-scroll's computed target. Gate the expand-scroll effect on `headerHeight > 0` so the first run (pre-ResizeObserver) doesn't compute against `visibleTopY = 0` and accidentally consume the one-shot initial-expand branch.
- **Thread card chrome lives outside the card.** Each thread item is a 2-col × 3-row CSS grid: col 1 row 2 holds the category icon, col 2 row 1 is intentionally empty (the old above-card status label moved into the card's footer row), col 2 row 2 holds the bordered card itself (title + in-card footer row), col 2 row 3 holds the below-card row (creator/age label on the left, respondents bubble row on the right). The `row-start-2` placement of the icon cell pins its top to the card's top without a magic padding. `QuestionBallot` no longer renders its own countdown inside the ballot; the in-card footer row is the single source of status info. Time questions' deferred-deadline notice ("Availability cutoff Xmin after first response") still renders in the ballot because it conveys run-duration info the footer's "Collecting Availability" label doesn't — the parallel "Suggestions cutoff …" notice was removed.
- **In-card footer row: status label left, compact pill right, shared line.** Below the title + copy-link row, a flex row renders the status label (countdown / "Closed X ago" / "Taking Suggestions" / "Collecting Availability" / "Voting Xh") on the left (`shrink-0`, `pl-1` for breathing room from the rounded corner) and the question-type-specific compact pill on the right (`flex-1 min-w-0 flex justify-end`). `PILL_CLASS` includes `min-w-0` so the winner name truncates with ellipsis when the status claims most of the line. The row has `min-h-7` (~28px) pinned to the compact pill's natural height so `items-center` doesn't shift the status text up when the pill clips to 0 on expand — without the floor, the row height drops from pill-height to status-text-height and the centered status text jumps ~3–4px upward. When both `statusEl` and `pillEl` are null (no countdown AND no preview) the row is skipped entirely so the gap doesn't appear.
- **`items-center` on a flex row centers the margin-box, not the border-box.** `CompactPreviewClip` previously wrapped the pill in `<div className="mt-2">`, inside the overflow-hidden child. As a sibling in the footer flex row, its margin-box was ~8px taller on top, so `items-center` placed the pill's visible content below the status text. Fixed by dropping the inner `mt-2` — the parent flex row's own positioning handles the gap above. If you reintroduce a top margin inside a flex-item wrapper for vertical alignment reasons, know that it fights `items-center`.
- **Footer row must be `items-center`, not `items-start`, when the pill height ≠ label height.** The status label (text-sm ~21px line-box) and the compact pill (~26px with `py-px` + border) have different heights. `items-center` keeps their vertical midlines aligned (so "Closed 2m ago" sits visually centered with the green winner pill). `items-start` anchors both to the top of the row, which visually misaligns their baselines because the pill extends further below. Reducing row padding by switching to `items-start` saves ~3px but breaks left/right baseline alignment — don't. If you need to tighten the row, drop the row's `mt-*` or reduce `min-h-7` instead.
- **The below-card row uses `items-start` + per-child `mt-*`, not `items-center`.** Creator/date (text-xs) and respondent bubbles (text-xs + py-0.5 padding) have different natural heights. `items-center` aligns their vertical midpoints; with `items-start` they both anchor to the top of the row and each child can nudge itself independently — useful if you want the creator label flush with the card while bubbles have breathing room above them (current values: creator `mt-px`, bubbles `mt-[3px]`). The creator span is `shrink-0` so it takes natural width; the VoterList is `flex-1 min-w-0 justify-end` so it fills whatever's left over (replacing the old `max-w-[75%]` cap). If the creator name plus date ever grows wide enough to swallow the bubble area entirely, the bubbles just collapse to the `+N` overflow badge — that's the intended trade of "creator label always wins" over "bubbles always get 75%".
- **Expanded card uses `pb-1.5`, collapsed uses `pb-0.5`.** The thread card wrapper picks bottom padding off `isExpanded`. Collapsed cards use `pb-0.5` (2px) so the status/pill footer row sits snug against the card edge; expanded cards use `pb-1.5` (6px) — paired with `mt-1.5` (6px) on the wrapper around `QuestionBallot` inside the expand clip, this gives symmetric breathing room above and below the expanded results card. Originally `pb-0` + `mt-3` (no bottom padding, large top gap), tightened to keep the status label visually adjacent to its results without crowding the card edge. When adding new trailing content to an expanded card, the 6px is already there — don't re-pad inside `QuestionBallot` to fix trailing whitespace.
- **Icon vs title-line centering uses an empirical `mt-[7px]`** on a fixed-height 28px flex container (`h-7 items-center`). Pure line-box alignment (`mt-[9px]`) looks low because the line-box reserves descender space below the baseline; pure cap-to-baseline alignment (`mt-[5px]`) looks high because emoji glyphs are centered-ish in their em-box, not bottom-aligned. Splitting the difference reads right across the mix of emoji glyphs used for categories (🏆 👍 🗳️ 🙋 etc.). If the emoji set or title size changes, re-tune via Playwright `getBoundingClientRect` on both `<h3>` and the icon wrapper.
- **Yes/No results + voting UI is rendered externally by the thread view.** `YesNoResults` (in `components/QuestionResults.tsx`) is rendered OUTSIDE the expand clip in `app/thread/[threadId]/page.tsx`, not inside `QuestionBallot`. `QuestionBallot` takes an `externalYesNoResults` prop and skips its own `QuestionResultsDisplay` calls + the old ballot for yes_no questions when it's set, so the external render is the sole source of truth. The thread page loads results via `apiGetQuestionResults` and the viewer's own vote via `apiGetVotes` (filtered by `getStoredVoteId(questionId)`) into `questionResultsMap` / `userVoteMap` state. Taps on option cards / Abstain fire `onVoteChange(newChoice)` which opens a `ConfirmationModal`; on confirm the thread page routes to `apiEditVote` (existing vote) or `apiSubmitVote` (first-time vote, with saved `getUserName()`). After the call: `invalidateQuestion`, `setStoredVoteId` on first submit, `setVotedQuestionFlag`, `setVotedQuestionIds`/`setAbstainedQuestionIds` from `loadVotedQuestions()`, then dispatch `QUESTION_VOTES_CHANGED_EVENT`.
- **Yes/No results have a compact view and an expanded view driven by `hideLoser`.** `hideLoser=true` (thread card collapsed): single-line winner pill + `N%` + `(count)`, right-justified. `hideLoser=false`: the two option cards sit side-by-side (`w-24` each, right-justified in a flex with `items-center`), the chosen card gets a blue checkmark badge (`w-[1.625rem]`, white SVG check, `strokeWidth={4}`) in its *outer* corner (`-top-2 -left-2` on the left/Yes card, `-top-2 -right-2` on the right/No card — mirroring keeps it from overlapping the neighbor), and percent + parenthesized count render on a row below the cards. Abstain / "You abstained" sits in the left column of the same flex, vertically centered with the cards via `items-center`. Don't add a "PRELIMINARY" label — user removed it. The Yes-card always occupies the left grid slot and No the right (regardless of winner) so the checkmark's corner choice is stable.
- **localStorage helpers live in `lib/votedQuestionsStorage.ts`.** `loadVotedQuestions()` (sets), `hasVotedOnQuestion(questionId)` (boolean — true for both voted and abstained), `setVotedQuestionFlag(questionId, true | 'abstained' | null)`, `getStoredVoteId(questionId)`, `setStoredVoteId(questionId, voteId)`, and `parseYesNoChoice({ is_abstain, yes_no_choice })`. Use these — don't write inline `JSON.parse(localStorage.getItem(...))` for the `votedQuestions` / `questionVoteIds` keys. The thread page, `QuestionBallot`, and `forgetQuestion.ts` all consume these.
- **Post-vote ranked choice summary is a single "Your Ballot" amber link.** When `hasVoted && !isEditingVote && hasCompletedRanking` on a ranked_choice question, `QuestionBallot` no longer renders the "Your ranking:" / "Your choice:" card with the ReadOnlyTierCards list and Edit button. Instead it renders one centered `<button>Your Ballot</button>` using the shared Abstain-link class stack (`text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70`) that calls `setIsEditingVote(true)` on click. `ReadOnlyTierCards` is still used elsewhere but is no longer imported in `QuestionBallot`. Below-ballot preliminary results are also hidden whenever editing a ranked-choice vote (`!(isEditingVote && question.question_type === 'ranked_choice')`) — matches the above-ballot block, which was already hidden by `!isEditingVote`.

### Data Flow

1. **Question creation**: `create-question/page.tsx` -> `questionCreator.ts` -> Supabase `questions` table
2. **Voting**: `QuestionBallot.tsx` -> `supabase.ts:submitVote()` -> Supabase `votes` table
3. **Results**: `QuestionResults.tsx` -> `supabase.ts:getQuestionResults()` -> `question_results` view
4. **Access tracking**: `simpleQuestionQueries.ts:getQuestionWithAccess()` -> localStorage + `question_access` table

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

# Benchmarking
BENCH_URL=https://... npm run bench:nav  # Navigation performance benchmark

# Deployment
npm run publish                # Full workflow: commit, merge, push, migrate

# Social Tests (run from social_tests/ directory)
# Runs scenario tests against a live API and generates an HTML report
cd social_tests && uv run python generate_report.py  # Full pipeline: test → report → deploy
cd social_tests && uv run python generate_report.py --skip-deploy  # Local report only
cd social_tests && uv run pytest tests/ -v           # Run tests without report

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

- **NEVER push to `main` under any circumstances.** All changes must go through a feature branch + pull request. This applies to every form: `git push origin main`, `git push origin HEAD:main`, `git push origin HEAD:refs/heads/main`, and bare `git push` when checked out on main. If branch protection blocks a push or a force-push, **do NOT find a workaround** — stop and ask the user. There is no scenario (rollback, revert, hotfix, "the user said to move fast") where bypassing main's branch protection is acceptable. A local PreToolUse hook at `.claude/hooks/block-push-to-main.py` enforces this as a fast-fail check; GitHub branch protection enforces it server-side. If you hit either block, that's the system working correctly — open a PR instead.
- For server logs, use `scripts/remote.sh` to read logs directly from the droplet.
- Client-side console output is captured by the CommitInfo Logs tab (click page header to open).
- **Keep droplet setup docs current**: When you change anything about the droplet infrastructure (Caddy config, Docker Compose, systemd services, provisioning steps, new services, port changes, etc.), update **both** `docs/droplet-setup.md` and `scripts/provision-droplet.sh` to reflect the change. These files must always describe how to reproduce the current droplet from scratch.
- **Never bold URLs**: Do not wrap URLs in `**bold**` markers. The asterisks get rendered literally in the terminal and break the link. Write URLs as plain text.
- **PR workflow**: When asked to open a PR, always do these steps first:
  1. **Run `/simplify`** to clean up any code quality issues, redundancy, or missed improvements.
  2. **Update CLAUDE.md** with any lessons learned, new patterns, pitfalls discovered, or infrastructure changes from the current work. Keep the knowledge base growing.
  3. **Rebase on main** (`git fetch origin main && git rebase origin/main`) to ensure the branch merges cleanly. Force-push if needed after rebase.
  4. Create the PR.
  5. **Wait for PR checks to pass AND verify mergeability** before showing the PR link. Question **both** the check-runs API (`/commits/{sha}/check-runs`) AND the **combined** commit status API (`/commits/{sha}/status`, singular) every 15s until all checks complete — GitHub Actions results appear in check-runs, but Vercel build status appears in commit statuses. Also confirm `mergeable: true` on the PR. Report the link only after both succeed, or report failures.
     - **Do NOT use `/commits/{sha}/statuses` (plural) for gating.** That endpoint returns every status event ever posted for the commit (chronological log), including superseded `pending` entries — a Vercel deploy that went `pending → success` will still surface a stale `pending` entry forever, so a naive "count pending" check never converges. Use `/status` (combined, singular), which collapses to one entry per context with the current state in `state` and `statuses[].state`. If you must use `/statuses`, group by `context` and keep only the newest `updated_at` per context.
     - **Prefer `Bash` with `run_in_background: true` over `Monitor` for "wait until CI is done."** The Monitor tool is for streaming events ("notify me on every match"); one-shot completion detection should use `run_in_background`, which fires exactly one completion notification regardless of how many interim state changes the underlying check goes through. A buggy loop condition in a backgrounded Bash command hangs silently until timeout; the same condition in a Monitor floods the conversation with one event per question tick until timeout.
     - **If you do arm a questioning `Monitor`, test the question condition as a one-shot first.** Run the exact check command once with plain Bash and eyeball the output — confirm the "terminal" branch actually fires when the real state is terminal. Don't infer from the API docs; run it against the live commit. Keep the timeout short (5 min default, re-arm after progress) so a bad condition can't produce more than ~20 noise events before you intervene. If the same non-terminal event repeats 2–3 times with no progress, the condition is wrong — fix the loop rather than ignoring the stream.
  6. **Always `subscribe_pr_activity` immediately after reporting the PR link** — the user wants CI failures and review comments streamed into the session by default. Don't ask first.
- **Demo after every change**: After pushing a fix or feature, wait for the dev server to finish rebuilding (question the dev API health endpoint until it returns 200), then use the API to create a realistic demonstration that showcases the new behavior. Create questions, cast votes with realistic names, set up whatever scenario best highlights the change. Think creatively — make names, options, and question titles feel like real people making real decisions. Use a generous expiration buffer (e.g., 7 days) unless the demo specifically requires an imminent deadline. Share the dev server link to the demo question with the user so they can see the change in action.

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
node scripts/debug-console.cjs [question-id-or-url]

# npm scripts:
npm run debug:console [question-id-or-url]
npm run debug:react [question-id] [action]

# Examples:
node scripts/debug-console.cjs f1eb5036-fb77-4baa-9f23-a2774c576c5b
node scripts/debug-console.cjs /create-question
npm run debug:react question-123 vote      # Debug voting process
npm run debug:react question-123 revisit   # Debug vote retrieval
```

### Browser Console vs Server Logs

- **Server logs** (`sudo journalctl -u whoeverwants-dev -f`) - server-side errors, API routes
- **Browser console** (via Playwright capture) - client-side React state, component lifecycle, database fetch errors

---

## Client Log Forwarding (Dev Sites Only)

On dev/debug sites (`*.dev.whoeverwants.com`, `localhost`), the browser automatically forwards all `console.log/warn/error/info/debug` output plus unhandled errors/rejections to the server via `POST /api/client-logs`. Logs are stored in an in-memory ring buffer (last 2000 entries) on the API server.

**This is NOT active on production** (whoeverwants.com).

### When the user reports an issue

**IMMEDIATELY check client logs** in addition to server-side logs. This is the fastest way to see what the browser was doing when the error occurred:

```bash
# Read recent client logs (most recent first)
bash scripts/remote.sh "curl -s http://localhost:<api_port>/api/client-logs?limit=100" | python3 -m json.tool

# Filter by level (error, warn, log, info, debug)
bash scripts/remote.sh "curl -s 'http://localhost:<api_port>/api/client-logs?level=error&limit=50'" | python3 -m json.tool

# Search for specific text in log messages
bash scripts/remote.sh "curl -s 'http://localhost:<api_port>/api/client-logs?search=failed&limit=50'" | python3 -m json.tool

# Clear logs (useful before reproducing an issue)
bash scripts/remote.sh "curl -s -X DELETE http://localhost:<api_port>/api/client-logs"
```

Replace `<api_port>` with the dev server's API port (8001-8005).

### Diagnostic checklist when user reports a bug

1. **Client logs**: `curl http://localhost:<api_port>/api/client-logs?level=error&limit=50`
2. **Server logs**: `docker compose logs --tail 100` or `tail -50 /root/dev-servers/<slug>/api.log`
3. **Full client log dump**: `curl http://localhost:<api_port>/api/client-logs?limit=200` (includes info/debug for context)

### How it works

- `lib/clientLogForwarder.ts` patches `console.*` methods on dev sites only
- Logs are batched every 2 seconds and sent via `navigator.sendBeacon` (survives page unloads)
- Each entry includes: level, message, timestamp, page URL, user agent, session ID
- Ring buffer auto-evicts entries beyond 2000 (no disk writes, no persistence across API restarts)
- The forwarder is installed once in `app/template.tsx` on mount

---

## Participation Questions (Removed)

The `question_type='participation'` type, its FE components (`ParticipationConditions`, `QuestionField`, `ParticipationConditionsCard`), the `algorithms/participation.py` priority algorithm, the `auto_close.py` capacity-watcher, and every supporting column/constraint were dropped in **migration 094** (schema) plus the matching code removal. There is no longer a "participation" question type or codepath. (`MinMaxCounter` survives — it's used by `TimeQuestionFields` for the time-question Duration counter.)

If a future feature needs RSVP-style headcount semantics, it should be designed from scratch as a question category inside the poll system rather than reviving the old standalone-question architecture. The historical inclusion-priority algorithm (greedy selection respecting per-voter min/max constraints) is preserved in git history if anyone wants to mine it.

---

## Poll System

> **Phase 5 + 5b shipped.** Migration 096 dropped the wrapper-level columns
> from `questions` (short_id, creator_secret, creator_name, response_deadline,
> is_closed, close_reason, follow_up_to, thread_title, suggestion_deadline,
> sequential_id). The `polls` table is now the sole source of truth.
> **Phase 5b (this branch)** retires those fields from the API contract too:
> `QuestionResponse` no longer surfaces them, and the FE consumes them from
> `Poll` instead via:
>
> 1. `POST /api/questions/accessible` returns `PollResponse[]` (was
>    `QuestionResponse[]`). The home page passes `polls` directly into
>    `ThreadList`. `apiGetAccessibleQuestions` returns `Poll[]`;
>    `getAccessiblePolls` is the canonical helper.
> 2. `lib/threadUtils.ts: buildThreads(polls, ...)` walks
>    `poll.follow_up_to` for chain construction. `Thread` carries both
>    `polls: Poll[]` and the flattened `questions: Question[]`. Wrapper
>    reads (creator_name, response_deadline, is_closed, thread_title) come
>    from `latestPoll` / each Poll directly.
> 3. Components that need wrapper context take a `poll: Poll` prop
>    (or specific deadline props for `RankingSection`). The thread page
>    derives a `pollWrapperMap` from `thread.polls` and threads
>    `wrapper` into `QuestionBallot`, `FollowUpModal`, the in-card status
>    label, the copy-link button, and the long-press action handlers.
> 4. `lib/questionCache.ts` exports `getPollForQuestion(question)` and
>    `getCachedAccessiblePolls()`. `cacheByShortId` was removed —
>    `getCachedQuestionByShortId` now resolves through the poll cache and
>    returns `wrapper.questions[0]`. `apiGetQuestionByShortId` is a thin wrapper
>    over `apiGetPollByShortId`.
> 5. Server-side: `QuestionResponse` only carries per-question fields (plus
>    `poll_follow_up_to` for chain walking). Internal logic still JOINs
>    polls via `_SELECT_QUESTION_FULL` for vote validation / results
>    computation, but those fields don't escape into the response.
>    `PollResponse` is the canonical wrapper shape.
>
> Note: `components/QuestionList.tsx` was deleted (dead code — the home page
> uses `ThreadList`). Legacy single-question mutation endpoints (`POST /api/questions`,
> vote/close/reopen/cutoff/thread-title) and FE clients are gone (Phase 5).
> `Question.follow_up_to` is gone — chain logic uses `poll_follow_up_to`.
> `FollowUpHeader` now takes a poll_id.


### Submission paradigm (READ FIRST, alongside Addressability)

**Sub-questions cannot exist or be submitted by themselves.** A question is always a section of a poll. The poll is the unit of identity, sharing, voting, and submission. This is non-negotiable architecture, not a UX nicety.

- **Poll-level state lives on a poll wrapper component.** The wrapper owns: voter name input, Submit button, confirmation modal, "you voted / Edit" overall state, vote-changed event dispatch, cache invalidation. None of these belong inside a question component. Today (mid-rollout) the wrapper for multi-question groups is rendered inside the thread-page card group; for 1-question polls the legacy per-question `QuestionBallot` Submit still exists but is being lifted (Phase 3.4 follow-up B).
- **Sub-question-level state lives on the question component** (`QuestionBallot` today, to be renamed `QuestionBallot`). Owns: category-specific ballot UI (yes/no buttons, RankableOptions, TimeSlotBubbles, suggestion entry), per-question abstain control, per-question ranking/preferences state, section label / context display.
- **Abstaining is per-sub-ballot, not per-poll.** A voter can abstain on one question while voting on others. There is no single "abstain from this whole poll" toggle. Each question's abstain control is rendered inside that question's section.
- **Ballot draft is per-poll** (one localStorage entry keyed by `poll_id` holding `{voter_name?, questions: { [question_id]: QuestionDraft } }`, written under `ballotDraft:m:<pollId>`). Voter name is shared across the poll; per-question state is keyed by question id inside the entry. `lib/ballotDraft.ts` exposes per-question convenience helpers — `loadQuestionDraft(pollId, subQuestionId)` / `saveQuestionDraft(...)` / `clearQuestionDraft(...)` — that read/write the slot inside the poll entry. Legacy per-question entries written under `ballotDraft:<subQuestionId>` are auto-hoisted into the poll entry on first `loadQuestionDraft` and the legacy key is dropped. Participation questions have no poll wrapper — pass `pollId === null` and the helpers fall back to the legacy per-question key path. `clearQuestionDraft` drops the whole poll entry once its last question slot is cleared and `voter_name` is unset, so stale entries don't accumulate. The deprecated `loadBallotDraft` / `saveBallotDraft` / `clearBallotDraft` aliases remain as thin wrappers over the null-pollId path; new callers should use the per-question helpers. The wrapper-level voter-name field is wired up by Phase 3.4 follow-up B as the poll-level Submit lands.
- **Vote submission is always atomic across the poll.** Every vote write goes through `POST /api/polls/{id}/votes`. The per-question `apiSubmitVote` / `apiEditVote` callsites are legacy — only reached today as fallbacks when `question.poll_id == null` (i.e. participation questions + any pre-Phase-4 unbackfilled question); removed entirely in Phase 5.

When designing any vote/submission feature, the rule is: **does this belong on the poll wrapper or inside a question's section?** Anything to do with identity, sharing, the act of submitting, or aggregate state goes on the wrapper. Anything specific to a category's ballot interaction goes inside the section.

### Addressability paradigm (READ FIRST)

**The poll is the addressable unit. Sub-questions are internal-only.** This shapes every Phase 2+ decision:

- **URLs reference polls, never questions.** Polls have `id` (uuid) and `short_id` — both URL-able (`/p/<short_id>/`, `/thread/<id>/`). Sub-questions have a `questions.id` uuid for foreign-key purposes inside the DB, but it is not URL-able. Never construct `/p/<question-uuid>/` — use the parent poll's `short_id`. (The legacy fallback `/p/<question-uuid>/` happens to resolve via `apiGetQuestionById` today because the loader cascades, but treat that as a transitional artifact, not an API.)
- **No client-side aggregation across questions.** Anything that conceptually belongs to "the whole poll" — voter participation list, total respondent count, copy-link target, share-via, vote-submission unit, close/reopen/cutoff target — must come from a poll-level data source. Don't iterate `poll.questions` on the FE to compute poll-level state. Either (a) the server returns the aggregate as a field on `PollResponse` / a sibling endpoint, or (b) a poll-level endpoint computes it server-side. Anything that lands as "merge N per-question fetches in the browser" is the wrong shape — push the aggregation to the server.
- **Per-question data still flows per-question.** Each question's ballot, results, options, suggestions, time slots, etc. continue to use `/api/questions/<question-id>` style endpoints. The principle is about POLL-LEVEL aggregates, not about retiring per-question plumbing.
- **Internal client state can still key on question ids.** Refs (`cardRefs`, `expandedWrapperRefs`), per-question cache entries (`questionCache`), and DOM keys all use question ids freely — they're stable internal identifiers, not URLs. The principle bites at the FE↔server boundary, not at internal data structures.

When designing a new feature: ask "is this a poll-level concept?" If yes, route through a poll endpoint or field; never sum/dedupe across questions in the browser.

**Status**: phasing plan in `docs/poll-phasing.md`. **Every phase shipped** (Phases 1 through 5b). The poll redesign is complete — all wrapper-level state lives on `Poll`, question data lives on `Question`, and the API contract reflects that boundary.

- **Phase 1 (schema + new API)** — migration 092 created the `polls` table and added nullable `poll_id` + `question_index` to `questions`; endpoints `POST /api/polls`, `GET /api/polls/{short_id}`, `GET /api/polls/by-id/{id}` create + read wrapper-and-questions atomically. Validation rejects participation questions, multiple `time` questions, and same-kind questions without distinct `context`. Auto-title is computed at read time from question categories + poll context (rules in `server/algorithms/poll_title.py`); explicit titles persist to `thread_title`.
- **Phase 2.1 (frontend plumbing)** — `Poll` type in `lib/types.ts`, poll cache helpers in `lib/questionCache.ts`, `apiCreatePoll` / `apiGetPollByShortId` / `apiGetPollById` in `lib/api.ts`.
- **Phase 2.2 (writes route through polls)** — `app/create-question/page.tsx` calls `apiCreatePoll` for non-participation questions; participation keeps `apiCreateQuestion`. `app/p/[shortId]/page.tsx` loader tries `apiGetPoll*` first, falls back to `apiGetQuestion*` on 404 (uses exported `ApiError` for the status check). `next.config.ts` proxies `/api/polls` paths same-origin like `/api/questions`. Server-side `_resolve_parent_poll_id` translates `follow_up_to` QUESTION ids in the request into the parent's `poll_id` for the polls row, while the original question_id is also written onto each question's `questions.follow_up_to` so legacy thread aggregation keeps working through Phase 5. `_insert_poll`'s thread_title COALESCE has a third branch reading from the legacy parent question's `thread_title` so threads with mixed-mode parents inherit titles correctly.
- **Phase 2.3 (What/When/Where bubble bar)** — replaced the single "+" FAB on thread-like pages (`/thread/<id>/`, `/p/<id>/`, `/thread/new/`) with three pill buttons. Home page keeps the single "+" FAB which navigates to `/thread/new/`. Each bubble preselects in the create-question modal: What → no preselection, When → `?mode=time`, Where → `?category=restaurant`. See "Navigation Layout" for full details.
- **Phase 4 (backfill)** — migration 093 wraps every non-participation question without a `poll_id` in a 1-question poll wrapper. After it runs, `polls.short_id` matches the source question's `short_id` (URLs preserved), `questions.poll_id` + `questions.question_index = 0` link them, and `polls.follow_up_to` references the parent's wrapper (NULL when the parent is a participation question). Migration is idempotent — `WHERE poll_id IS NULL` filter makes re-runs no-ops. The migration also self-heals dev DBs that lack `questions.short_id` / `questions.sequential_id` (a quirk where migration 030 dropped those columns and prod's Supabase-bootstrapped schema retained them but freshly-built dev DBs don't): a `DO` block adds them back when missing and back-fills sequential_id + short_id for pre-existing rows. No-op on prod.
- **Phase 2.5 (multi-question rendering)** — questions of one poll are treated as siblings when building threads. `Question` carries `poll_id` + `question_index` (server `QuestionResponse` exposes both, `_row_to_question` maps from DB, `toQuestion` maps to FE). `lib/threadUtils.ts: buildQuestionMaps` returns a `questionIdsByPoll` grouping (Phase 3.5 renamed `siblingsOf`); `collectDescendants` fans every visited question out to all its siblings. The thread-page sort uses `question_index` as the tiebreaker for shared `created_at`. `server/algorithms/related_questions.py: QuestionRelation` carries `poll_id` + `poll_follow_up_to`; `get_all_related_question_ids` walks poll-level chains and expands every visited poll to its questions so discovery grants access to peer questions.
- **Phase 2.4 (multi-question create UI)** — `app/create-question/page.tsx` adds a `+ Add another section` button that calls `buildQuestionFromState()` to push a `CreateQuestionParams` onto a new `stagedQuestions` state, then resets per-question state (title, options, category, forField, optionsMetadata, ref location, min_responses, show_preliminary_results) while preserving poll-level state (creator name, voting cutoff, suggestion cutoff, details, follow_up_to). Staged rows render above the form; submit calls `questionDataToPollRequest(questionData, stagedQuestions)` (the helper now takes an `additionalQuestions` array that's prepended to the questions array — staged drafts come first, current form last). Persisted in the same `questionFormState` localStorage so modal close+reopen preserves the draft. The +Add button is hidden for `time` and `participation` (per MVP scope: no time-question staging; participation questions can't be questions at all). Submit is rejected client-side with a clear error if the user managed to switch to participation while staged questions exist. When staged questions exist AND `isAutoTitle === true`, the wrapper title is sent as `null` so the server's `generate_poll_title()` builds it from question categories — user-typed titles (isAutoTitle=false, e.g. yes/no questions) still pass through as the wrapper title. `recordQuestionCreation` is called for every question on success so the creator gets `creator_secret` access for each. Out of scope (Phase 3): per-question context UI, time-question staging, edit-staged questions, the dual-modal layout.
- **Phase 3.2 (thread card aggregation)** — Sibling questions of a poll render as ONE card group instead of N cards. Server: `PollResponse` gains `voter_names: list[str]` + `anonymous_count: int` (computed via `_compute_poll_voter_data` — `array_agg(DISTINCT voter_name)` for named, `MAX(per-question anon)` for anon). Wired into every poll GET + close/reopen/cutoff endpoint. FE: thread page iterates `groupedThreadQuestions` (memo grouping `threadQuestions` by `poll_id`); 1-question wrappers render identically to today, multi-question wrappers render one card with stacked `QuestionBallot` instances inside the expand clip (each with a section label = category icon + question's `details`). Poll wrapper is lazy-fetched via `apiGetPollById` on viewport intersection, stored in `pollWrapperMap`, refreshed on `QUESTION_VOTES_CHANGED_EVENT`. `VoterList` grows a static-data mode (`staticVoterNames` + `staticAnonymousCount`) that the thread page uses to render the poll-level respondent row from the wrapper — never aggregated client-side per the Addressability paradigm. Copy-link routes through the poll's `short_id`. `maybeFetch` (results) treats anchor visibility as group visibility so every sibling's results are fetched together.
- **Phase 3.4 (unified vote endpoint + FE helper)** — `POST /api/polls/{poll_id}/votes` accepts `{voter_name, items: [{question_id, vote_id?, vote_type, ...}]}` and applies every item atomically inside a single transaction. Each item inserts (vote_id null) or updates (vote_id set) on its question_id; per-item validation, deferred-deadline arming, suggestion-phase enforcement, options_metadata merging, and auto-close all run inline so the unified path is functionally identical to N parallel per-question calls. Any item failure rolls back the whole batch — no half-applied state. `_submit_vote_to_question(conn, question_id, req, now) -> row` and `_edit_vote_on_question(conn, question_id, vote_id, req, now) -> row` are extracted from `routers/questions.py: submit_vote` / `edit_vote` so the per-question endpoints and the poll endpoint share the same logic; both helpers operate on a shared connection (no `with get_db()`) so the poll endpoint can wrap N calls in one transaction. FE helper `apiSubmitPollVotes(pollId, {voter_name, items})` lives in `lib/api.ts` alongside the existing per-question helpers; it cascades cache invalidation through `invalidatePoll` (which already evicts every question's per-question cache entry), so callers don't need to walk `items[]` manually. The `PollVoteItem` interface is exported.
- **Phase 3.4 follow-up A (poll-level Submit for all-yes_no multi-groups)** — When a thread card holds 2+ yes_no questions (`isMultiGroup && group.subQuestions.every(sp => sp.question_type === 'yes_no')`), the per-question tap-to-vote-immediately flow is replaced by a wrapper-level Submit button + voter-name input rendered below the expand clip in `app/thread/[threadId]/page.tsx`. Tapping yes/no/abstain on a question's external `QuestionResultsDisplay` writes to `pendingPollChoices: Map<question_id, 'yes'|'no'|'abstain'>` instead of firing `setPendingVoteChange`. The card's `userVoteChoice` reads staged-then-existing so the tapped pill highlights immediately. Submit is gated `disabled={submitting || !hasStagedChange}`; on confirm, `confirmPollSubmit(pollId, subQuestions)` builds a `PollVoteItem[]` from `buildPollItems(subQuestions)` (only questions with a staged choice), calls `apiSubmitPollVotes`, then distributes returned `ApiVote`s back into `userVoteMap` (keyed by `v.question_id` matched against `subQuestions`), syncs `setStoredVoteId` + `setVotedQuestionFlag` per item, fires `QUESTION_VOTES_CHANGED_EVENT` per item, and clears the staged choices for the poll. `pollVoterNames: Map<pollId, string>` keys the per-poll voter name input. Mixed-type multi-groups (yes_no + ranked_choice) and 1-question polls keep their existing per-question Submit flow until PR B lifts Submit out of `QuestionBallot` generally. Also: new `partOfPollGroup` prop on `QuestionBallot` suppresses the duplicate `<QuestionDetails details={question.details} />` render for multi-group questions (the thread-page section label already shows `question.details` as the disambiguating context label). PR B will extend the same prop to gate Submit / voter name / confirmation.
- **`confirmVoteChange` (yes_no tap-to-change for the non-staged path) routes through `apiSubmitPollVotes` when the question has a `poll_id`.** The thread page's `confirmVoteChange` (used by 1-question yes_no polls AND by the yes_no anchor in mixed-type multi-groups where `usePollSubmit = isMultiGroup && allYesNo` is false) builds a single-item `PollVoteItem[]` and calls `apiSubmitPollVotes(pollId, { voter_name, items })`. The legacy `apiSubmitVote`/`apiEditVote` branch is preserved as a fallback for the `poll_id == null` case (theoretically unreachable for yes_no after the Phase 4 backfill, but kept for safety). On a fresh first-time vote the poll path also calls `saveUserName(voter_name)` so the name carries over to subsequent questions (matches the all-yes_no group flow).
- **`QuestionBallot.submitVote` also routes through `apiSubmitPollVotes` when `question.poll_id` is set** — same gate as the thread page's `confirmVoteChange`. Builds a single-item `PollVoteItem` from the same `voteData` the legacy path uses, with `vote_id` set on edits / null on inserts. After this change, the only remaining `apiSubmitVote` / `apiEditVote` callsites in client code are the legacy fallbacks for `poll_id == null` — i.e. participation questions (kept on the legacy path forever) plus any not-yet-backfilled question. Suggestions are deliberately omitted from the item on ranked_choice edits past the suggestion-phase deadline (`isEditing && question.question_type === 'ranked_choice' && !canSubmitSuggestions`); the server's edit path uses `suggestions = COALESCE(%(suggestions)s, suggestions)` so sending `null` would also be safe, but matching the legacy `suggestions: undefined` pattern keeps the contract explicit. The explicit `invalidateQuestion(question.id)` call later in `submitVote` is intentionally NOT removed for the poll path: `invalidatePoll` only cascades to per-question evictions when the poll cache happens to be warm (`if (entry)` in `lib/questionCache.ts:178`); on a cold poll cache the question caches wouldn't be touched, so the explicit call is the safety net. Phase 3.4 follow-up B will lift Submit out of `QuestionBallot` entirely; this change retires the per-question endpoint usage one phase earlier so the wrapper-level lift becomes a pure UI refactor.
- **Phase 3.4 follow-up B (1-question case): wrapper-level Submit + voter name for every 1-question non-yes_no poll.** `QuestionBallot` is now a `forwardRef` component exposing `QuestionBallotHandle.triggerSubmit()`. New props on the component: `wrapperHandlesSubmit: boolean` (gates the inline Submit + voter-name + `CompactNameField` blocks in the time-availability and time-preferences branches AND propagates to `RankingSection` + `SuggestionVotingInterface` so they skip their internal Submit/voter-name); `externalVoterName?: string` and `setExternalVoterName?: (name) => void` (when passed, they override QuestionBallot's internal `voterName` state — `submitVote` always reads the wrapper-controlled value); `onWrapperSubmitStateChange?: (questionId, { visible, label }) => void` (fires whenever QuestionBallot's "should the inline Submit show + what does it say" computation changes — `visible` mirrors the original gating: hidden in the voted-not-editing steady state, visible during initial-vote and edit modes; `label` preserves the type-specific copy "Submit Vote" / "Submit Availability" / "Submit Preferences"). The `useImperativeHandle` for `triggerSubmit` is wrapped via a `useRef`-stashed `handleVoteClick` closure so the handle stays stable across renders while always invoking the latest closure. The `getUserName` initial-load `useEffect` skips when `wrapperHandlesSubmit` is true so QuestionBallot doesn't fire the wrapper's setter from inside the child on mount.
  - **Thread page wiring** (`app/thread/[threadId]/page.tsx`): `subQuestionBallotRefs: Map<string, QuestionBallotHandle>` collects per-question handles via callback refs. `wrapperSubmitState: Map<string, { visible, label }>` stores the per-question state from `onWrapperSubmitStateChange` (uses a single ref-cached stable callback so QuestionBallot's effect deps don't churn across parent re-renders). The wrapper Submit + voter-name JSX renders inside the same overflow-hidden expand clip as the all-yes_no follow-up A wrapper Submit, gated by `useWrapperSubmit = !isMultiGroup && !!group.pollId && group.subQuestions[0]?.question_type !== 'yes_no'`. The voter name input reads from / writes to the existing `pollVoterNames: Map<pollId, string>` (shared with follow-up A's all-yes_no flow). The Submit button calls `subQuestionBallotRefs.current.get(sp.id)?.triggerSubmit()` which routes to QuestionBallot's existing `handleVoteClick` → `ConfirmationModal` → `submitVote` → `apiSubmitPollVotes` flow — no duplication of submit machinery, no double-modal.
  - **Mixed-type multi-question groups also lifted to wrapper Submit (this PR).** A poll containing yes_no + non-yes_no questions (e.g. yes_no + ranked_choice) now renders ONE wrapper Submit + ONE voter-name input + ONE ConfirmationModal — both yes_no and non-yes_no items folded into a single atomic `apiSubmitPollVotes` batch. Two extensions to follow-up B's plumbing:
    - **`usePollSubmit` gate drops `allYesNo`.** Was `isMultiGroup && allYesNo && !!group.pollId`; now `isMultiGroup && !!group.pollId`. Yes_no taps still stage in `pendingPollChoices` (existing follow-up A path); the wrapper Submit click additionally walks each non-yes_no question's ref to gather batch items.
    - **`QuestionBallotHandle.prepareBatchVoteItem(): { ok, item, commit, fail } | { skip } | { ok: false, error }`** is the new ref method. Inline-mirrors `handleVoteClick` validation + `submitVote` voteData/PollVoteItem build, then returns commit/fail closures that capture the per-question state at build time (`suggestionMetadata`, `effectiveIsAbstaining`, `isEditing`, `questionOptions`, voter-name, suggestion/availability timer-started flags). The wrapper invokes these closures with the returned `ApiVote` per question after the batched API call resolves — running the same post-write side effects (`markQuestionAsVoted`, `clearQuestionDraft`, `saveUserName`, `setHasVoted`/`setUserVoteId`, deferred-deadline writeback, `loadExistingSuggestions`/`fetchQuestionResults` re-fetch) that `submitVote` runs in the per-question path.
    - **Wrapper-button click flow**: snapshot `pendingPollChoices` for yes_no items + call `prepareBatchVoteItem()` on each non-yes_no QuestionBallot ref; aggregate items + commit/fail closures into `pendingPollSubmit.preparedNonYesNo`. Validation errors return `{ ok: false }` with the error already surfaced via `setVoteError` inside QuestionBallot — wrapper aborts modal opening so the user sees per-section feedback. On `stagedCount === 0`, no-op. Otherwise opens the same wrapper ConfirmationModal that all-yes_no uses; on confirm, `confirmPollSubmit(pollId, subQuestions, preparedNonYesNo)` builds the items array, calls `apiSubmitPollVotes`, and dispatches each prepared question's `commit(returnedVote)` (or `fail(error)` on rejection).
    - **Submit button enable gating**: `hasStagedChange = hasYesNoStaged || hasNonYesNoReady`. Second half = `group.subQuestions.some(sp => sp.question_type !== 'yes_no' && wrapperSubmitState.get(sp.id)?.visible === true)` — re-uses the existing `onWrapperSubmitStateChange` plumbing introduced in the 1-question case. QuestionBallot's `wrapperShouldShowSubmit` already returns true for any non-yes_no question with `wrapperHandlesSubmit && !isQuestionClosed && (!hasVoted || isEditingVote || isEditingRanking)`.
    - **`wrapperOwnsSubmit` gates `wrapperHandlesSubmit`** for non-yes_no questions in multi-groups: `wrapperOwnsSubmit = !!group.pollId && (useWrapperSubmit || (usePollSubmit && !isYesNo))`. Yes_no questions in multi-groups still render externally via `QuestionResultsDisplay` (Phase 3.3) and do NOT receive `wrapperHandlesSubmit=true` — they don't need to since they don't render an inline Submit anyway.
    - **Pitfall: Playwright `.click()` can misfire on the wrapper Submit button** when the bottom bubble bar (What/When/Where) is in the layout — actionability checks pass but the click silently no-ops. Use `page.evaluate(() => button.click())` to dispatch a native click for headless tests; user-facing clicks in real browsers work because the user can see and target the exact pixel.
    - **`apiSubmitVote`/`apiEditVote` callsites now reachable in production exactly never** outside of participation questions (which keep `poll_id IS NULL`). The legacy branches stay as fallbacks for the `poll_id == null` case but every yes_no/ranked_choice/time/suggestion vote routes through `apiSubmitPollVotes`.
  - **Still out of scope (deferred to Phase 5 cleanup)**: removing the per-question `apiSubmitVote`/`apiEditVote` legacy fallbacks entirely. They remain as participation-question path + a safety net for any pre-Phase-4 unbackfilled question. All-yes_no multi-groups already use wrapper Submit (follow-up A). Participation questions keep their per-question Submit (poll_id is null forever). 1-question yes_no polls already used wrapper Submit via the external `QuestionResultsDisplay` tap-to-change → `confirmVoteChange` flow.
  - **Pitfall: `useImperativeHandle` deps changing on every render.** `handleVoteClick` is recreated each render (closes over many state vars). Putting it in the deps of `useImperativeHandle` would re-create the handle every render. Pattern: `const handleVoteClickRef = useRef(handleVoteClick); handleVoteClickRef.current = handleVoteClick;` then `useImperativeHandle(ref, () => ({ triggerSubmit: () => handleVoteClickRef.current() }), []);`. Same idea applies any time you want a stable imperative handle that calls the latest closure.
  - **Pitfall: voter-name initial-load `setVoterName(getUserName())` would call the wrapper's setter from inside the child.** The first-mount effect that seeds `voterName` from `getUserName()` skips when `wrapperHandlesSubmit` is true. The wrapper seeds its own `pollVoterNames` map from `getUserName()` instead, so the source-of-truth for the initial value lives in one place.
- **Phase 3.3 (non-anchor yes_no external rendering)** — Every yes_no question in a multi-group now uses the thread-page's external Yes/No card (full results + tap-to-change → confirmation flow), not just the anchor. Implementation: the standalone external Yes/No block at the top of the card (gated on `question.question_type === 'yes_no' && isExpanded`) was REMOVED. The external card is now rendered INSIDE the per-question loop (`group.subQuestions.map`), immediately above each yes_no question's `QuestionBallot`. `useExternalYesNo` simplifies to `sp.question_type === 'yes_no'` (no anchor-only carve-out). Each external card reads `questionResultsMap.get(sp.id)` + `userVoteMap.get(sp.id)` and dispatches `setPendingVoteChange({ questionId: sp.id, newChoice })` so non-anchor questions go through the same confirmation modal + `apiEditVote` / `apiSubmitVote` flow as the anchor. QuestionBallot still mounts for yes_no questions but its yes_no branch returns null (`externalYesNoResults={true}`), preserving its data-fetching effects. The `allYesNo` margin guard relaxes from `allYesNo && !isMultiGroup ? '' : 'mt-1.5'` to `allYesNo ? '' : 'mt-1.5'` since multi-group all-yes_no cards now have their own `mt-2` per external block. Mixed groups (yes_no + ranked_choice + ...) preserve the user-defined `question_index` order because the external card is inline with its question, not lifted to the top of the card.
- **Phase 3.2 follow-up (stacked compact pills)** — The footer-row pill slot in `app/thread/[threadId]/page.tsx` previously rendered only the anchor question's preview, leaving secondary winners invisible (e.g. a Yes/No+Restaurant card showed the Yes/No tally but hid the restaurant winner). The IIFE now extracts a `pillForQuestion(sp)` helper that returns the type-specific pill JSX (or null) for any question. Single-question groups: unchanged — yes_no still bypasses `CompactPreviewClip` (the pill is omitted when expanded because the full Yes/No cards take over below), other types still wrap in the clip. Multi-question groups: one pill per question, stacked vertically (`flex flex-col items-end gap-1`) inside a single `CompactPreviewClip` so the whole column animates to 0 in lockstep with the heavy expand clip. Sub-questions with no data yet (no votes / no suggestions) drop their row so the column stays compact. Pattern to extend: when adding a new question-supported type, add a branch to `pillForQuestion(sp)` — both the single-question and multi-question callsites pick it up automatically.
- **Phase 3.1 (poll-level operations)** — `POST /api/polls/{id}/{close,reopen,cutoff-suggestions,cutoff-availability}` close/reopen/cutoff the wrapper + every question atomically (single transaction). `close` re-runs `_finalize_suggestion_options` for any ranked_choice question mid-suggestion-phase (mirrors the per-question flow). `cutoff-suggestions` advances every question in a suggestion phase that has at least one suggestion vote, returning 400 only if NO question advanced. `cutoff-availability` targets the (≤1 enforced on create) time question. All four authorize on `polls.creator_secret`. FE: `apiClosePoll` / `apiReopenPoll` / `apiCutoffPollSuggestions` / `apiCutoffPollAvailability` in `lib/api.ts` (each invalidates + re-caches via the shared `pollOperation` helper). Thread page long-press handlers (`app/thread/[threadId]/page.tsx`) detect `action.question.poll_id` and route to the poll endpoint when set — the optimistic `setThread` updater rewrites every sibling sharing the same `poll_id` (not just `id === action.question.id`) so closing one card visually closes them all. Falls back to `apiCloseQuestion` / `apiReopenQuestion` / `apiCutoffAvailability` when `poll_id` is null (participation questions).

**Every question now has a poll wrapper.** (Migration 094 removed the participation question type that was the lone exception.)

Frontend conventions for the poll plumbing:
- The exported `QuestionType` alias in `lib/api.ts` (`'yes_no' | 'ranked_choice' | 'time'`) is the canonical "what question types can be questions". Don't re-inline this union — the `participation` exclusion is enforced server-side too, and a shared alias keeps the two layers in sync.
- The `Poll` interface in `lib/types.ts` uses `| null` for nullable fields, while the legacy `Question` interface uses `| undefined`. This divergence is intentional: `toPoll` consistently maps with `?? null` while `toQuestion` uses `?? undefined`. Don't mix the two patterns inside one mapper, and don't migrate `Question` to `null` as a side effect of poll work.
- `cachePoll(poll)` automatically calls `cacheQuestions(poll.questions)` so subsequent `apiGetQuestionById` calls for any question hit warm cache. Conversely, `invalidatePoll(id)` cascades to `invalidateQuestion(sub.id)` for every question. This is the documented behavior — don't add another path that caches a poll without going through `cachePoll`, or question cache state will go stale.
- New API endpoint families share error handling via `fetchWithBase(base, path, options)`. The `apiFetch` (questions) and `pollFetch` (polls) wrappers exist only to bind the base URL. When adding a third endpoint family, mirror the pattern instead of duplicating the error-parsing logic.
- `CreatePollRequest.follow_up_to` carries a QUESTION id, not a poll id — same shape as the legacy `apiCreateQuestion`. The frontend never has to ask "is the parent a poll?". The server resolves to the parent's poll_id (or NULL for legacy parents) inside the create transaction. If you ever need to expose the poll-level reference directly (e.g. for an admin tool), add a separate field; don't repurpose this one.
- **Phase 3.5: poll-level `follow_up_to` is the source of truth for thread chains.** `QuestionResponse` carries `poll_follow_up_to` (the wrapper's `follow_up_to`, a poll_id) populated via `LEFT JOIN polls mp ON p.poll_id = mp.id` in every server SELECT that feeds `_row_to_question` for FE consumption. Helper: `_SELECT_QUESTION_WITH_POLL_PREFIX` for SELECTs, `_attach_poll_chain_fields(conn, row)` for UPDATE/INSERT RETURNING * paths. `lib/threadUtils.ts: buildQuestionMaps` walks `Question.poll_follow_up_to` to build the parent→child poll edge map; `collectDescendants` fans out from any visited question to its siblings + the questions of the parent poll + the questions of every child poll. `findThreadRootRouteId(question, questionByPoll?)` walks the poll chain to the root — callers pass an optional `poll_id → Question` resolver (built from cached accessible questions) to avoid scanning the cache list twice per step. The legacy `questions.follow_up_to` column is still populated on writes (Phase 5 retires it) but the FE no longer reads it for chain logic.
- `questionDataToPollRequest(questionData, additionalQuestions?)` in `app/create-question/page.tsx` is the canonical mapper from the existing flat questionData into a poll request. Wrapper-level `context` carries today's `details` field; per-question `context` is reserved for the eventual disambiguation flow. The `additionalQuestions` parameter (Phase 2.4) is prepended to the questions array — staged drafts come first, the current form's question last. Add new fields to EITHER the poll-level OR question-level branch — never both — and keep participation questions on the legacy `apiCreateQuestion` path.
- **State → `CreateQuestionParams` is mapped in two places** — `questionDataToPollRequest` (current form, via the flat questionData) and `buildQuestionFromState` (staged sections, reads state directly). They MUST keep the same field shape; Phase 3 will likely consolidate these once the dual-modal flow lands. If you add a new per-question field, update both. The shared `validateRankedChoiceOptions(options, category)` module-level helper is the single source of truth for ranked-choice option validation; both `getValidationError` (full submit) and `getQuestionValidationError` (staging button) call it — don't duplicate the gap/length/uniqueness checks again. `questionDataToPollRequest`, `validateRankedChoiceOptions`, `shortenOption`/`shortenLocation`, and the deadline option arrays (`BASE_DEADLINE_OPTIONS`, `FRACTIONAL_CUTOFF_OPTIONS`, `ABSOLUTE_CUTOFF_OPTIONS`, `DEV_DEADLINE_OPTIONS`) live in `app/create-question/createQuestionHelpers.ts` — keep new pure helpers there too rather than buffering `page.tsx` with module-local noise.
- **`buildVoteData` + `buildPollVoteItem` in `components/QuestionBallot/voteDataBuilders.ts` are the single source of truth for FE vote-payload construction.** `QuestionBallot.submitVote` / `prepareBatchVoteItem` AND the thread page's `confirmVoteChange` / `buildYesNoPollItems` all route through them. When a new field lands on `PollVoteItem`, update only these helpers (and `PollVoteItem` itself in `lib/api.ts`) — the four callsites pick it up automatically. The validators emit identical error strings across the immediate-submit and batched paths, so users see the same message regardless of where they tapped Submit. `BallotInputs.questionType` is `QuestionType` (`yes_no | ranked_choice | time` from `lib/api.ts`) — don't widen with `| string`.
- **Sibling questions share a `created_at`** (they're inserted in one transaction). Sort tiebreakers must use `question_index` to preserve the creator's intended order. The `question_index` is 0 for backfilled (1-question) wrappers; multi-question polls get sequential 0..N-1. `lib/threadUtils.ts: collectDescendants` already does this — mirror the pattern in any new sort that involves questions.
- **Per-question context lives in `questions.details`** (per Phase 2.2 mapping). Poll-level context lives in `polls.context`. They are NOT the same column. When the Phase 2.4 dual-modal flow lands and exposes per-question context as a UI field, it should write to `questions.details` for each question independently. Do not conflate the two; the existing `questionDataToPollRequest` writes the same value to BOTH for 1-question polls because there's only one ambiguous "context" the user could mean.
- **Server `_row_to_question` is the only place that maps DB rows to `QuestionResponse`.** When adding a new field, update `_row_to_question` (in `server/services/questions.py`), the `QuestionResponse` Pydantic model (in `server/models.py`), the FE `Question` interface (in `lib/types.ts`), and `toQuestion` (in `lib/api.ts`). Missing any of the four results in a silent NULL on the FE. Phase 2.5 added `poll_id` + `question_index` through this exact path.
- When adding a new `/api/<family>` endpoint, also add the rewrite in `next.config.ts: nextConfig.rewrites` (three entries: bare, trailing slash, `/:path*`). Without these, FE calls 404 from Next.js itself before reaching the proxy. Phase 2.2 hit this — the create UI silently failed loading polls until the rewrites landed.
- **Poll-level mutations must rewrite every sibling in the optimistic state update.** When `action.question.poll_id` is set, the close/reopen/cutoff handlers call `apiClosePoll(pollId, ...)` etc. — that hits every question on the server. The matching `setThread` updater needs to filter on `p.poll_id === pollId`, NOT `p.id === action.question.id`, otherwise siblings stay visually open until a refresh. The legacy `p.id === action.question.id` path is kept only for the participation-question fallback (`poll_id` is null). Same logic applies to anything else that mutates question-shared state (e.g. follow-up creation, future Phase 3.2 voting endpoints).
- **Don't share `_finalize_*` helpers between routers by re-implementing them.** Both `routers/questions.py` and `routers/polls.py` import `_finalize_suggestion_options`, `_finalize_time_slots`, `_submit_vote_to_question`, `_edit_vote_on_question` etc. from `services/questions.py` — they're free functions on a connection and per-question-id, so reuse is clean. If you find yourself re-writing one of these in a router, that's a sign the helper is mis-scoped (extract it to `services/` or `algorithms/` instead). `_submit_vote_to_question(conn, question_id, req, now)` / `_edit_vote_on_question(conn, question_id, vote_id, req, now)` were extracted from `submit_vote` / `edit_vote` for the Phase 3.4 unified vote endpoint and are re-used directly inside the poll batch transaction. Both helpers raise `HTTPException` on validation failure (rolling back the entire batch); they don't open their own DB connection so the caller controls the transaction scope.

  > **Note (post-migration 094):** `_resolve_question_winner` was deleted along with the participation question type — it only made sense for the location/time question resolution flow. The pattern still applies to `_finalize_suggestion_options` / `_finalize_time_slots`.
- **Poll endpoint tests need `DISABLE_RATE_LIMIT=1` and ideally a per-test DB.** The existing `test_polls_api.py` defaults `DATABASE_URL` to `postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants` which on the dev droplet is the prod-shaped DB; the migration 093 backfill of real questions' short_ids into polls leaves the polls sequential_id sequence un-aware of the backfilled rows, so when tests advance the sequence they eventually collide on `polls_short_id_key`. Run tests against `dev_sam_at_samcarey_com` (smaller dataset, no collisions in practice) with rate limit off: `DATABASE_URL='...dev_sam...' DISABLE_RATE_LIMIT=1 uv run pytest tests/test_polls_api.py`. The sequence-collision is a pre-existing migration bug (out of scope here); a future cleanup should bump the sequence past the highest backfilled `encode_base62_inverse(short_id)` after Pass 1.
- **`dev_sam_at_samcarey_com` lacks the `questions.short_id` INSERT trigger.** Migration 093 self-heals the `questions.short_id` and `questions.sequential_id` columns on dev DBs but doesn't recreate the `trigger_generate_short_id` BEFORE-INSERT trigger that prod has. Result: legacy `POST /api/questions` tests (`tests/test_questions_api.py::TestCreateQuestion`, `TestGetQuestion::test_get_question_by_short_id`) fail on dev_sam with `short_id IS NULL` in the response. They pass against the prod-shape `whoeverwants` DB. If you need the legacy create endpoint to work on dev_sam, add the trigger via a one-shot psql command (don't bake it into a migration — prod already has it).
- **Surfacing a poll-level field on every `Question` response means updating *every* questions SELECT that feeds `_row_to_question`.** Phase 3.5 added `poll_follow_up_to` (the wrapper's chain pointer). The pattern: a `_SELECT_QUESTION_WITH_POLL_PREFIX` helper that does `SELECT p.*, mp.follow_up_to AS poll_follow_up_to FROM questions p LEFT JOIN polls mp ON p.poll_id = mp.id` (callers append `WHERE p.<column> = ...`), plus an `_attach_poll_chain_fields(conn, row)` helper for `RETURNING *` paths (UPDATE/INSERT) that does a separate lookup. `_row_to_question` reads `row.get("poll_follow_up_to")` and gracefully returns None when the field is absent — so SELECTs that don't go through the prefix simply produce a None field on the FE rather than an error. The legacy `POST /api/questions` create path skips `_attach_poll_chain_fields` entirely because it always inserts `poll_id IS NULL`. When adding a similar wrapper-level field in the future (Phase 5 will add more), follow this pattern and don't forget the `PollResponse` questions list — `_row_to_poll` enriches each question row inline since it already has the wrapper's value in scope (no extra DB lookup).
- **Don't reinvent the `poll_id → Question` Map lookup.** `lib/threadUtils.ts` exports `buildQuestionByPollMap(questions)` — every callsite that needs to resolve a question for a poll_id (e.g. for `findThreadRootRouteId`'s chain walk) should use it, prepending the current question if it isn't yet in the cached accessible list (`buildQuestionByPollMap([question, ...accessible])`). The first occurrence per poll wins, so the prepend ensures the live question wins over a stale cache entry. Earlier Phase 3.5 code had this pattern duplicated inline in three places; consolidate any new callsite onto the helper.

This section captures the design decisions from the original conversation so future sessions can reference them without re-asking.

### Core paradigm

- **Every question is a poll** containing one or more questions. Existing single questions migrate to 1-question polls (destructive DB migration). A 1-question poll renders the same as today's question — the wrapper is invisible in the UI for that case.
- **Participation questions were removed in migration 094.** Older "Phase X" notes below mention them as a separate codepath; that's stale — every question now has a poll wrapper.

### Entities

- **Poll**: top-level entity. Owns: optional context, voting cutoff, optional shared suggestion/availability cutoff, `follow_up_to`, `is_closed`, `close_reason`, `creator_secret`, `short_id`. Target of `/p/<shortId>/` and `/thread/<id>/`.
- **Sub-question**: a category-specific ballot section inside a poll. Owns: category, options, optional context, `question_type` (`yes_no`, `ranked_choice`, `suggestion`, `time`). Does NOT own: deadline, `is_closed`, `creator_secret` — all inherited from the parent poll.

### Cutoffs and phases

- A poll has ONE voting cutoff and AT MOST ONE shared suggestion/availability cutoff.
- A question has a "prephase" (suggestion or availability collection) only if its category supports one — `yes_no` does not. When in prephase, the question uses the poll's shared prephase cutoff.
- "In prephase" is a poll-level state, not a question-level state. All questions open for voting at the same moment — once the shared prephase cutoff has passed (if any), every ballot opens together.
- Cutoff actions (cutoff suggestions, end availability phase) operate at the poll level. The two cutoff buttons in the long-press modal merge into one shared "End Pre-Phase" action.
- Close, Reopen, Forget all operate at the poll level. Long-press on the thread card opens the modal for the whole poll, not a single question.

### Creation flow

- Three "bubble" buttons replace the single "+" FAB on home and thread pages: **What**, **When**, **Where**, equally spaced along the bottom.
- Tapping any of them opens TWO modals simultaneously:
  - **Bottom modal**: shared poll fields (optional context, voting cutoff, shared prephase cutoff). Slides up only far enough to show its content, no further.
  - **Top modal**: category + options for one question, plus optional per-question context. Has a checkmark in its top-right corner.
- **What**: category dropdown shows all categories EXCEPT location, restaurant, time. Includes `yes/no` as a category (categories that map to a `yes_no` `question_type` question). Plus arbitrary built-ins (Movie, Video Game, Pet Name, etc.) and custom-text.
- **When**: hides the category field entirely (category is implicitly "time"); shows duration + time windows + min availability.
- **Where**: category dropdown shows location and restaurant categories plus custom; includes the reference-location field.
- Pressing the top modal's checkmark commits the question into a "draft slot" in the poll-in-progress (compact display in the question list area, just above the bottom form). The What/When/Where buttons reappear above the bottom form. User can add more questions.
- Multiple questions of any kind allowed (e.g., two Wheres) but each must have a distinct context to disambiguate.
- Pressing Submit on the bottom form creates all questions as one poll.
- Backdrop / X tap closes the sheet but PRESERVES both top- and bottom-form state (reopening returns to the same state).
- Drafts persist in `localStorage` (survives browser close). Per-tab/per-device only — no server-backed draft sync.

### Title generation

- The poll has NO title field — only optional context.
- Title is auto-generated from question categories + poll context, in title case (e.g., "Restaurant and Time for Party"). Algorithm TBD during implementation; the user said "figure something out".

### Per-question context

- Each question has its own optional context field, surfaced in the top modal AND in the compact draft-slot display AND as a per-question label on the voting card.
- Required when there are multiple questions of the same kind (Where + Where), to disambiguate.

### Voting

- Single Submit button at the bottom of the unified card commits a vote across all questions.
- Each question section has its own per-question abstain control. Voters can abstain on individual questions while voting on others.
- Voting opens on every question simultaneously after the poll's shared prephase (if any) has ended.

### Follow-up / threads

- `follow_up_to` lives at the poll level (Phase 3.5: also the FE source of truth for thread chain walking). Threads = chains of polls. Forks were removed in migration 095.
- On thread pages, the What/When/Where buttons auto-set `follow_up_to` to the latest poll in the thread (same as today's FAB behavior reads `data-thread-latest-question-id`).

### URLs

- Routes stay the same: `/p/<shortId>/` and `/thread/<id>/`. The `shortId` now belongs to the poll, not a single question.
- Single-question polls render identically to today's questions — the poll wrapper is invisible.

### Migration

- One destructive migration wraps every existing non-participation question in a 1-question poll row.
- `follow_up_to` is rewritten to point poll → poll.
- Participation questions are NOT touched by this migration; they continue to function on their existing standalone codepath.

---

## iOS App (Capacitor)

The iOS app is a Capacitor 8 WebView shell that loads the hosted Next.js app
remotely (`capacitor.config.ts → server.url`). Web code is NOT bundled — every
Vercel/dev-server deploy is instantly visible on device. Native plugins
(`@capacitor/haptics`, contacts, etc.) still work because Capacitor injects its
bridge into the remote WebView.

### Architecture

- `capacitor.config.ts` resolves `server.url` at build time:
  1. `CAP_SERVER_URL=<url>` — explicit override. Workflow sets this per-developer.
  2. Otherwise → `https://whoeverwants.com` (prod default).
- Bundle ID at build time: prod = `com.whoeverwants.app`; dev = `com.whoeverwants.app.dev.<github-username>`. Each developer registers their own dev bundle ID + App Store Connect record so they can install their own dev build alongside prod without collision.
- Distribution: TestFlight only (no USB cable ever after initial setup). Paid Apple Developer account required.

### Build pipeline

A GitHub Actions workflow (`.github/workflows/ios-build.yml`) runs on a
self-hosted Mac mini runner (labels: `self-hosted, macos-mini`). The workflow:

1. Resolves `CAP_SERVER_URL` from the pusher's email (`<slug>.dev.whoeverwants.com`) or uses the prod default when `CAP_ENV=prod`.
2. Computes bundle ID + display name based on `CAP_ENV` and `github.actor`.
3. Patches `ios/App/App.xcodeproj/project.pbxproj` with the bundle ID (automatic signing ignores the xcodebuild command-line override). Fails loudly if the sed doesn't match the expected occurrence count.
4. Runs `npm ci` → `npx cap sync ios` → archives with `xcodebuild` → exports signed `.ipa` → uploads with `xcrun altool`. All signing uses App Store Connect API key auth (`-allowProvisioningUpdates -authenticationKey*`) — no Xcode GUI login needed.
5. On first run only: auto-scaffolds `ios/` via `npx cap add ios` and commits it back to the branch.

Triggers:
- Pushes to `main`, `claude/capacitor-**`, or `ios/**` that touch `capacitor.config.ts`, `ios/**`, `package.json`, `package-lock.json`, the workflow file, or `scripts/ios/**`.
- Manual via `workflow_dispatch` — inputs: `cap_env` (dev|prod), `cap_server_url` (explicit URL override), `skip_upload` (bool).

### Helper scripts

- `scripts/ios/build.sh [--env dev|prod] [--skip-upload] [--ref <branch>]` — dispatches a workflow run and questions until completion. Requires a `GITHUB_API_TOKEN` with `actions:write`. On failure, calls `logs.sh --failed-only` automatically.
- `scripts/ios/logs.sh [<run_id>] [--failed-only]` — fetches and prints CI logs. `--failed-only` hits the per-job logs endpoint (much smaller than the full-run zip).
- `scripts/ios/mac-bootstrap.sh <runner_token>` — one-time Mac mini setup (Homebrew, Node, Xcode CLI tools, `xcodebuild -downloadPlatform iOS`, GitHub Actions runner as LaunchAgent).

### Feedback-loop cheat sheet

| Change | Delay | Mechanism |
|---|---|---|
| Web code | ~30 s | Vercel (prod) or dev server (dev); pull-to-refresh on device |
| Native plugin / config | 8–20 min | Runner → TestFlight → tap "Update" in TestFlight app |

### Required GitHub repo secrets

- `APP_STORE_CONNECT_API_KEY_ID` — Key ID from App Store Connect
- `APP_STORE_CONNECT_API_KEY_ISSUER_ID` — Issuer UUID
- `APP_STORE_CONNECT_API_KEY_P8` — base64 of the `.p8` file (single-line paste is less brittle via mobile browser than multi-line PEM)
- `APPLE_TEAM_ID` — 10-char team ID
- `CI_KEYCHAIN_PASSWORD` — password for the dedicated `ci.keychain-db` on the Mac mini

See `docs/ios-setup.md` for the full one-time setup walkthrough.

### Pitfalls learned the hard way

- **API key needs cert-management scope.** The "App Manager" role alone triggers `Cloud signing permission error` + `No signing certificate "iOS Distribution" found` during export. Regenerate the key with **Admin** role (or explicitly enable "Access to Certificates, Identifiers and Profiles"). Apple added this as a separate permission in 2024.
- **Automatic signing ignores command-line `PRODUCT_BUNDLE_IDENTIFIER` overrides.** xcodebuild honors the override for the archive's Info.plist, but the signing phase looks up the profile using the bundle ID baked into `project.pbxproj`. Result: a dev-URL build uploaded under the prod bundle ID. Fix: `sed`-patch `project.pbxproj` before archive and verify the expected number of replacements occurred.
- **Capacitor 8 uses Swift Package Manager, not CocoaPods.** No `Podfile` or `.xcworkspace` — there's only `App.xcodeproj`. Don't run `pod install`. Use `-project` (not `-workspace`) with xcodebuild.
- **`xcodebuild` needs a shared scheme.** Capacitor's scaffold doesn't create one; Xcode would on first GUI open, but CI never opens Xcode. Commit `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` to the repo so headless builds find the scheme.
- **Xcode 15+ ships with no platform SDKs.** Run `xcodebuild -downloadPlatform iOS` once on the Mac mini (the bootstrap script does this). Otherwise archives fail with `iOS N.N is not installed`.
- **Self-hosted runner starts from a LaunchAgent.** LaunchAgents don't source `~/.zprofile`, so Homebrew's PATH must be injected explicitly (`echo /opt/homebrew/bin >> "$GITHUB_PATH"` as the first workflow step). Same applies to any brew-installed CLI.
- **LaunchAgent can't access the login keychain reliably over SSH.** Create a dedicated `ci.keychain-db` with a known password (stored as `CI_KEYCHAIN_PASSWORD` secret). The workflow unlocks it at the start of each run. `security set-keychain-settings` fails with "User interaction is not allowed" from SSH sessions — run it in the workflow instead (or tolerate the failure; 5-min default timeout is enough for a single build).
- **Mobile Safari corrupts multi-line PEM pastes into GitHub Secrets.** The line wrapping mangles the base64 body, which xcodebuild then rejects with `CryptoKit.CryptoKitASN1Error.invalidPEMDocument`. Paste a single-line base64 string instead (the workflow decodes either form).
- **`altool` exits 0 even when it rejects the upload.** Diagnose by grepping the output for `UPLOAD FAILED`; don't trust the exit code alone.
- **`fetch-depth: 0` is required for monotonic `CFBundleVersion`.** Default shallow fetch pins `git rev-list --count HEAD` at 1, which TestFlight rejects on the second upload to the same bundle ID as a duplicate.
- **`ITSAppUsesNonExemptEncryption=false`** in `Info.plist` skips the TestFlight export-compliance prompt. WhoeverWants only uses standard HTTPS (exempt category).
- **App icon must be 1024×1024 opaque PNG** in `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`. Alpha channels cause `Missing required icon file` rejection. `.gitignore` excludes `*.png` except under `public/` and the AppIcon asset catalog — preserve both overrides.
- **`CFBundleVersion` monotonicity**: the workflow uses `git rev-list --count HEAD`. Never rewrite history in a way that lowers this count, or TestFlight will reject future uploads.
- **First build auto-scaffolds + commits `ios/`.** Subsequent pulls should include `ios/`. Don't manually `rm -rf ios/` without also rerunning the scaffold flow.
- **`server.url` + App Store review**: App Store review sometimes objects to pure remote-URL apps. Phase 2 switches to bundled assets (requires static export — non-trivial with Next.js 16 App Router + `force-dynamic` + `next.config.ts` rewrites). Fine for TestFlight / sideload.

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
const openQuestions = questions.filter(question =>
  new Date(question.response_deadline) > now
);
```

**Fix:** Move date logic to `useEffect`
```typescript
// GOOD - avoids hydration issues
const [openQuestions, setOpenQuestions] = useState<Question[]>([]);

useEffect(() => {
  if (typeof window === 'undefined') return;
  const now = new Date();
  const open = questions.filter(question =>
    new Date(question.response_deadline) > now
  );
  setOpenQuestions(open);
}, [questions]);
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

# Verify migration applied — query by FILENAME, not by `_migrations.id`
bash scripts/remote.sh "docker exec whoeverwants-db-1 psql -U whoeverwants -c \"SELECT id, filename FROM _migrations WHERE filename LIKE '065_%'\""
```

- **`_migrations.id` is a serial row counter, not the migration number.** `SELECT id FROM _migrations` returns sequence values like `1, 2, ..., 104` that have nothing to do with the `NNN_` prefix on the filename. Querying for "is migration 092 applied?" by `WHERE id = 92` is wrong (and will silently mislead — there *is* always an `id=92` once enough migrations have run). Always check `filename LIKE 'NNN_%'`. The only correct use of `_migrations.id` is `ORDER BY id DESC` to see recently-applied filenames.

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
**PostgreSQL only reports the FIRST failing constraint.** After fixing one constraint, ALWAYS test again immediately - another constraint may be blocking. The suggestion voting fix required fixing TWO separate constraints that were hiding behind each other.

### Quick Debug Commands:
```bash
# Check API logs on droplet
bash scripts/remote.sh "docker compose logs --tail 100" /root/whoeverwants

# List all check constraints on a table
bash scripts/remote.sh "docker exec whoeverwants-db-1 psql -U whoeverwants -c \"SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'votes'::regclass AND contype = 'c';\""
```

**Time-saving tip**: Don't guess at the problem. Add logging, get the exact error, then fix the specific constraint.

### Migration Constraint Naming

- **Use consistent constraint names across migrations.** If migration 043 creates `vote_type_check` and migration 048 drops/recreates `votes_vote_type_check` (different name!), both constraints coexist. New migrations that only update one name leave the other stale. Always `DROP CONSTRAINT IF EXISTS` for ALL known aliases before creating the updated constraint.
- **When adding new enum values to CHECK constraints**, search all migrations for every constraint on that column (names may vary) and drop all of them before adding the new one. Use `SELECT conname FROM pg_constraint WHERE conrelid = 'table'::regclass` to audit.

### Deferred Suggestion Deadline

- **Suggestion deadlines are deferred until the first suggestion is submitted.** Question creation stores `suggestion_deadline_minutes` (the duration) and sets `suggestion_deadline` to NULL. When the first vote with suggestions arrives, the backend sets `suggestion_deadline = now + minutes`. This prevents empty cutoffs where the deadline expires before anyone suggests anything.
- **Custom deadlines bypass deferral.** When the creator picks "Custom" and sets an absolute date/time, `suggestion_deadline` is sent directly (not deferred). Only preset durations use `suggestion_deadline_minutes`.
- **`hasSuggestionPhase` checks both fields**: `!!(question.suggestion_deadline || question.suggestion_deadline_minutes)`. A question is "in suggestion phase" when the timer hasn't started yet OR when the deadline hasn't passed.
- **Frontend starts the timer optimistically** after the first suggestion vote succeeds: `setSuggestionDeadlineOverride(new Date(Date.now() + minutes * 60000).toISOString())`. This avoids waiting for a page refresh to show the countdown.
- **`hasCompletedRanking`** (computed in QuestionBallot) distinguishes "voted with suggestions only" from "voted with rankings". Used to gate preliminary results display and the ranking summary view — prevents showing results before the user has ranked.
- **`is_abstain` vs `is_ranking_abstain`**: The `votes` table has two abstain columns. `is_abstain` means "fully abstained" (no suggestions, no rankings) or, in non-suggestion questions, "abstained from voting." `is_ranking_abstain` means "abstained from ranking specifically but has suggestions." In suggestion-phase questions, `is_abstain=true` does NOT mean ranking abstain — don't restore `isAbstaining` state or show "Ranking: Abstained" based on `is_abstain` during the suggestion phase. Use `userAbstainedFromRanking` (computed in QuestionBallot) for display checks.
- **Auto-finalization in `get_question`**: When `suggestion_deadline` has passed but `options` is still NULL, the endpoint auto-calls `_finalize_suggestion_options()`. This handles the case where the deadline expires naturally without a manual cutoff.
- **Manual cutoff requires suggestions**: The `cutoff-suggestions` endpoint rejects requests (400) when no suggestions have been submitted, enforced via an EXISTS subquery in the UPDATE.
- **New options detection uses localStorage**: `storeSeenQuestionOptions(questionId, options)` in `browserQuestionAccess.ts` stores the option set at vote time. On next load, `getSeenQuestionOptions` retrieves it and `newOptions` useMemo computes the diff. Excludes the user's own suggestions (they already know about those) and only fires for users who have already ranked. Cross-device limitation: no baseline on a new device, so no banner — acceptable given the app's localStorage-first model.
- **`ClientOnly` wrapper breaks flex row layout** even with `fallback={null}`. `ClientOnly` renders a block-level `<div>` during SSR/initial render which disrupts flex containers. For content guarded by React state that starts empty and populates in `useEffect` (like `questionsWithNewOptions`), skip `ClientOnly` entirely — the empty initial state IS the SSR-safe behavior. Only use `ClientOnly` for content that would cause a hydration mismatch if rendered during SSR.

### Document Scroll Architecture

- **The document (body/html) is the scroller.** `body` has no `overflow: hidden`; top/bottom bars are `position: fixed` and overlay the scrolling content. The previous "fixed viewport + inner `.safari-scroll-container`" layout was removed — don't reintroduce inner `overflow-auto` wrappers for page content. Modal sheets and autocomplete dropdowns may have their own internal scroll, but page chrome must not.
- **Pull-to-refresh is the browser's native behavior.** We no longer ship a custom touch-driven PTR implementation — an earlier version caused visible oscillation when approaching the top of the page (body-transform fighting momentum-scroll). The browser's native PTR gesture (Chrome mobile, Safari mobile) handles refresh. Consequence: `overscroll-behavior` is NOT set to `none` on html/body — leaving it at the default enables native PTR and the iOS rubber-band bounce, which is fine.
- **Never use UA sniffing (`/iPad|iPhone|iPod/`) to detect iOS.** Since iOS 26, Apple froze the OS version in the UA string. Worse, modern iPhones (17+) and iPads report `Macintosh; Intel Mac OS X 10_15_7` — identical to desktop Safari. In PWA standalone mode, "Safari" and "Mobile" tokens are also stripped, making the UA completely indistinguishable from a Mac. Use `navigator.standalone` (WebKit-only property): `undefined` = not Apple, `false` = Safari browser, `true` = standalone PWA.
- **NEVER use `e.preventDefault()` in touchmove on a scrollable element.** On iOS, calling `preventDefault()` on even a 1px touchmove causes the browser to classify the entire gesture as non-scrollable, permanently blocking scroll for that touch sequence. Any touch listeners on scrollable elements must be `{ passive: true }`.
- **`transform: scale(1)` is NOT a no-op on iOS.** Any CSS `transform` (even identity) creates a containing block that can break momentum scrolling in child `overflow: auto` elements. The `responsive-scaling-container` omits `transform` on mobile — desktop media queries apply the actual scaling transforms.
- **Modal body-lock uses `position: fixed; top: -scrollY`** to freeze scroll without `overflow: hidden` (which doesn't reliably block iOS native PTR). The create-question modal in `template.tsx` saves `window.scrollY` on open and restores it with `window.scrollTo(0, scrollY)` on close.
- **Don't use `env(safe-area-inset-bottom)` in layout-affecting properties that feed `scrollHeight`.** On iOS Safari browser mode the value is dynamic — `0` when the URL bar is visible (it occludes the home-indicator area), `~34px` when the URL bar hides. If a page's `padding-bottom` uses `calc(X + env(safe-area-inset-bottom))`, the document height animates in lockstep with the URL bar, making `max-scrollable` a moving target and producing a visible scrollY clamp during momentum near the bottom edge. Use a static value for content padding; reserve `env(safe-area-inset-bottom)` for the positioning of truly fixed elements (e.g., the floating "+" FAB) where it doesn't affect flow. The home-page padding is `6rem` flat for this reason.
- **Per-second `setState` in a countdown component causes Firefox iOS scroll jitter at scroll edges.** When ~15+ countdown spans each re-render every second via `setTimeLeft(...)`, Firefox iOS momentum scrolling near the top edge compensates scrollY by +200-230px in a single frame (a single-frame snap, not a smooth bounce). The React reconciliation pass triggered by the setState — even if the DOM diff is just a text-node swap — trips a layout event that FxiOS treats as reason to adjust `scrollY`. Fix: update countdown text imperatively via a ref (`span.textContent = ...` inside `setInterval`) so React never re-renders. Both `components/ThreadList.tsx` and the inner `SimpleCountdown` in `app/thread/[threadId]/page.tsx` use this pattern. Safari iOS doesn't exhibit the bug, but the ref-based approach is also more efficient.
- **Diagnosing weird scroll behavior: instrument scrollY with a client-log tracer.** When user-reported "jitter" doesn't reproduce in Playwright (chromium + touch simulation can't replicate iOS momentum + URL-bar physics), add a temporary `window.addEventListener('scroll', () => console.log(...))` that records `scrollY`, `scrollHeight`, and `innerHeight` with timestamps via the existing client log forwarder. The user reproduces the issue once on their real device; the buffer captures the per-frame numbers. Finding a single-frame `dy > 100` with stable `scrollHeight`/`innerHeight` → something's programmatically adjusting scrollY (anchoring, max-clamp, browser compensation). `dy` tracking scrollHeight/innerHeight changes → layout-driven. This is how both the iOS Safari URL-bar bug and the FxiOS countdown-setState bug were nailed down — without the tracer, both looked identical visually.

### Constrained Time Wheel Pickers (Voter Response)

- **Voter time ranges must be strict subsets of the question creator's window.** For non-cross-midnight question windows (e.g., 9AM–5PM), enforce `voter_min < voter_max` — never allow cross-midnight voter ranges. For cross-midnight question windows, only exclude exact equality (`min !== max`, which would be 24h). The `isValidVsSibling()` function in `TimeCounterInput.tsx` implements this.
- **Filter wheel items, don't clamp after the fact.** Clamping after scroll causes visible snap-back. Instead, compute the valid hour/minute sets upfront so invalid values are never shown.
- **Each picker must know the other picker's value** (`siblingValue` prop) to dynamically filter its options. The min picker shows only times strictly less than the current max, and vice versa. Hours with no valid minutes are hidden entirely.
- **The AM/PM wheel in constrained mode is non-interactive** — wrapped in `pointerEvents: 'none'`, it auto-follows the selected hour via `selectedIndex`. This keeps hours in chronological order across AM/PM boundaries.
- **When an hour change invalidates the current minute**, auto-select the minute giving the smallest positive duration to/from the sibling (≈1 increment gap). This avoids jarring jumps to arbitrary times.

### Cross-Midnight Time Windows

- **Time windows where `max <= min` represent cross-midnight ranges** (e.g., 10 PM–2 AM). Equal start/end means a full 24-hour window. Use `<=` consistently in all cross-midnight detection — `<` misses the equal-times-as-24h case.
- **String comparison works for HH:MM cross-midnight detection** only because the format is always zero-padded. `"02:00" < "22:00"` is correct lexicographically. If the format ever loses zero-padding (e.g., `"2:00"`), all comparisons silently break.
- **`_window_effective_end()` in `time_slots.py`** is the canonical backend helper — it adds 1440 minutes when `w_end <= w_start`. The frontend has no shared utility yet; cross-midnight checks are inline in `DayTimeWindowsInput` and `TimeGridModal`.
- **Looping scroll wheels must scroll to the nearest occurrence** of the target index, not the center repetition. Otherwise wraparound (12→1) causes the wheel to scroll the long way around through all values.
- **ScrollWheel's `suppressScrollHandler` flag can get permanently stuck.** `recenterLoop()` sets the flag and schedules an rAF to clear it, but `correctPosition()` runs synchronously right after and bails out because the flag is still set. If a touch interaction then overwrites `scrollTimeout`, the clearing rAF/timeout is lost and the flag stays true forever — silencing all `onChange` calls. Fix: defer `correctPosition` via rAF when suppression is active, and add a safety timeout (500ms) that guarantees the flag gets cleared.
- **Use refs (not render-scope variables) for state that multiple scroll events may read/write within a single React render cycle.** `handleHourChange` in `TimeCounterInput` captured `periodIndex` from the render scope. When two scroll events crossed the AM/PM boundary before React re-rendered, the second event used the stale value and emitted the wrong time. Track such state in a `useRef` and update it immediately in the handler.

### Time Question Type

- **Two-phase flow**: availability phase (voters submit `voter_day_time_windows`) → preferences phase (voters submit `liked_slots`/`disliked_slots` after cutoff).
- **Slot finalization at cutoff**: `_finalize_time_slots()` runs at availability cutoff, applies `filter_slots_by_min_availability()` (keeps slots whose count ≥ `max_slot_availability * min_availability_percent/100`), deduplicates via `_keep_longest_per_start_time()`, and writes the filtered slot list to `question.options`. Everything downstream uses `question.options` directly — no re-filtering at results time.
- **`min_availability_percent` is relative to the most-available slot, not total respondents.** A value of 95 means "slots within 5% of the best slot's count pass". Basing this on the top slot (not total voter count) keeps the question robust when lots of voters mark themselves unavailable — the filter still picks the best-attended times. Migration 090 renamed the old `availability_threshold` column and inverted its values (new = 100 − old) so existing questions preserve the same effective filter.
- **Preference-phase bubbles must be filtered per-voter by their availability.** A voter who said they can't attend a slot in the availability phase should not see (or be able to react to) that slot in the preferences phase. `preferenceSlotsForVoter` in `QuestionBallot.tsx` runs `isVoterAvailableForSlot()` (from `lib/timeUtils.ts`) against the loaded `userVoteData.voter_day_time_windows` and passes the filtered list to `TimeSlotBubbles`. Voters who never submitted availability see every finalized slot.
- **`null` vs `[]` semantics for liked/disliked slots**: `null` = voter hasn't submitted preferences yet; `[]` = submitted with all bubbles neutral. The frontend uses this distinction to show an implicit edit prompt (hasNotReactedYet).
- **Winner algorithm**: fewest dislikes → most likes → earliest slot key (chronological tiebreak). Implemented in `_pick_winner_from_reactions()` in `server/algorithms/time_question.py`.
- **Category "Time" in create form**: selecting it from the category dropdown keeps the standard form and injects `ParticipationConditions` + threshold slider + availability cutoff in place of options. Uses a single `{(questionType === 'time' || (questionType === 'question' && category === 'time'))}` condition — do NOT add a separate duplicate block for each case.
- **`formatDayLabel(dateStr)`** is the canonical day-label formatter in `lib/timeUtils.ts`. Use it in all time-related components instead of local copies.
- **Shared time-slot helpers** in `lib/timeUtils.ts`: `parseSlotStart`, `parseSlotDate`, `groupSlotsByDay`, `getBubbleLabel` (predecessor-aware compact label like "1 PM" / "2" / ":15"), `formatStackedDayLabel` (stacked weekday / month+day for the bubble grid row label), and `formatTimeSlot` (full "Mon, Apr 28 • 10:00 AM – 10:30 AM (30m)" label). `TimeSlotBubbles.tsx` (voting ballot) and `QuestionResults.tsx` (results view) both use these — never re-implement slot formatting locally.
- **Slot keys `"YYYY-MM-DD HH:MM-HH:MM"` arrive from the backend already in chronological order.** Consumers that just group by day (`groupSlotsByDay`) do NOT need to re-sort the list first; the old list view only sorted because it reordered by dislikes/likes.
- **Cap-height text centering for bubble labels**: time-slot bubble labels are pure cap-height text (digits, uppercase letters, colons — no descenders like g/j/y). `flex items-center` on a `leading-none` line box positions the **line box** at the bubble center, but the visible glyphs sit in the UPPER half of that line box because the space below the baseline is reserved for descenders that never appear — so the text looks "too high". Fix: use the modern CSS properties `text-box-trim: trim-both` + `text-box-edge: cap alphabetic` to shrink the text box to exactly the cap-height range, so flex centering aligns the visible glyphs instead of the padded line box. The shared `.cap-height-text` utility class in `app/globals.css` encapsulates the rule; use it on any `<span>` wrapping single-line, descender-free labels inside a centered container. Supported in Chromium 133+ / Safari 18.2+.
- **Availability cutoff requires `suggestion_deadline_minutes` to be set** on the question — the endpoint enforces `suggestion_deadline IS NULL AND suggestion_deadline_minutes IS NOT NULL`. Questions created without this field will fail the cutoff endpoint with 400.
- **`ChunkLoadError` after new builds**: the browser has stale cached chunks from the previous build. The lazy `CreateQuestionContent` import and the global `unhandledrejection` handler in `template.tsx` both auto-reload the page when this happens. The service worker uses network-first for JS chunks so new builds take effect immediately.
- **Autotitle convention**: time questions use `"Time?"` as the autotitle (matching the `BUILT_IN_TYPES` label), not a bespoke prompt like "When works?". Every branch of `generateTitle()` in `app/create-question/page.tsx` must call `appendFor(...)` on its return value so the "for X" suffix gets appended — the standalone `questionType === 'time'` fallback originally returned a raw string and silently dropped `forSuffix`.

### Service Worker Caching Strategy

- **Never use `url.pathname.startsWith('/')` in service worker URL matching** — it matches ALL paths. Use exact equality (`===`) or more specific prefixes like `/create-question`.
- **Use network-first for HTML navigation, cache-first only for immutable assets.** Cache-first for navigation causes the PWA to serve stale HTML that references old JS bundles (also cached), making it impossible for users to get new code. Network-first ensures fresh HTML on every load; cache is only a fallback for offline.
- **Skip API requests in the service worker** — let them go directly to the network. Caching API responses causes stale question data with no visible error.
- **Bump `CACHE_NAME` version when changing caching strategy** to force old caches to be deleted on activation. Without this, users keep stale cached content indefinitely.
- **JS chunks need network-first too** — even with content-hash filenames, the old manifest chunk references old chunk names. After a new build, the manifest is cached with old chunk references; network-first for `/_next/static/chunks/` ensures the manifest is always fresh.

### iOS PWA Safe Area Positioning

- **`position: fixed; top: 0` goes behind the notch** in iOS PWA with `viewport-fit: cover` and `black-translucent` status bar. Either push content down via `padding-top: env(safe-area-inset-top)` on the fixed element (so its background fills the notch zone), or anchor the element at `top: env(safe-area-inset-top)` (so it sits below the notch). The thread header uses the first pattern; the commit badge uses the second via `.pwa-badge-top`.
- **Body gets horizontal safe-area padding** (`padding-left/right: env(safe-area-inset-left/right)`); vertical safe-area insets are handled per-element by whatever sits at the top/bottom (fixed thread header, home/settings titles via `.page-title-safe-top`, the floating "+" FAB via its inline `max(1rem, env(safe-area-inset-bottom))` offset).
- **Use CSS media queries, not JS state, for PWA safe-area layout.** React state (`isStandalone`) starts `false` and only updates after `useEffect`, causing a visible jump on first render. `@media (display-mode: standalone)` applies instantly before any JS runs. Reserve `isStandalone` state for conditional rendering (e.g., back button visibility) where a one-frame flash is acceptable.
- **To position at the true screen edge**, render via a portal to `document.body` (outside the `.responsive-scaling-container`). From there, `fixed top: 0` = the safe area boundary (notch bottom) in PWA standalone mode.
- **Fixed header bars need to cover the notch zone, not just sit below it.** A header anchored at `top: env(safe-area-inset-top)` leaves the area above it (the notch zone) uncovered, showing scrolling content through it. Instead, anchor the bar at `top: 0` and push its content down with `padding-top: env(safe-area-inset-top, 0px)` so the background fills from the physical screen top. The measurement ref (for computing a sibling's `padding-top`) must be on the inner content div so `offsetHeight` stays content-only. Pattern used in `app/thread/[threadId]/page.tsx`.

### Navigation Layout

- **No bottom bar. No home button.** The old three-button bottom bar (Home / + / Profile) was removed. Navigation is:
  - **Floating "+" FAB on home only**: a single circular blue "+" button pinned bottom-right via `position: fixed` + `max(1.5rem, env(safe-area-inset-right, 0px))` / `max(1rem, env(safe-area-inset-bottom, 0px))`. Tapping it navigates to `/thread/new/` (the empty thread placeholder), where the user then picks a category bubble. The home page deliberately does NOT show the bubble bar — choosing What/When/Where is conceptually a per-thread decision, not a "starting fresh" decision.
  - **Floating What/When/Where bubble bar on thread-like pages**: rendered on `isThreadLikePage = isQuestionPage || isThreadPage` (matches `/p/<id>/`, `/thread/<id>/`, and `/thread/new/`). Three pill-shaped buttons (`h-8 px-2.5 rounded-full`) each containing a big `+` glyph (`text-[1.4rem]`) plus the lowercase label (`text-[1.12rem]`) with a subtle text drop shadow, labeled "what", "when", "where", centered horizontally along the bottom via `position: fixed; left: 50%; transform: translate-x(-50%)` with `bottom: max(1rem, env(safe-area-inset-bottom, 0px))`. Each opens the create-question modal in place with a different preselection: **What** → no preselection, **When** → `?mode=time` (locks to time question), **Where** → `?category=restaurant` (preselects restaurant — user can switch to Place/custom). Auto-sets `followUpTo=<latest>` when `<body>` exposes `data-thread-latest-question-id`. The `openCreateFromBubble(extraParams)` callback in `app/template.tsx` is the single helper for this flow.
  - **Settings gear**: only on the home page, upper-left, icon-only (no text). Links to `/settings`. Rendered as `position: absolute` inside a `relative` wrapper around just the h1, with `top-1/2 -translate-y-1/2` so its vertical center auto-tracks the title's midline (no hardcoded offset — survives font-size/padding changes). Sits in normal page flow and **scrolls off-screen with the page** (intentionally not fixed). The outer container's `padding-top` (`calc(0.75rem + env(safe-area-inset-top, 0px))`) handles the iOS notch clearance.
  - **Back arrow**: the HeaderPortal back button only renders on the settings page when there's in-app history; all other pages (thread, question) render their own back button in their fixed header.
- **Content wrappers on home + thread-like pages reserve `calc(5.5rem + env(safe-area-inset-bottom, 0px))` of bottom padding** so the last card can scroll above the bubble bar. Other pages use the normal `pb-6`/`py-6` from the outer Tailwind classes.
- **FAB portal target**: `#floating-fab-portal` (previously `#bottom-bar-portal`) in `app/layout.tsx`. Lives outside `.responsive-scaling-container` so fixed positioning is relative to the viewport, not the scaled container.
- **The "+" FAB and What/When/Where bubble bar slide with the root snapshot during view transitions.** Earlier they shared `view-transition-name: floating-plus` on a `.floating-plus-button` class so the bar would stay "pinned" across home ↔ thread navigation. The browser paired the small "+" element with the wider bubble-bar element as a single transition group — and even with `animation: none` on both pseudo-elements, the old "+" and the new bar coexisted in their original sizes/positions for the 500ms transition window, which read visually as the "+" growing and lingering at the bottom while the bubble bar expanded in. Removed the shared name + the `.floating-plus-button` class entirely; both portal-rendered controls now belong to the root snapshot, so the home "+" slides off-screen with the home page and the thread bubble bar slides in with the thread page (and vice versa on back). Don't re-introduce a shared `view-transition-name` between conceptually different controls just because they occupy the same screen position — the browser will pair them and the morph will look wrong unless you can make the two elements visually identical.
- **The outgoing root snapshot slides fully off-screen (`translateX(±100%)`), not a 25% parallax.** The first iteration used iOS-style parallax: outgoing 25% with opacity 0.5, incoming 100%. That stranded the bubble bar (which spans most of the bottom width) in the right portion of the viewport during back-nav — the new home page covered only the left half by the time the old page settled at +25%, leaving the rightmost button visible at half opacity under the incoming page. Symmetric 100%/100% slide ensures the bar fully exits the viewport before the new page lands. If you want the parallax look back later, you'd need to keep the outgoing page mostly off-screen (e.g. translateX(80%)) and accept a shorter trail — don't go below ~80% or the wide bubble bar will linger again.
- **Create-question modal close cleans up `category` along with `create`/`followUpTo`/`duplicate`/`voteFromSuggestion`/`mode`.** The Where bubble adds `?category=restaurant` to the URL; closing the modal must strip it so the URL display stays tidy. The cleanup list lives in `navigateCloseModalRef` in `app/template.tsx` — extend it whenever you add a new query param that the create modal consumes on entry.
- **`?category=<value>` preselection on the create-question modal** — `app/create-question/page.tsx` reads `categoryParam = searchParams.get('category')` once and feeds it as the initial `useState` value for `category` (defaults to `'custom'` when absent). The Where bubble uses this; future per-bubble flows (Phase 2.4 dual modal) can extend it. **The URL param wins over the saved-draft `questionFormState.category`** — the localStorage restore is gated on `formState.category && !categoryParam`, so a stale "restaurant" draft can't override a "What" tap that explicitly arrives with no `category` param. If you add another URL preselection mechanism that interacts with the saved-draft restore, mirror this guard.

### Back Button Navigation Strategy

- **On question pages the back arrow always renders and leads to the containing thread** — including on direct/first-link loads where there's no in-app history. Computed at click time by walking up `follow_up_to` in the `questionCache` via `findThreadRootRouteId`; a standalone question resolves to `/thread/<itself>`, which renders as a single-item thread. For the settings page the old "only when there's in-app history" rule still applies.
- **Detect standalone mode with `isStandalonePWA()`** which checks both `navigator.standalone` (iOS) and `window.matchMedia('(display-mode: standalone)')` (Android/Chrome). Both are device constants — evaluate once on mount, not on every navigation.
- **Don't use `document.referrer` or `window.history.length` for navigation decisions.** `document.referrer` is unreliable (privacy settings, cross-origin, browser variations). `history.length` is cumulative across the tab's lifetime, not app-specific. Use `sessionStorage` to track in-app navigation count instead (per-tab, auto-cleared on close).
- **After a create-question submission, the back button should lead to the thread containing the new question**, not back through the `?create=1` URL (which reopens the modal) and not to whatever random page the user was on before opening the modal. Implemented via `lib/questionBackTarget.ts`: the create-question flow calls `questionBackTarget.set(questionRouteId, threadRootRouteId)` before `router.replace('/p/<id>')`; the back button in `app/template.tsx` calls `questionBackTarget.consume(questionRouteId)` and uses `navigateWithTransition(router, customBack, 'back', { mode: 'replace' })` to replace the question entry with the thread entry — so subsequent `back` from the thread skips over the question. Skip setting the target when the page underneath the modal already matches the thread URL (avoids leaving a duplicate history entry).
- **`history.replaceState(null, '', url)` does not integrate with Next.js App Router back navigation.** When popstate fires with `state === null` (because we bypassed the router), Next.js's popstate handler can't resolve the target route and falls back in unpredictable ways — on the first attempt of this pattern, standalone questions were landing on the main list instead of the thread URL we'd injected. Use `router.replace` (which writes proper Next.js route state) combined with sessionStorage overrides for custom back destinations; never rely on raw `replaceState` to feed Next.js router back navigation.
- **Consecutive `router.replace` + `router.push` calls in Next.js App Router don't reliably produce two history entries.** Both navigations are scheduled through React transitions and can batch, so only one may actually commit. If you need the prior entry to be a different URL, use the sessionStorage-override pattern (a single `router.replace` plus back-button override in the next page).

### Scroll API Pitfalls

- **Non-scrollable headers in iOS PWA need `touch-action: none`** to prevent elastic rubber-banding. iOS WebKit allows bounce/elastic behavior from touch gestures even on content that has no scroll to offer. Adding `touch-none` (Tailwind) to fixed header bars prevents touches on them from initiating any scroll behavior. Taps (`onClick`) still work — `touch-action` only controls default browser behaviors.
- **Viewport-relative `position: fixed` works** only because `.responsive-scaling-container` has no `transform` on mobile. Any `transform` (even `scale(1)`) creates a containing block that traps fixed children. The scaling container applies `transform: scale(1.5/2)` on desktop only, via media queries.
- **Use `window.scrollTo` / `window.scrollY` for page scroll**, not per-element scroll refs. The document is the scroller — there are no inner page scroll containers. Auto-scroll patterns (e.g., thread page's scroll-to-bottom on load): `window.scrollTo(0, document.documentElement.scrollHeight)`. Expand-scroll: read/write `window.scrollY`.

### Portal Targets and Mount-Timing Races

- **Don't use a single `setTimeout` retry to find a DOM target that's mounted by a sibling component.** `CommitInfo` (in `layout.tsx`) needs the `#commit-badge-portal` element rendered by `template.tsx` behind its own `isMounted` flag. A 100ms retry worked on the home page but raced unpredictably on `/thread/...` and other routes where the template's mount effect commits later — leaving the commit-age badge missing for the rest of the session. Use a `MutationObserver` on `document.body` (with `childList: true, subtree: true`) and keep it running for the component's lifetime: React can replace the portal target across navigations, leaving a stale reference pointing at a detached node, so the observer re-queries on every DOM mutation and updates state only when the node identity changes.

### Dev Server Pitfalls

- **Dev server rate limiting is disabled** via `DISABLE_RATE_LIMIT=1` in `dev-server-manager.sh`. Dev servers are single-user, so production rate limits (120 GET/30 POST per minute) just cause friction during development.
- **`npm run dev` spawns a process chain** (`npm` -> `next` -> `node`). Killing the parent PID doesn't reliably kill child processes holding the TCP port. After PID-based kill, always `fuser -k <port>/tcp` to clean up orphaned children — otherwise the next start gets `EADDRINUSE`.
- **Dev server shows stale commit info** when the restart fails silently. The old process keeps serving pages. Always check `dev-server-manager.sh list` for `[STOPPED]` status after a push if the commit info doesn't update.
- **App-router directory renames poison Turbopack's filesystem cache.** Renaming/deleting an `app/<route>/` directory (e.g. `app/profile/` → `app/settings/`) leaves a pinned `AppPageLoaderTree` cell in `.next/cache` that no longer resolves. Turbopack panics `Failed to write app endpoint /<old-route>/page` on every request and broadcasts an HMR event that the client converts into a full reload — producing a ~1 Hz spontaneous-refresh loop on the dev site even though the source tree is correct. Fix: wipe `.next/` on the dev server and restart (`rm -rf /root/dev-servers/<slug>/.next && dev-server-manager.sh upsert <email> <branch>`). Note: `git pull` does not clear `.next/` — the normal push → webhook → upsert path won't fix a poisoned cache. If you see the loop pattern after a route rename, go straight to the `.next` wipe.

### Nominatim / Location Search

- **Nominatim does full-word matching, not prefix matching.** Searching "Burger K" won't find "Burger King" because "K" isn't a complete word. The frontend compensates with client-side result caching in `AutocompleteInput.tsx`: previous results are cached in `lastResultsRef`, and when a continuation query returns results, they're merged with cached results filtered by all query words. This way "Burger K" retains the "Burger King" result from the "Burger" query.
- **Use `bounded=1` with viewbox AND a hard distance cutoff** for proximity searches. Nominatim's viewbox is a bias, not a hard filter — results outside the box can still appear. Always post-filter with `_haversine_miles()` against `max_distance`.
- **Always set `Accept-Language: en`** in Nominatim requests to avoid foreign-language results.
- **Reference location is stored per-question** (`reference_latitude`, `reference_longitude`, `reference_location_label` columns) and per-user in localStorage (`lib/userProfile.ts: UserLocation`). The question creation page auto-fills from localStorage.
- **Gate the "Near X" display on category, not just field presence.** Because the reference location auto-fills on every question creation, non-location questions (Video Game, Movie) can end up with a `reference_location_label` that isn't meaningful. The question page shows the badge only when `isLocationLikeCategory(question.category)`. Extend this gate when adding new question-detail UI that references location.
- **Nominatim rate-limits aggressively (1 req/sec, IP-based).** Never fire parallel Nominatim requests — use a single search covering the area. The restaurant endpoint does one Nominatim call for the whole result set, not one per business.
- **OSM data completeness varies wildly by region.** NYC has websites for most chain restaurants; suburban/rural areas often have none. The `_restaurant_favicon_cache` compensates: once any location of a chain (e.g., Burger King) has a website in OSM, all locations get that favicon via name-based caching.
- **Restaurant search uses Nominatim with `extratags`** to extract cuisine data (e.g., `cuisine=mexican;burrito`), category type (`restaurant`, `fast_food`, `cafe`), and website URLs for favicons. No external paid API is needed — all restaurant data comes from OpenStreetMap.
- **Don't append category keywords (e.g., " restaurant") to Nominatim queries.** OSM tags fast food chains as `fast_food`, not `restaurant`, so the suffix causes Nominatim to miss them entirely. Instead, search with the raw query and post-filter results by `_FOOD_TYPES` (the `type` field in Nominatim's JSON response). The `_FOOD_TYPES` frozenset in `search.py` defines which OSM amenity types count as food/drink.
- **Favicon cache is name-based, backed by a JSON file** (`_restaurant_favicon_cache` in `search.py`). Bounded to 500 entries with LRU eviction. Persists across API restarts and container rebuilds. Production path is `/app/cache/favicon_cache.json` (Docker named volume `api_cache`); dev servers default to `~/.cache/whoeverwants/favicon_cache.json` (shared across all dev servers on the droplet). Configured via `FAVICON_CACHE_PATH` env var. Written atomically on each new entry (serialize with `json.dumps` first, then `NamedTemporaryFile` + `os.replace` to avoid orphaned tmp files). Cache dir is created once at module startup, not on every write.
- **Atomic file writes in Python**: always `json.dumps()` to a string before opening the temp file. If you open the temp file first and then `json.dump()` into it, a serialization error leaves an orphaned `.tmp` file on disk. Serialize first, write the string, then atomically replace.
- **Block autocomplete search for location-like categories until a reference location is set.** Proximity-bounded searches are useless without a reference point — Nominatim returns geographically random hits. `OptionsInput` computes `needsReferenceLocation = isLocationLikeCategory(category) && (refLat === undefined || refLng === undefined)` and shows an orange warning above the options while passing `searchDisabled={true}` to `AutocompleteInput`. `AutocompleteInput`'s `searchDisabled` prop is the single gate: early-return in `handleChange` (skip debounce/doSearch), guarded `setSuggestions` / `setShowSuggestions` in a `useEffect(() => ..., [searchDisabled])` that clears any previously cached results, and a check in `onFocus` so a cached list can't resurface.

### Create Question Modal (Query-Param Sheet)

- **The create-question form is a modal overlay**, not a separate route. It's triggered by the `?create` query parameter on any page. The underlying page stays mounted behind the backdrop.
- **The modal sheet is bottom-anchored and content-sized.** It uses `absolute bottom-0 left-0 right-0` with `maxHeight: calc(100% - env(safe-area-inset-top, 0px) - 15px)` so it grows from the bottom up to its content, only capping when content would push above the safe-area+15px gutter. The inner scrollable wrapper is `overflow-auto overscroll-contain min-h-0` (NOT `flex-1`) — `flex-1` would collapse to 0 under a content-sized parent, leaving the form invisible; `min-h-0` lets the same wrapper shrink-to-fit when the cap kicks in for tall content. Avoid reintroducing a fixed `top:` constraint or you'll be back to "modal always covers same area regardless of content," with white space below short forms.
- **`CreateQuestionContent` is exported** from `app/create-question/page.tsx` and lazy-loaded via `React.lazy` in `template.tsx`. The `/create-question` route redirects to `/?create`.
- **No duplicate/follow-up confirmation card.** When the modal is opened with `?duplicate=<id>` or `?followUpTo=<id>`, the underlying form logic still wires the new question up correctly — but the visual "this is a follow-up to X" header card was removed, along with the "Private until you share the link" footer. If you need a "remove association" UX in the future, also re-introduce a way to reset the related state (the previous `handleRemoveAssociation` callback was deleted along with the card).
- **Category and context are edited inline in the header** via `CategoryForLine.tsx`, replacing the old separate form fields. The header shows `‹category› for ‹context›` as editable placeholders. Category supports a built-in type dropdown (same types as `BUILT_IN_TYPES` in `TypeFieldInput.tsx`). When options are filled but no category is set, auto-generated text from options appears in the category slot in italic. The font auto-sizes via binary search to fit on one line, with a smooth 150ms CSS transition.
- **`CategoryForLine` uses a mirror-sizer pattern** for auto-width inputs: a `visibility: hidden` span determines the `inline-block` container width, and the input is `absolute inset-0` filling it. The mirror text stays at least as wide as the placeholder during editing to prevent jarring shrinkage.
- **`committedRef` prevents double-commit on blur** — when `selectType` or Enter commits the category, the subsequent blur handler skips re-committing. Without this, the blur sees empty `categoryEditText` and resets to "custom".
- **`categoryPristineRef` enables first-backspace-clears** — only for built-in categories, the first backspace after focus clears the entire value instead of deleting one character.
- **`fontSizePx` state is required** despite direct DOM manipulation in `fitFont` — React's style prop must stay in sync to prevent the font size from resetting to `MAX_FONT_PX` on re-renders triggered by other state changes.
- **All buttons that open the create form** (FollowUp, Duplicate, VoteOnIt, bottom bar "+") append `?create=1` plus any action params to the current page URL via `router.push`. They do NOT navigate to `/create-question`.
- **Close removes `?create`** (and related params) from the URL via `router.replace`, keeping the user on their current page.
- **Drag-to-dismiss** uses native touch listeners with refs for 60fps. Velocity-based dismissal (>500px/s flick) and 33% position threshold. Uses `requestAnimationFrame` coalescing. Force reflow (`offsetHeight`) is required between setting `transition` and the target `transform` after `transition: none` during drag.
- **Body scroll lock on iOS** requires `position: fixed` on `<body>` — `overflow: hidden` alone doesn't prevent native pull-to-refresh in Safari/WebKit. Scroll position is saved/restored on mount/unmount.
- **`navigateCloseModal` uses a ref** (`navigateCloseModalRef`) instead of a `useCallback` with `searchParams` in its deps. This prevents touch listeners from being re-attached on every query param change.
- **ConfirmationModal z-index must be above z-60** (the create-question modal). Currently at `z-[70]`. Any new modal that needs to appear over the create form must exceed z-60.
- **Scrollable children inside the modal must stop touch propagation.** The drag-to-dismiss handler on the modal sheet intercepts all touch events. Any scrollable child (like AutocompleteInput's dropdown `<ul>`) must call `e.stopPropagation()` on native `touchstart`/`touchmove` events so they don't bubble to the modal's drag handler. Use native `addEventListener` (not React's `onTouchStart`) to ensure listeners fire before the modal's bubble-phase handler. The template also has a general `startedInScrollableChild` check (walks DOM for `overflow-y: auto/scroll` ancestors) as a fallback, but explicit `stopPropagation` is more reliable.
- **Don't gate modal-content components behind an `initialDelay` to "wait for the slide-in".** Font-fitting helpers like `CategoryForLine.fitFont` measure `container.clientWidth`, which is determined by layout and is unaffected by the modal sheet's `transform: translateY(...)` slide. Rendering during the slide-in gives correct measurements from first paint and lets users see placeholders immediately. `ResizeObserver` + content-change effects handle any subsequent re-fits.
- **On submit, use `router.replace('/p/<newId>')` not `router.push`.** Replace drops the `?create=1` entry from history so the browser back button doesn't reopen the modal. The thread-targeted back button override (see Back Button Navigation Strategy) then sends back to the containing thread.

### Adding New Question Categories

- **Built-in categories** are defined in `TypeFieldInput.tsx: BUILT_IN_TYPES`. Add new entries there.
- **`isLocationLikeCategory()`** in `TypeFieldInput.tsx` controls which categories show reference location input and use proximity search. Update it when adding location-aware categories.
- **`isAutocompleteCategory()`** in `TypeFieldInput.tsx` controls which categories use the autocomplete dropdown (derived from `BUILT_IN_TYPES`).
- **Search dispatch** is in `AutocompleteInput.tsx: doSearch()` — add a new branch for each category's API endpoint.
- **Metadata rendering** is in `OptionLabel.tsx` — add detection function (like `isRestaurantEntry()`) and inline/stacked layout branches.
- **Place detail modal**: Tapping a restaurant/location name opens `PlaceDetailModal` (map embed + metadata). Tapping the address opens an iOS-style action sheet (`AddressActionsModal`) with "Open in Maps" (Apple Maps), "Open in Google Maps", and "Copy Address". Don't use `geo:` URIs on iOS — they're unreliable (may open Google Earth or other random apps). Don't include the business name in maps queries — it triggers a search for multiple branches instead of navigating to the specific address.
- **`line-clamp-2` breaks flex layouts**: Don't apply `line-clamp-*` to containers with flex children (like `OptionLabel`). The CSS treats flex items as flowing text and truncates unexpectedly. Use `overflow-hidden` instead and let inner components handle their own truncation.
- **Voting Cutoff field is a shared component**: `components/VotingCutoffField.tsx` renders the inline colored-value dropdown + conditional custom date/time inputs used by every question category in `app/create-question/page.tsx`. Reuse it when adding new categories — don't copy-paste the JSX. The custom date/time inputs inside use ids `customDate` and `customTime`; the component assumes only one instance is rendered at a time (enforced by the mutually exclusive `category === 'time'` vs `category !== 'time'` branches).

### Rich Selection Styling (Autocomplete Options)

- **Options selected from autocomplete are styled as "chips"**: underlined text (Tailwind `underline decoration-blue-500/50 underline-offset-2`) and a favicon/image on the left edge (`pl-8` + absolutely positioned `<img>`). Plain-typed options have no special styling.
- **Chip-like clear behavior**: on focus, all text is selected (`input.select()`), so backspace or any keystroke replaces the entire value. After `selectSuggestion`, `requestAnimationFrame(() => input.select())` auto-selects; on re-focus when `isRichSelection`, text is selected again.
- **Metadata lifecycle**: `isRichSelection` is derived from `!!optionsMetadata?.[option]`. When the user edits a rich selection (any keystroke), `onRichValueCleared` fires and the parent calls `clearMetadataForOption()` to remove the metadata entry. The underline/icon disappear and the field reverts to plain text. Deleting an option via the trash button also cleans up its metadata.
- **`clearMetadataForOption()`** in `OptionsInput.tsx` is the single helper for metadata cleanup — used by both `removeOption` and `onRichValueCleared`. Don't duplicate this pattern.

### Trim-on-Blur Policy (App-Wide)

- **All text inputs trim leading/trailing whitespace on blur.** This is applied globally across the app: create-question form fields (title, options, category, context, details), settings page (name, location), `CompactNameField`, `AutocompleteInput`, `LocationTimeFieldConfig`, and `ReferenceLocationInput`. When adding new text inputs, add `onBlur` trim handling.

### Create-Question Form UI Patterns

- **Amber "needs attention" highlight for required form buttons**: The Tailwind class stack `bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-400 dark:border-amber-500 hover:bg-amber-200 dark:hover:bg-amber-900/60` is the codebase's idiom for drawing the user's eye to a button they need to tap to resolve a validation error. Used on the `+ Time` button in `DayTimeWindowsInput.tsx` when a day has zero time windows, and on the Select Days / Add/Remove Days button in `ParticipationConditions.tsx` when `dayTimeWindows` is empty. Match this style for any new "button that needs attention" states so the UI stays consistent.
- **Derive validation highlights from source state, not error strings**: When a form element needs to highlight in response to a specific validation failure, derive the highlight boolean from the underlying state (e.g. `dayTimeWindows.length === 0`) rather than comparing `validationError === "some exact string"`. String comparison silently breaks on typos or rewording. The pattern in `ParticipationConditions.tsx: highlightDaysButton` passes a simple state-derived boolean from the parent.
- **Compact tappable-value → modal pattern**: For form fields that don't need to be adjusted often (like Minimum Participation), use a single-line `<div>` with a `<button>` showing the current value in blue (`text-blue-600 dark:text-blue-400`). Tapping opens a modal with the full control (slider, picker, etc.). Don't wrap the whole thing in a `<label>` — there's no form control to associate with. Example: `MinimumParticipationModal.tsx` + the compact field in `app/create-question/page.tsx` (time question block).
- **Pill-on-info-line → modal pattern**: `components/SearchRadiusBubble.tsx` is the shared "blue pill shows current value, tap to edit in a small modal" control. Used on the question-creation form (`ReferenceLocationInput`) AND on the voting page's "Near X" info line (`QuestionBallot`) — owning `searchRadius` state in `QuestionBallot` and forwarding it as a prop to `SuggestionVotingInterface` keeps the two surfaces in sync with a single source of truth. When adding another numeric-value-with-unit pill control, reuse this component or mirror its structure (pill uses `bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full` class stack).
- **Radius bubble on the "Near X" voting-form line is gated on `canSubmitSuggestions && isLocationLikeCategory(category)`** — it's only meaningful during suggestion collection for location questions. `reference_location_label` is always co-set with `reference_latitude`/`reference_longitude`, so checking the label is sufficient — don't re-guard on latitude.

### Social Test Report Bidirectional Linking

- **Question-to-report back-links require `SOCIAL_TEST_REPORT_URL` in the test subprocess environment.** `generate_report.py` derives it from `--site-url` (or `SOCIAL_TEST_API_URL` env var) + `/{REPORT_FILENAME}.html` and passes it to pytest. Without it, `conftest.py`'s `REPORT_URL` is empty and no back-link is injected into question `details` fields.
- **Report-to-question forward links work independently** — they read `question_id` from test results JSON after the run. Only the reverse direction (question → report) requires the URL to be known at test time.
- **The report filename is defined once** in `REPORT_FILENAME` constant in `generate_report.py`. Update it there if the filename changes.
- **After deploying a report to a dev server, always verify it loads** by curling the URL and checking for a non-empty 200 response. Pipe-based base64 transfers can silently produce empty files. Then share the verified URL with the user.

### Yes/No Result Edge Cases

- **All-abstain questions return `winner=None`, not `"tie"`.** In `server/algorithms/yes_no.py`, when `yes_count == 0 and no_count == 0` (but `total_votes > 0` due to abstains), the winner is `None`. A tie means competing sides got equal votes; all-abstain means no decision was made. The `total_votes == 0` early return handles the no-votes-at-all case separately.

### Compact Preview Strips (Thread Card Footer Row)

- **Every question type has a compact "top result" strip in the in-card footer row's right slot, mounted regardless of `isExpanded` so the pill never remounts on toggle.** Yes/no splits the render: when collapsed, the status row's pill slot hosts `<QuestionResultsDisplay hideLoser={true}>`; when expanded, a separate `<QuestionResultsDisplay hideLoser={false}>` renders below the status row for the full cards. (Single-render-with-internal-switch doesn't work here because the two presentations live in different DOM positions — the compact pill is a sibling of the status label, the full cards are a sibling row.) Ranked choice / suggestion / time use smaller type-specific components (`CompactRankedChoicePreview`, `CompactSuggestionPreview`, `CompactTimePreview`) in `components/QuestionResults.tsx`. Each is wrapped in an **inverse grid-rows clip** (`grid-rows-[1fr]` when collapsed, `grid-rows-[0fr]` when expanded — opposite of the heavy-content expand clip below). The two clips animate in lockstep over 300ms: pill smoothly shrinks to 0 height while the rounds visualizer / time-slot bubble grid grows in to fill the same vertical space. No flicker (pill stays in DOM, no remount), no redundant duplication of winner info when expanded, and the header reclaims the pill row for the heavy content. Prior iteration #1 gated the pills on `!isExpanded` (caused unmount-flicker — instant 32px gap collapse during the 300ms grid-rows growth, leaving the corner empty). Prior iteration #2 left them rendered always (DOM-stable but visually duplicated the winner once in the pill and once in the rounds visualizer). Inverse-clip handoff is the synthesis. To add a preview for a new question type: (a) add the component, (b) add a `question.question_type === '...'` block in the footer-row IIFE in `app/thread/[threadId]/page.tsx` wrapping the pill in the same `CompactPreviewClip`, (c) extend the `wantsResults` allowlist in `maybeFetch` so results get fetched when the card enters the viewport.
- **Shared pill primitives** in `QuestionResults.tsx`: `PILL_CLASS` (includes `min-w-0` so it can shrink below content width when the status label on the left claims most of the flex row), `PILL_COLORS_OPEN` (blue), `PILL_COLORS_CLOSED` (green). Reuse these rather than copying class stacks — the review agents flag divergence fast. Empty-state copy ("No voters", "No suggestions yet") is NOT rendered in the card's pill slot anymore — it lives below the card in the respondents row (see the "Respondent Row" section below). Every compact preview component (`YesNoResults` hideLoser path, `CompactRankedChoicePreview`, `CompactSuggestionPreview`, `CompactTimePreview`) returns `null` when empty and the wrapper at the callsite is also skipped so no gap lingers.
- **Closed questions show "Closed Xm ago" (faint) in the in-card footer row's status slot** — the compact pills (Yes/No, CompactRankedChoicePreview, CompactSuggestionPreview, CompactTimePreview) are the single source of truth for the winner, so the status slot is repurposed for timing info only. Uses `compactDurationSince(closedAt)` from `lib/questionListUtils.ts`, which promotes to the next larger unit only when that unit's count would be ≥ 2 (13d stays `13d`; 14d becomes `2w`). The `closedAt` source is `response_deadline` when `close_reason === 'deadline'` (more accurate than `updated_at`, which would drift on subsequent edits), else `updated_at` (reliable for manual / max_capacity / uncontested closes — the DB trigger refreshes it on every `is_closed` flip). Don't call `getResultBadge` here — it's no longer imported into the thread page.
- **Time questions in the availability phase render "Collecting Availability" in the footer row's status slot**, not in the pill slot — same format and styling as "Taking Suggestions". Use `isInTimeAvailabilityPhase(question)` (in `lib/questionListUtils.ts`) as the single check; the `CompactTimePreview` pill returns null during that phase so nothing is duplicated.
- **`QUESTION_TYPE_SYMBOLS` needs an entry for every new question type** (in `lib/questionListUtils.ts`). Without it, questions with that type and no matching category fall through to `'☰'` — a giveaway that the icon's wrong. Currently: `yes_no: '👍'`, `ranked_choice: '🗳️'`, `time: '📅'`.
- **Ties aren't possible in the ranked_choice winner field.** After Borda count tiebreak fails, the algorithm falls back to alphabetical. So `results.winner === 'tie'` only happens in yes_no; compact previews for ranked_choice can treat a missing winner as "no voters yet" rather than ambiguously tied.
- **Plain-text fallbacks get `mr-[0.4rem]` extra right margin** on top of the card's `px-2` (≈80% more distance from the card border) so they don't visually crowd the edge. Pill content keeps its own internal padding and sits at the default right edge of the card.
- **Category icon vertical centering**: `mt-[4px]` on the icon wrapper (previously `mt-[7px]`). Pure line-box centering (9px) reads low because the line-box includes descender space; biasing toward cap-height centering (5px) reads better for emoji glyphs across the category set. If the emoji set or title size changes, re-tune with Playwright `getBoundingClientRect` on both `<h3>` and the icon wrapper.

### Thread Card Respondent Row (Below-Card Bubbles)

- **The row under each thread card is ALWAYS rendered with the same height**, whether it shows respondent bubbles, loading skeletons, or an "empty" message. The old design let the row collapse to 0px when there were no respondents, which (a) caused visible jitter from skeleton → empty, and (b) pushed every card below up. `VoterList` in `singleLine` mode accepts an `emptyText` prop; when the voters array is empty (or all voters are excluded-current-user), it renders `<EmptyPlaceholder text={emptyText}>` at bubble height (text-xs 16px + py-0.5 4px = 20px) instead of returning null. Skeleton pills also have explicit `height: 20px` to match — all three states (skeleton / empty / populated) occupy the same vertical space.
- **Empty-state copy lives here, not in the card.** The thread page passes `emptyText={isInSuggestionPhase(question) ? 'No suggestions yet' : 'No voters'}` to VoterList. Every compact preview in `QuestionResults.tsx` returns `null` when it would otherwise render an empty note — the respondents row is the single source of truth for empty copy. When adding a new compact preview: return `null` on empty, and let the callsite in the thread page skip the wrapper (so no `mt-2` 8px gap lingers).

### Avoiding Layout Shift in Thread List on Refresh

- **Compact preview slots must be populated on first paint.** `questionResultsMap` is seeded synchronously from inline `question.results` in its `useState` initializer (from `initialThread.questions`) AND again in an async `setQuestionResultsMap` updater before `setThread` on cache-miss loads. Without this, the slot mounts empty and fills in once the viewport-intersection fetch resolves — making every card grow ~26-32px. Guard the updater with `filter(...).length === 0 ? prev : new Map(prev)` so a no-op doesn't allocate.
- **`apiGetAccessibleQuestions` now returns inline `results` for every open question with `show_preliminary_results=true` and `min_responses` unset-or-met.** The old backend gate required `min_responses` to be SET AND met, which left typical open questions (no threshold) without inline results and forced per-card round-trips. If you loosen / tighten this further, update `server/routers/questions.py: get_accessible_questions`.
- **`apiGetAccessibleQuestions` also calls `cacheQuestionResults` for every inline result** so the per-question results cache stays consistent with the bulk response. Without this, a later `apiGetQuestionResults(id)` call would cache-miss and re-fetch despite the data already being in hand.
- **Votes prefetch happens in parallel with `getAccessibleQuestions`.** The thread page fires `for (const id of getAccessibleQuestionIds()) void apiGetVotes(id)` right after `discoverRelatedQuestions` (so discovery-added ids are included) and BEFORE `await getAccessibleQuestions()`. `apiGetVotes` is cache + in-flight coalesced, so the per-VoterList fetch that fires at mount hits either the cache or the already-in-flight promise. This is what makes respondent bubbles appear on the same frame as the cards instead of ~100ms after.
- **`VoterList` seeds state from the votes cache synchronously in the `useState` lazy initializer.** Uses a shared `deriveVoterState(votes, filter)` helper (also used by the async fetcher) to produce `{voters, anonymousCount, key}` from a votes array. Lazy `useState(() => ...)` runs once at mount; do NOT use `useRef(iife())` — the IIFE argument is evaluated eagerly on every render and the useRef-initial-value-only-on-first-render behavior doesn't suppress that. Combined with the thread page's parallel prefetch, this means no skeleton flash even on cold refresh.
- **Measure the thread page's fixed-header height in `useLayoutEffect`, not `useEffect`.** `useEffect` runs after paint → the first frame has `paddingTop=0` and the content sits at `y=0` → re-render shifts it down by ~100px. `useLayoutEffect` runs between the DOM commit and the browser paint, so the first painted frame already has the correct padding.
- **Don't use `useRef(initialValue)` with a complex expression to cache "run once on mount" computations.** The initial-value argument is evaluated on every render; `useRef` just ignores subsequent values. Use `useState(() => computeOnce())` — React guarantees the initializer runs exactly once at mount.

### API Development Pitfalls

- **`server/services/questions.py` is the home for non-route helpers.** Anything that's a free function operating on a DB connection (`_fetch_question_full`, `_finalize_*`, `_submit_vote_to_question`, `_edit_vote_on_question`, `_row_to_question`, `_compute_results`, etc.) lives in `services/questions.py` and is imported by both `routers/questions.py` and `routers/polls.py`. Don't reach across routers (`from routers.questions import _foo` from a sibling router) — that pattern was retired when `services/` was introduced. Underscore-prefixed names are kept as a "low-stability internal API during poll Phase X churn" signal; OK to drop the underscore once the surface stabilizes.
- **Catch-all fallthrough in `_compute_results()`**: When adding new question types, `server/services/questions.py: _compute_results()` has a catch-all return at the bottom returning `yes_count=None`. Any question type without an explicit handler silently falls through and the frontend interprets `None` as `0`. Always add an explicit handler for each question type.
- **Frontend TODO stubs cause silent failures**: If the backend adds a new endpoint, check whether the frontend has TODO stubs (e.g., `setParticipants([])`) that need to be connected. Stubs cause incorrect UI without errors.
- **`toQuestionResults()` in `lib/api.ts` is a manual field mapper** — when adding new fields to `QuestionResultsResponse` on the backend, you MUST also add them to `toQuestionResults()` or they'll be silently dropped. The function explicitly maps each field; unmapped fields from the API response are discarded.
- **`toQuestionResults` allocates a fresh object on every call, which defeats identity-based setState guards.** `apiGetQuestionResults` resolves via `coalesced()` — when the cache is warm, it returns the *same* reference stored by `cacheQuestionResults`; but the very first call (cache miss) builds a new object via `toQuestionResults(data)` and every subsequent *live* refetch (after invalidation) does the same. So `setQuestionResultsMap(prev => prev.get(id) === results ? prev : ...new Map(prev).set(id, results))` looks like a no-op guard but always falls through, allocating a new Map + firing a re-render on every fetch. Compare by field content (`total_votes`, `yes_count`, `no_count`, `winner`) instead of reference identity. Same pattern applies to any state-map seeded from API helpers that pass through `to*()` converters.
- **Dev server Pydantic schema caching**: Adding fields to a Pydantic `BaseModel` (like `QuestionResultsResponse`) requires a full API restart — `uvicorn` with hot-reload doesn't always pick up model schema changes. Use `dev-server-manager.sh upsert` to force a clean restart.

### Auto-Created Follow-Up Questions & Creator Secrets

- **Auto-created questions share the parent's `creator_secret`**, but the browser only stores secrets for questions it created directly. When navigating to an auto-created follow-up question (e.g., preferences question from a suggestion question), the browser must propagate the parent's secret to the child. Do this both on navigation (in the close handler) and on page load (check `question.follow_up_to` and propagate if the parent's secret is known).
- **Use `recordQuestionCreation()` from `lib/browserQuestionAccess.ts`** instead of calling `storeCreatorSecret()` + `addAccessibleQuestionId()` separately. The higher-level function already does both.
- **Question data snapshots (duplicate/follow-up)** are passed between pages via localStorage. When adding new question fields, update `buildQuestionSnapshot()` in `lib/questionCreator.ts` — it's used by `FollowUpModal.tsx` and `DuplicateButton.tsx`.
- **PWA clients cache old JS bundles** — snapshot structure changes (new fields in `buildQuestionSnapshot`) won't take effect until users get new JS. Always add backward-compatible detection in the consumer (create-question page) rather than relying solely on snapshot fields. The `is_auto_title` detection uses a ref-based comparison against `generateTitle()` output to handle old snapshots that lack the field.

### Drag-to-Reorder & Tap-to-Move (RankableOptions)

- **Delay drag start until pointer moves >8px.** On `pointerdown`, save intent in a ref (`pendingDragRef`) but don't call `startDrag`. On `pointermove`, if threshold exceeded, start the actual drag. On `pointerup`, if drag never started, it's a tap. This avoids React's async state update issue: `pointerup` fires before `isDragging` state is processed, leaving drag state stuck.
- **Use FLIP animation for tap-to-reorder, not CSS `top` transitions.** Changing `top` values across React state updates doesn't reliably trigger CSS transitions (React 18 batching, Tailwind class conflicts). Instead: record old `getBoundingClientRect()` positions, apply the state change with `flushSync`, then apply inverse `transform: translateY(delta)` + forced reflow (`el.offsetHeight`) + transition removal. This is the standard FLIP (First, Last, Invert, Play) technique.
- **Tailwind `transition-colors` overrides inline `transition: top`** because it sets `transition-property` to only color properties. Never mix Tailwind transition classes with inline `transition` shorthand on the same element — consolidate all transitions in one place.
- **`touch-action: none` must only be on the drag handle, not the container.** Putting it on the outer container blocks all scrolling. Only the right-side handle element needs it.
- **`setPointerCapture` routes events to the captured element.** Use it on `pointerdown` to prevent iOS SFSafariViewController's sheet dismiss gesture from intercepting downward drags.
- **Handle tap zones extend beyond item bounds** via negative `top`/`bottom` offsets that account for both the item's padding (12px from `p-3`) and half the gap between items.

### Equal/Tied Rankings (RankableOptions)

- **Tier data model**: `ranked_choice_tiers JSONB` column (migration 089) stores `[["A"], ["B","C"], ["D"]]`-style tiered ballots alongside the flat `ranked_choices TEXT[]` for backwards compatibility. The IRV algorithm prefers tiers when present; falls back to singleton tiers from the flat list.
- **IRV "duplicate vote" method**: When a ballot's highest-ranked active tier contains multiple options, each gets a full vote. Total votes per round can exceed ballot count. Win requires strict majority AND unique leader; if multiple candidates tie at the top with majorities, IRV continues eliminating. Borda tiebreak uses standard competition ranking (1,2,2,4).
- **Linked pairs state**: `linkedPairs: Set<string>` stores canonical `pairKey(idA, idB)` strings for adjacent items that are tied. The set is persisted to localStorage alongside the ranking. `computeTierIndices()` walks the list and groups consecutive linked items into tiers.
- **Merged tier cards**: Consecutive linked items render as a single card with divider lines between rows (compressed `groupedGapSize=0` gap). Each card has one shared drag handle (arrows + grip). Dividers are inset from both edges (`dividerInset` prop on `TierCardRows`).
- **`computeDropTarget()` is a pure, exported function** for drop-target computation. For each valid insertion point (between non-dragged units), it computes the tier's natural layout center and picks the closest match to the visual center. This gives symmetric thresholds and treats groups as atomic. Verified by 15 simulation tests (`drag-threshold-simulation.test.ts`).
- **Tap-to-reorder uses `moveTierByOneUnit`** which finds the full adjacent unit via `getTierRange()` and swaps atomically. This prevents singletons from landing inside groups and groups from splitting each other.
- **Drag operations clear links on the moved item** (`clearLinksTouchingItem` / `dropLinkedPairsFor`) to prevent stale adjacency. But `moveTierByOneUnit` and tier-drag `finishDrag` preserve internal tier links since the items remain adjacent.
- **Link icon styling**: chain-link SVG with background-colored drop-shadow contour (`LINK_CONTOUR_FILTER`), blue when active, gray when inactive. No circle/border — just the icon with a halo for contrast. Centered horizontally on the card via `left: 50%; transform: translateX(-50%)`.

### Textarea Sizing & Inline-Block Gaps

- **`<textarea>` defaults to `display: inline-block`** in most browsers, which causes a descender-space gap below it (based on parent `line-height`). Always add `display: block` (Tailwind `block` class) to textareas to eliminate this phantom spacing.
- **The `rows` HTML attribute overrides CSS height** — browsers use `rows` to compute an intrinsic size that takes priority over `min-height` and can fight `height`. To control textarea height with CSS, omit `rows` and use `height`/`style.height` directly.
- **Auto-grow textareas must reset to a fixed height, not `'auto'`** before reading `scrollHeight`. Resetting to `'auto'` lets the browser expand to its default intrinsic size (often taller than one line), causing the textarea to jump on first keystroke and never shrink back. Reset to the base height (e.g., `el.style.height = '42px'`) so `scrollHeight` only exceeds it when content actually overflows.
- **`text-sm` on inputs/textareas causes height mismatches** — a `text-sm` input renders ~38px while a default-size input renders ~42px with the same `py-2` padding. When fields appear in a `space-y-*` form, the shorter field makes the gap below it appear larger. Use consistent font sizes across form fields.

### Screenshot Verification Workflow (Mandatory for Visual Changes)

**When adding a feature or fixing a bug with visible UI effects, you MUST take before/after screenshots to verify the change.**

#### The Workflow

1. **Before starting the change**: Set up the page in the state that demonstrates the problem or current behavior. Take a "before" screenshot. Assess it — confirm it shows the issue you're about to fix (retry with different state/data if it doesn't).
2. **After completing the change**: Push the code, update the dev server, and take an "after" screenshot of the same page/state. Assess it — confirm the fix/feature is visible and working.
3. **Visual design lint**: Carefully examine the changed area in the "after" screenshot for UI/design regressions (misaligned text, broken spacing, color issues, overflow, etc.). Fix any issues you introduced. If you spot a pre-existing issue you didn't cause, inform the user but don't fix it without their approval.
4. **Share with the user**: Serve both screenshots via the dev server and provide the URLs for review.

#### Using `scripts/screenshot.sh`

The `screenshot.sh` script automates the full pipeline: Playwright screenshot on the droplet → base64 transfer to local `/tmp` for Claude assessment → optional serving via a dev server's `public/screenshots/` directory.

```bash
# Take a screenshot and serve it
bash scripts/screenshot.sh take <port> <path> <name> [--width W] [--height H] [--wait MS] [--serve-slug SLUG]

# Examples:
bash scripts/screenshot.sh take 3001 / home-before --serve-slug screenshot-test-at-test-com
bash scripts/screenshot.sh take 3001 /p/abc123 question-after --width 430 --height 932 --serve-slug my-slug

# Serve a previously taken screenshot to a dev server
bash scripts/screenshot.sh serve my-screenshot my-dev-slug

# Print comparison URLs
bash scripts/screenshot.sh compare before-name after-name my-dev-slug
```

After taking a screenshot, **always read the local file** to assess it:
```bash
# The script saves to /tmp/<name>.png — use the Read tool on this path
# Read tool renders images natively for visual assessment
```

#### Setting Up State for Screenshots

Often you need the page in a specific state (e.g., a question with votes, an empty list, an error condition). Use the API to create the necessary data:

```bash
# Create a question via the dev server's API
bash scripts/remote.sh "curl -s -X POST http://localhost:<api-port>/api/questions -H 'Content-Type: application/json' -d '{...}'"

# Submit votes
bash scripts/remote.sh "curl -s -X POST http://localhost:<api-port>/api/questions/<id>/votes -H 'Content-Type: application/json' -d '{...}'"
```

#### Assessment Checklist

When reviewing each screenshot, check:
- Does the before screenshot clearly show the problem/current state?
- Does the after screenshot show the fix/feature working correctly?
- Is text properly aligned, sized, and colored?
- Are spacing and padding consistent with surrounding elements?
- Does the change look good on mobile viewport (430x932 default)?
- No overflow, clipping, or unexpected wrapping?
- No regressions in adjacent UI elements?

#### Measure DOM Spacing Programmatically

For pixel-precise verification, use `page.evaluate()` with `getBoundingClientRect()` — but be aware it may not account for `inline-block` descender gaps. Cross-check by annotating screenshots with Pillow (`python3-pil` on the droplet).

### CI/GitHub Actions Pitfalls

- **Vitest 3.x requires `@vitest/coverage-v8`** — the old `c8` provider is removed. Match the coverage package version to the vitest major version.
- **Next.js static export + `"use client"`**: `generateStaticParams()` cannot coexist with `"use client"` in the same file. For dynamic routes in static export, delete the route and rely on SPA fallback.
- **PR comment workflows** need explicit `permissions: pull-requests: write` in the workflow YAML.
- **GitHub Pages environments** only allow deploys from the configured branch (usually `main`). Restrict deploy workflow triggers to `main` to avoid noisy failures on feature branches.

### View Transitions API (iOS-style slide navigation)

- **`router.prefetch()` is a no-op in `next dev`.** Next.js only activates prefetching in production builds. When diagnosing navigation speed on dev servers, expect the full compile-on-demand cost per route pattern — production behaves very differently.
- **Production API rewrites ignore `PYTHON_API_URL`.** `next.config.ts: getApiRewriteDestination()` returns the external `api.whoeverwants.com` or branch-slug subdomain when `NODE_ENV === 'production'`. To test a production build on a dev droplet pointing at the local FastAPI, patch the function to check `PYTHON_API_URL` first before the prod branch.
- **`document.startViewTransition` callback has no access to `requestAnimationFrame`.** The browser pauses rendering (including rAF) during the callback, so awaiting `requestAnimationFrame` creates a deadlock that fires the browser's 4-second view-transition timeout. Use `setTimeout`/`MutationObserver` instead.
- **`router.push` is async in Next.js App Router — `flushSync` can't force it synchronous.** Wrapping `router.push` in `flushSync` inside a view transition callback looks plausible but doesn't actually commit the new route synchronously; the browser then captures "old" and "new" snapshots that are identical and optimizes the animation away. Don't do it.
- **Destination pages must signal "ready" via `usePageReady` (`lib/usePageReady.ts`).** The hook writes `data-page-ready=<normalized-pathname>` on `<html>` in a `useLayoutEffect`. `navigateWithTransition` waits on a `MutationObserver` for that attribute to match the expected pathname before releasing the transition. Every client page that is a navigation destination must call it — otherwise `waitForNavigation` falls back to its 3000 ms timeout and the browser captures stale DOM as the "new" snapshot, producing the "slide plays but new page looks identical to old" bug. Pages using `useThread` (`lib/useThread.ts`) inherit the signal for free. Pass `true` as soon as the page can render something meaningful (a spinner is fine, beats stale content); don't wait for full data-load.
- **`navigateWithTransition` fails closed when `data-page-ready` never lands.** If `waitForNavigation` times out, the transition callback throws `page-not-ready` and the browser skips the animation (per spec), doing an instant page swap. That's a better failure mode than animating stale→stale. Keep the `transition.finished.catch(() => {}).finally(cleanup)` dance — the catch is required because we deliberately throw.
- **`navigateBackWithTransition` must wait for `data-page-ready` symmetrically with the forward path.** An earlier version waited a flat 120 ms after `history.back()` and then let the browser capture whatever DOM was there as the "new" snapshot — which on a slow commit could include a partially rendered destination, or the still-mounted source route mid-re-render, reading visually as "the thread flashes a different thread before sliding to home." The back path can't pre-compute the target (we don't know it until `history.back()` flips the URL), so the sequence is: `history.back()` → `waitForUrlChange(predicate)` → read `window.location.pathname` as the target → `waitForPageReady(target, deadline)`. Same `throw new Error('page-not-ready')` on timeout aborts the transition for an instant swap. Same `.catch(() => {}).finally(cleanup)` plumbing on `transition.finished`. If you ever revert this to a fixed-delay wait, you'll re-introduce the stale-snapshot flash.
- **Same-path `router.push` is a no-op — don't wrap it in a transition.** `navigateWithTransition` early-returns when `normalizePath(targetPath) === normalizePath(location.pathname)` so `startViewTransition` never fires with identical old/new snapshots. Also covers the case where card-expand `history.replaceState` already moved the URL to the target.
- **Next.js App Router uses `history.pushState` internally, which does NOT fire `popstate`.** `popstate` only fires on back/forward. `lib/viewTransitions.ts` monkey-patches `history.pushState`/`replaceState` at module load to dispatch a custom `__app:urlchange` event — lets `waitForNavigation` Phase 1 await a real event instead of questioning. Idempotent via `window.__urlEventInstalled` flag. The patch runs on every route that imports the module; the guard makes re-imports free.
- **Trailing slashes require normalization.** The app uses `trailingSlash: true`, so `router.push('/thread/xyz')` navigates to `/thread/xyz/`. Any pathname comparison must strip the trailing slash; `lib/questionId.ts: normalizePath()` is the canonical helper.
- **Defer background refreshes on cache-hit to let React commit first.** On `app/thread/[threadId]/page.tsx` the destination mounts synchronously from `questionCache`; the `fetchThread` refresh (discoverRelatedQuestions + getAccessibleQuestions + votes prefetch) is scheduled via `requestIdleCallback` (with `setTimeout(0)` fallback for Safari) so it doesn't compete with the initial React commit during the transition. This collapses `ready-after-url` from ~300 ms to near-zero — remaining click→ready time is dominated by `router.push` internals, not user-code work.
- **View transitions capture DOM snapshots — Playwright `.screenshot()` reads the live DOM, not the pseudo-elements.** During an animation, the underlying DOM is the destination page; Playwright shows that, not the sliding pseudo-elements. Verify animation visibility by checking CSS animation events (`transition.ready`, `transition.finished`) or by slowing `animation-duration` to capture mid-frames.
- **`view-transition-name` on destination page headers makes them separate transition groups during EVERY navigation** — not just matching ones. If page A has `view-transition-name: hero` and page B doesn't, navigating A→B causes page A's hero to fade out independently while the root slides. If you want a hero-title morph, apply `view-transition-name` dynamically only during transitions where both source AND destination have the matching name; never set it statically on page headers.
- **Shared-element hero morphs don't work well when destination title ≠ source title.** The browser animates the source element's content into the destination position, so users see `"Question A"` sliding into where `"Thread A"` will be, then flashing to the correct text. For pages with conceptually different titles (question → thread), skip the morph entirely and let the whole page slide as a single root snapshot.

### Navigation Performance Benchmark (`scripts/bench-navigation.mjs`)

- **`npm run bench:nav` drives a real Chromium via Playwright against any URL.** Set `BENCH_URL=https://<origin>`; optional `BENCH_RUNS` (default 8), `BENCH_HEADLESS=0` to watch, `BENCH_CPU_THROTTLE=4` for 4× slowdown via CDP, `BENCH_JSON=path.json` for machine-readable output, `BENCH_VERBOSE=1` for browser console + pageerrors.
- **Core metric is `click → data-page-ready`.** All timing happens inside the browser via `performance.now()` to avoid Playwright CDP round-trip overhead. For `home → thread (warm)` the bench also reports `click → url flip`, `ready after url`, and `click → transition done` (when the `data-nav-direction` attribute clears, i.e. `ViewTransition.finished` resolved).
- **Scenarios:** cold home load, home→thread (warm + cold), thread→home via back button, rapid home⇄thread. Each scenario is wrapped in `try/catch` so dev-server flakiness (502s under memory pressure, HMR races) yields partial results rather than aborting the run.
- **Warm-up pass is built in.** On dev servers the first hit of `/thread/[id]` triggers Next.js on-demand compile (can exceed 30s), so the bench hits the thread route once before Scenario 2 to pay the compile cost outside measurement.
- **Structural DOM fallback covers dev HMR races.** If `data-page-ready` doesn't land in time but the page's canonical fingerprint (`[data-thread-root-id]` on home, `body[data-thread-latest-question-id]` on thread) is present, treat as ready. Only matters in dev; in prod the attribute always wins.
- **Reference numbers** (prod-mode build on a dev droplet, 10 runs, for the main "home→thread (warm)" scenario): click→url p50 ~200-500ms, ready-after-url p50 ~0-320ms, click→ready p50 ~450-600ms, click→transition-done p50 ~1100-1200ms (final ~500ms is the CSS slide animation). Heavy run-to-run variance on the 1 GB droplet — repeat 2-3 times before drawing conclusions.
- **Dev numbers are inflated 3-6× vs prod** (on-demand compile + React dev mode). For apples-to-apples comparisons build prod mode per `### Production build testing on dev droplet`.

### In-memory data cache for navigation

- **`lib/questionCache.ts` caches question/results/votes/participants data** so destination pages render instantly from cache on navigation. 60s TTL for questions, 15s for results/votes (which change more often). All maps capped at 100 entries with LRU eviction to bound memory for long-lived PWA sessions.
- **Mutations must invalidate the cache.** `invalidateQuestion(id)` clears all per-question caches AND the `accessibleQuestionsCache`. Call after every successful vote, close, reopen, and cutoff.
- **`discoverRelatedQuestions` must invalidate the accessible questions list when it adds new IDs.** Otherwise subsequent `getAccessibleQuestions()` calls return a stale list missing the new questions.
- **Forgotten questions must stay forgotten across discovery.** `forgetQuestion` removes a question from `accessible_question_ids` AND adds it to `forgotten_question_ids` in localStorage. Discovery (`lib/questionDiscovery.ts`) filters forgotten IDs out of its `newQuestionIds` list — otherwise the server's follow_up walk re-adds them on the next navigation, unforgetting the question. `addAccessibleQuestionId` clears the forgotten marker, so visiting the URL directly still re-grants access (consistent with the "URLs grant access" model). Reserve `addAccessibleQuestionId` for *explicit* access grants (question/thread page visit, creator flow) — discovery callers must gate on `getForgottenQuestionIds()` before calling it.
- **`getAccessibleQuestions`'s cache-freshness check is asymmetric.** It re-fetches when any accessible ID is *missing* from the cache (a new question was discovered) but does NOT detect *stale extras* (a question the user removed). So every removal mutation — forget, revoke, etc. — MUST call `invalidateQuestion()` / `invalidateAccessibleQuestions()` itself; the next `getAccessibleQuestions()` call will happily return a stale cache containing the removed question.
- **Discovery's 60s TTL can mask re-add bugs.** `discoverRelatedQuestions` keys its cache by the sorted accessible-ID list, so a "forget" flow may appear to work on the *second* attempt while silently failing the first: after the first forget, the ID list changes and discovery fires fresh (re-adds the forgotten question via the server's follow_up walk); on the next forget the ID list matches the cache entry and discovery short-circuits, so no re-add happens. When you see "second try works but first doesn't", check discovery's TTL cache before assuming a race.
- **Coalesce concurrent API calls** with `coalesced()` in `lib/api.ts`. React StrictMode double-mounts effects in dev, causing two simultaneous calls to the same endpoint. Same idiom for `discoverRelatedQuestions` and `getAccessibleQuestions` — both use an in-flight promise to dedupe.

### Production build testing on dev droplet

- To test with a real production bundle instead of `next dev` on the dev server:
  ```bash
  bash scripts/remote.sh "fuser -k 3001/tcp; cd /root/dev-servers/<slug> && rm -rf .next && PYTHON_API_URL='http://localhost:8001' npm run build && nohup npx next start -p 3001 > nextjs-prod.log 2>&1 &"
  ```
- **Patch `next.config.ts` first** — as mentioned above, production mode ignores `PYTHON_API_URL`. Add an early return at the top of `getApiRewriteDestination()`: `if (process.env.PYTHON_API_URL) return process.env.PYTHON_API_URL;`
- **The next git push will clobber the build** — the webhook calls `dev-server-manager.sh upsert` which runs `git pull` (resetting `next.config.ts` patch) and starts `next dev` again. For extended testing, be prepared to re-apply the patch and rebuild after each push.

### Client-side rendering from cache pattern

- **Destination pages that are navigated to frequently should initialize state synchronously from `questionCache`.** Example (`app/p/[shortId]/page.tsx`, `app/thread/[threadId]/page.tsx`): the `useState` initializer reads `getCachedQuestionById` / `getCachedQuestionByShortId` and uses the result directly. No loading spinner if cache hit.
- **Call `loadVotedQuestions()` exactly once** for both `votedQuestionIds` and `abstainedQuestionIds` state init. It parses localStorage each call — easy to accidentally call twice in adjacent `useState` initializers.
- **`usePageTitle` dispatches a `pageTitleChange` event** that the template listens for. On first render the template's `questionPageTitle` state is empty; if the page is the target of a view transition, the `<h1>` is missing from the initial snapshot. Fix: in `template.tsx`, initialize `questionPageTitle` synchronously by parsing the pathname and looking up the cached question's title.
