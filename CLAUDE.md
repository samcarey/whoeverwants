# WhoeverWants Development Environment

## Project Overview

**WhoeverWants** is an anonymous questioning application for group decision-making. Users create and vote on questions without accounts or sign-ups, sharing via link.

- **Live site**: https://whoeverwants.com
- **Repository**: https://github.com/samcarey/whoeverwants
- **License**: Dual MIT / Apache 2.0

## Active Plan

The Supabase-to-Python migration and infrastructure improvements (Phases 1-10) are complete. The current architecture is: Vercel (frontend) + DigitalOcean droplet (FastAPI API + PostgreSQL).

**Next major change: poll redesign.** Every question becomes a poll wrapping one or more questions. A category bubble bar (one bubble per `BUILT_IN_TYPES` entry plus "Other" — `BUBBLE_ENTRIES` in `app/create-poll/page.tsx`) replaces the single "+" FAB on groups. Tapping a bubble seeds a fresh draft with that category preselected and opens the new-question modal.

> **Historical note on What/When/Where:** Earlier iterations of the redesign shipped a 3-bubble bar (What/When/Where) that preselected via `?mode=time` / `?category=restaurant`. That trichotomy was eliminated; references to "What/When/Where" in Phase 2.3 / Navigation Layout / Always-On Draft Poll Card sections below are historical context, NOT the current UI. The current bar is per-category.

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

**Full-Stack Dev Servers** (auto-deployed per-branch on push, hosted on the Mac mini — see the "Mac Mini Dev Box" section below for the architecture):
1. **Write code** in this environment (Claude Code sandbox)
2. **Commit and push** to GitHub
3. GitHub webhook on the Mac creates/updates the dev server for THIS branch
4. Your dev site URL is derived from the branch name: `<branch-slug>.dev.whoeverwants.com`

Each dev server gets its own:
- **Next.js frontend** on port 3001-3010 (in-VM, fronted by Caddy)
- **FastAPI backend** on port 8000 (container-internal)
- **PostgreSQL database** (separate DB in the shared PostgreSQL container, named `dev_<branch_slug_underscored>`)
- **All migrations from the branch** auto-applied on creation and update

**Production Frontend** (Vercel):
- Vercel auto-deploys on push to `main` → `whoeverwants.com`

**Production Backend** (Python API on droplet — auto-deployed on push to main):
- Merging/pushing to `main` auto-triggers: git pull → Docker rebuild → migration check → health verify
- Deploy logs: `bash scripts/remote.sh "tail -50 /var/log/dev-webhook.log" /root`
- Manual rebuild: `bash scripts/remote.sh "docker compose up -d --build" /root/whoeverwants`
- API logs: `bash scripts/remote.sh "docker compose logs --tail 100" /root/whoeverwants`
- **Auto-deploy can silently fail on uncommitted local mods.** The webhook does a plain `git pull`; if the droplet's `/root/whoeverwants` checkout has any unstaged file (typically `scripts/dev-server-manager.sh` after a hotfix), the pull aborts with `error: Your local changes to the following files would be overwritten by merge`, the webhook logs the failure but the deploy "completes" with no rebuild. Vercel meanwhile auto-deploys the new FE → FE/API contract drift. Symptom from a recent occurrence (#290 deploy stuck): every `POST /api/polls` with `group_id: <uuid>` came back with a brand-new group_id in the response — the old server didn't read `group_id` at all (still expected the retired `follow_up_to` field), so polls "disappeared" into freshly-minted groups. Diagnostic: `tail /var/log/dev-webhook.log | grep -A3 'Git pull failed'` to spot the blocking file; on the droplet, `cd /root/whoeverwants && git status` to confirm; `git log --oneline -3` to confirm the actual deployed commit. Fix: stash the local diff, `git pull`, apply any pending migrations, `docker compose up -d --build`. Recovery for orphaned data: any group minted while the deploy was stale needs to be merged into its intended group (`UPDATE polls SET group_id = <real> WHERE group_id = <orphan>`, then `DELETE FROM groups WHERE id = <orphan>`).
- **Defensive log when requested `group_id` is unknown.** `_resolve_or_create_group` in `server/routers/polls.py` emits a `WARNING` when `req.group_id` is provided but no matching `groups` row exists. The mint-fresh-group fallback is intentional (per the function's docstring) but a sustained stream of these warnings is a tripwire for: (a) a stale deploy missing a schema migration, (b) the FE sending a stale/cached group_id from before a forget+re-discover cycle, (c) cross-group races. Surface via `bash scripts/remote.sh "docker compose logs --tail 200 api | grep 'group_id'"` when investigating "polls landing in the wrong group" reports.

You do NOT need SSH — all server management goes through `scripts/remote.sh`.

**Per-Branch Dev Servers** (automatic on push, hosted on the Mac mini Colima VM):
- Every push to GitHub auto-creates/updates the dev server FOR THE PUSHED BRANCH via the Mac webhook (recreates the container so env/labels are fresh)
- Frontend uses `next dev` with `PYTHON_API_URL` pointing to the in-container API
- API runs via `uv run uvicorn` with `DATABASE_URL` pointing to the per-branch dev database
- Migrations from the branch are auto-applied to the dev database on each update
- **After pushing, wait for the dev server to be ready.** The server takes ~30-60 seconds (longer on first push for a brand-new branch: full git clone + `npm ci` + `uv sync`). Question with `bash scripts/remote-mac.sh "curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>"` until it returns 200, or just hit the public URL.
- URL is derived from the branch name (DNS-label-safe slug): `<branch-slug>.dev.whoeverwants.com`
  - Example: branch `claude/migrate-foo` → `https://claude-migrate-foo.dev.whoeverwants.com`
  - Slug rules: lowercase, non-[a-z0-9-] → `-`, runs collapsed, trimmed, truncated to 50 chars
- URL changes per branch — switching branches means a new URL. Bookmarking your CURRENT branch's URL is fine but stale once you cut a new branch.
- The `main` branch is explicitly skipped (it's the prod branch on the droplet; never aged out by 7d-idle, would consume resources forever).
- Author emails are no longer used as a signal; bot-authored pushes get a dev server like any other push.
- Dev servers are fully isolated — each has its own container, API, and database.
- **Lifecycle**: auto-cleaned after 7 days of inactivity, OR immediately destroyed when the branch is deleted from GitHub (the `delete` event triggers `destroy <branch>`). When the branch is deleted: container + volume + Postgres DB + Caddy snippet are all torn down.

```bash
# List active dev servers (one row per branch)
bash scripts/remote-mac.sh "bash /opt/scripts/dev-server-manager.sh list"

# Manually trigger a dev server update for a branch
bash scripts/remote-mac.sh "bash /opt/scripts/dev-server-manager.sh upsert claude/my-branch" / 600

# Destroy a dev server by branch name (also drops its DB / volume / Caddy snippet)
bash scripts/remote-mac.sh "bash /opt/scripts/dev-server-manager.sh destroy claude/my-branch"

# Destroy by raw slug (when the branch name is no longer known)
bash scripts/remote-mac.sh "bash /opt/scripts/dev-server-manager.sh destroy-slug claude-my-branch"

# Check dev container logs
bash scripts/remote-mac.sh "docker logs whoeverwants-dev-<slug> --tail 50"

# Check dev API logs (inside the container's /repo volume)
bash scripts/remote-mac.sh "docker exec whoeverwants-dev-<slug> tail -50 /repo/api.log"
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

## Mac Mini Dev Box

The dev-server side of the system runs on a Mac mini at home (`samcarey@mini4`, public IP `65.28.10.210`, Apple M4, 32 GB RAM, macOS 26). Production API stays on the droplet — only per-branch dev servers run here.

**Status: dev-server-manager ported + rekeyed to per-branch, end-to-end working.** Running:
- Colima VM (Apple Virtualization Framework, 6 CPU / 12 GB / 80 GB) as Claude's sandbox
- Per-hostname HTTPS at `*.dev.whoeverwants.com` via home-router port forwarding (80/443) → Caddy on Mac → containers in VM
- DDNS (launchd → AWS Route 53) keeping both `mac-test.dev` and the `*.dev` wildcard A records self-healing
- `cmd-api.dev.whoeverwants.com` — Claude→VM control endpoint, same model as droplet's cmd-api
- `webhook.dev.whoeverwants.com` — GitHub push + delete receiver, HMAC-verified, dispatches to `dev-server-manager.sh`
- `mac-test.dev.whoeverwants.com` — placeholder serving nginx
- Postgres 16 in VM (persistent volume, network-only) — one DB per branch
- One `whoeverwants-dev-<branch-slug>` container per open branch (Next.js + uvicorn together) spawned by `dev-server-manager.sh`

**Where to look:**
- `docs/mac-mini-setup.md` — full reproduction guide
- `docs/mac-mini-next-steps.md` — historical record of the deferred decisions; this branch resolves them
- `scripts/mac-mini/` — production source files (cmd-api.py, webhook.py, Dockerfiles, ddns, Caddyfile, compose, LaunchAgent plists, dev-server-manager.sh, devserver-entrypoint.sh, caddy-watch.sh)
- `scripts/remote-mac.sh` — analogous to `scripts/remote.sh`; drives cmd-api over HTTPS
- `scripts/mac-deploy.sh` — file-deploy helper (uses cmd-api + colima's `/Users` auto-mount to write `~/devbox/`)

**Calling cmd-api on the Mac mini** (analogous to `bash scripts/remote.sh` for the droplet) — set in your shell:
```
export MAC_API_URL=https://cmd-api.dev.whoeverwants.com
export MAC_API_TOKEN=<CMD_API_TOKEN value in ~/devbox/.env on the Mac>
bash scripts/remote-mac.sh "hostname; docker ps"
```

The cmd-api lives in the VM, not on the Mac host. **Mac filesystem access from the VM**: Colima auto-mounts `/Users` into the VM RW via virtiofs, so cmd-api can read/write `~/devbox/` (and `~/Library/LaunchAgents/`) by spawning a sibling container with `-v /Users:/Users`. Anything outside `/Users` (notably `/opt/homebrew/etc/Caddyfile`) is not reachable from the VM and needs a Mac-side action. `scripts/mac-deploy.sh` encapsulates the `/Users` write pattern.

**Per-branch dev server architecture**:
- Each open branch = one Docker container `whoeverwants-dev-<branch-slug>` running Next.js (port 3000) + uvicorn (port 8000) together
- Per-branch Docker volume `whoeverwants-dev-repo-<branch-slug>` mounted at `/repo` preserves node_modules / .venv / .next across restarts within a branch's lifetime
- Per-branch Postgres DB `dev_<branch_slug_underscored>` in the shared `devbox-postgres-1` container; migrations applied by the manager from the branch's checkout
- Container's port 3000 published to VM `127.0.0.1:<3001-3010>`; Colima auto-forwards to Mac `localhost:<same port>`
- Caddy snippet at `~/devbox/caddy.d/<branch-slug>.caddy` routes `<branch-slug>.dev.whoeverwants.com` to that port; the `com.devbox.caddy-watch.plist` LaunchAgent polls the dir every 5s and runs `caddy reload`
- `dev-server-manager.sh` runs inside cmd-api OR webhook (both mount `/host-caddy.d`) and orchestrates the lifecycle. Lives at `~/devbox/scripts/dev-server-manager.sh` on the Mac, mounted at `/opt/scripts/dev-server-manager.sh` inside the containers.
- Webhook receives the GitHub `push` event and calls `bash $MANAGER_CMD upsert <branch>`; receives the GitHub `delete` event (or a `push` payload with `deleted: true`) and calls `bash $MANAGER_CMD destroy <branch>`. Failures are logged + swallowed. The `main` branch is filtered out on both paths (production-only; the manager double-enforces).
- Branch-name slugification (in `branch_to_slug`): lowercase → non-`[a-z0-9-]` → `-` → collapse `-` runs → trim → truncate to 50 chars. So `claude/migrate-foo` becomes `claude-migrate-foo`; the resulting hostname is `claude-migrate-foo.dev.whoeverwants.com`.

**GitHub webhook subscription**: must include BOTH `push` AND `delete` events. The legacy migration enabled only `push`; the `delete`-event branch teardown only fires when the subscription is widened (Webhooks → Edit → Individual events → "Branch or tag creation/deletion"). Without the subscription update, deleted branches age out via the 7d-idle path instead of being torn down immediately.

**Cutover from per-author keying**: the per-branch manager uses the same container-name prefix (`whoeverwants-dev-`) and same volume prefix (`whoeverwants-dev-repo-`) so legacy per-author entries are visible to `list` / `destroy-all`, but their slugs no longer correspond to any branch. Run once at deploy time to wipe them: `bash scripts/remote-mac.sh "bash /opt/scripts/dev-server-manager.sh destroy-all"`. After that, the next push to each branch repopulates per-branch.

**Operational commands** (via remote-mac.sh):
```bash
bash scripts/remote-mac.sh "bash /opt/scripts/dev-server-manager.sh list"
bash scripts/remote-mac.sh "bash /opt/scripts/dev-server-manager.sh destroy <branch>"          # by branch name
bash scripts/remote-mac.sh "bash /opt/scripts/dev-server-manager.sh destroy-slug <slug>"      # by raw slug
bash scripts/remote-mac.sh "docker logs whoeverwants-dev-<branch-slug> --tail 50"
bash scripts/remote-mac.sh "docker exec devbox-postgres-1 psql -U whoeverwants -c '\\l'"
```

**Pitfalls learned during the port:**
- **`docker build` from cmd-api reads context from cmd-api's filesystem, not the daemon's.** The cmd-api container has only `/var/run/docker.sock` mounted — no `/Users`. To build images that reference Mac files, spawn an intermediate `docker:cli` sidecar that has BOTH `-v /Users:/Users` and `-v /var/run/docker.sock:/var/run/docker.sock`; build from there. Used in `mac-mini-setup.md` step 8 for the dev-server image build.
- **Bind paths in `docker-compose.yml` are interpreted by the daemon, NOT by the docker CLI's CWD.** When invoking compose from a sidecar with `-v /Users:/Users`, set the sidecar's working directory to the **daemon-visible path** (`-w /Users/sccarey/devbox`), not a remapped one (`-w /devbox`). Otherwise relative `./scripts` resolves to `/devbox/scripts` and the daemon can't find it. `compose config` is the canonical sanity check — confirm `source:` fields match real VM paths before running `up -d`.
- **Recreating cmd-api kills the in-flight cmd-api request.** When `docker compose up -d cmd-api` runs from inside cmd-api, the stop step terminates the requesting process mid-flight. Workaround: launch the recreate from a detached sidecar (`docker run -d`) — the sidecar is a sibling container and survives cmd-api's restart. Wait ~15s, then verify via `hostname` (returns a fresh container hostname).
- **`docker exec ... --format '{{ ... }}'` quoting through cmd-api eats braces.** When cmd-api hands the cmd to `subprocess.run(cmd, shell=True)`, embedded `{{ }}` survives, but single-quoted Go templates inside single-quoted shell arguments can produce empty stdout (no JSON parse → remote-mac.sh's `json.load` fails on empty body). Workaround: switch the outer quotes to `"` and pass the inner braces literally — or use `--format` with no quoting and pipe through `head -c N`.
- **Smoke-test sidecars need the same mounts as cmd-api.** When running `dev-server-manager.sh upsert` from an ad-hoc `docker run` sidecar (for testing), include both `-v /Users:/Users` (so it can read repo state on the Mac) AND `-v /Users/sccarey/devbox/caddy.d:/host-caddy.d` (so caddy snippet writes land in the real Mac-visible dir). The production path goes through cmd-api or webhook which both have these mounts baked in via `docker-compose.yml`.
- **Per-branch volume + bootstrap-marker race on re-upsert.** The manager polls for `/repo/.dev-server-ready` to know when the dev-server is up. If a previous run left the marker file in the per-branch volume, the new run sees it immediately and skips waiting. Today this is harmless because the entrypoint deletes the marker on startup and the manager's downstream steps (caddy snippet write, migration apply) are idempotent. If you add side effects that need actual "this container is up RIGHT NOW", delete the marker via a one-shot `docker run --rm -v $volume:/repo alpine rm -f /repo/.dev-server-ready` BEFORE launching, then wait for it to reappear.
- **Caddy `import` only supports ONE wildcard per glob.** `import /Users/*/devbox/caddy.d/*.caddy` is rejected with `Glob pattern may only contain one wildcard (*), but has others`. Hardcode the user portion: `import /Users/sccarey/devbox/caddy.d/*.caddy`. The username is fixed per Mac install anyway, so no real flexibility lost.
- **Two GitHub webhooks during/after migration: droplet handles prod-deploy, Mac handles dev upserts/destroys.** The droplet's `dev-webhook.service` was patched in-place to short-circuit non-`main` pushes (returns `dev-side-on-mac` JSON, no upsert). The Mac webhook explicitly SKIPS the `main` branch on both push and delete (matching the manager's `SKIP_BRANCHES`) so a push to main doesn't create a `main.dev.whoeverwants.com` dev server alongside production. Both webhooks fire on every push; each handles only its scope. Don't remove the droplet webhook — production auto-deploy still runs there. If the patch on the droplet ever drifts (`/root/whoeverwants/scripts/dev-webhook.py`), the patch marker is the `if branch != "main":` early-return block right after `log.info(f"Push to {branch} by {emails}")`.

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
│   │   └── page.tsx                # Question loader → resolves to GroupContent
│   ├── group/[groupId]/page.tsx   # Group view (questions in follow-up chain)
│   ├── question/page.tsx               # Alternate question endpoint
│   ├── settings/page.tsx           # User settings (name, location, clear data)
│   └── api/                        # Server-side API routes
│       ├── test-pushover/          # Push notification testing
│       └── notify-claude-input/    # Claude notification integration
│
├── components/                     # 30 React components
│   ├── QuestionBallot.tsx           # Per-question ballot UI (mounted inside group cards)
│   ├── QuestionBallot/
│   │   └── voteDataBuilders.ts     # buildVoteData + buildPollVoteItem (shared by QuestionBallot + group page)
│   ├── GroupHeader.tsx            # Fixed group header with back arrow + respondent circles
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
│   ├── GroupList.tsx              # Home page group list (messaging-style)
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
│   ├── groupUtils.ts              # Group grouping/sorting from poll-level follow_up_to chains
│   ├── questionListUtils.ts            # Shared question display utilities (relativeTime, badges, icons)
│   ├── votedQuestionsStorage.ts        # localStorage voted/abstained question parsing
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
│   ├── useDayTimeWindowsState.ts   # Shared add/remove/edit handlers + removed-day cache for time-question day lists
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

### Grouped Messaging UI

- **Main page shows groups**, not individual questions. A group is a flat list of polls sharing a `polls.group_id` (Migration 105 retired the `polls.follow_up_to` chain pointer). `lib/groupUtils.ts: buildGroups` groups polls by `group_id` and sorts by `created_at` — no chain walking. Sub-questions of one poll are siblings inside the same poll wrapper.
- **Group title** defaults to the deduplicated list of participant names (`creator_name` + `voter_names` from the API). Users can override it via `/g/<id>/edit-title` → `POST /api/groups/<route_id>/title`. The override is stored in `groups.title` (one row per group, single source of truth — Migration 105 moved it off `polls.group_title`). `Group.title` reads `latestPoll.group_title` (server surfaces `groups.title` on every poll in the group via JOIN) and falls back to `Group.defaultTitle` (the names string) when NULL. `apiUpdateGroupTitle(routeId, title)` invalidates every poll in the group automatically — callers don't have to re-implement the cache cleanup ritual.
- **Group sorting**: groups with unvoted open questions first (by soonest deadline), then groups with no unvoted questions (by most recent activity).
- **Group URLs split path + query.** Canonical form is `/g/<groupShortId>?p=<pollShortId>`: path is the group root's short_id (or root question id when no short_id), query names the poll to auto-expand and scroll to. Empty placeholder is bare `/g/`. Sub-routes `/g/<groupShortId>/info` and `/g/<groupShortId>/edit-title`. Legacy `/p/<id>` URLs (and `/p/<id>/info`, `/p/<id>/edit-title`) live as redirect stubs that resolve the ambiguous id (poll short_id / poll uuid / question uuid) once and `router.replace` into the canonical `/g/...` form — see `app/p/[shortId]/_legacyRedirect.tsx`. Three URL-builder helpers in `lib/groupUtils.ts`: `getGroupHref(group)` for the home list (auto-expand only when there's awaiting work), `getGroupHrefForPoll(poll)` for "navigate to this poll's group with this poll expanded" (used by FollowUpHeader, GroupCardItem copy-link, /g/ ?id= handler, and the legacy /p/ redirects), and `resolveGroupRootRouteId(poll)` for just the group-root part. The `POLL_QUERY_PARAM` constant in `lib/groupUtils.ts` names the `?p` key.
- **Auto-expand is encoded by the URL itself, not heuristics.** `?p=<id>` present → expand that poll; absent → no expand, page scrolls to bottom (the draft-form area). The old `?group=1` flag and the `suppressExpand` "user has responded to every question" heuristic are gone — the URL is the source of truth. URL sync on expand swaps `?p=` via shallow `history.replaceState`, never touching the path; sharing the URL reopens the same expanded card.
- **Group URL targets the oldest open+unresponded poll, falling back to newest.** `getGroupHref(group)` builds the link the home list uses: returns `/g/<root>?p=<targetPoll>` when `group.unvotedCount > 0` (auto-expand the awaiting poll on landing), else `/g/<root>` (no expand, scroll to bottom — done state, encourage starting a new poll). The targeted poll is computed by `pickTargetedPoll` in `lib/groupUtils.ts`: among polls where the viewer has at least one un-responded question, pick the oldest by `created_at`; otherwise pick the newest poll. Two helpers encapsulate the rules: `isPollOpen(poll, now?)` (not closed AND deadline-not-passed) and `pollHasAwaitingQuestion(poll, voted, abstained, now?)`. Use them whenever you need either rule — don't re-inline the `is_closed`/`response_deadline`/`some(...)` math.
- **Floating bubble bar auto-follows-up** when on a group page via `document.body.getAttribute('data-group-latest-question-id')` — the group page sets this attribute on mount. The home page does NOT render the bubble bar; it has the single "+" FAB instead, which navigates to `/g/` (the empty placeholder). `/g/` shows the bubble bar (since `isGroupRootView` matches it); the user picks a category from there. If the user dismisses the modal without submitting, the empty placeholder remains visible with the bubble bar; tapping back returns to home. On submit from the empty placeholder, the new question has no `follow_up_to` so it becomes its own group root.
- **Shared utilities**: `lib/questionListUtils.ts` (relativeTime, getCategoryIcon, badges), `lib/votedQuestionsStorage.ts` (loadVotedQuestions), `lib/timeUtils.ts:formatCreationTimestamp` (absolute "@ h:mm AM M/D/YY" timestamp used in the tooltip + the expanded card). QuestionList keeps its own full-featured `getResultBadge` with user-specific participation messages.
- **Long-press a group on home → bulk-forget selection mode.** `components/GroupList.tsx` arms a 500ms `setTimeout` from `onTouchStart` (manual setTimeout, NOT `useLongPress` — the existing handlers need touch events for scroll detection + synthetic-click suppression, and `useLongPress` is pointer-event-based). Firing the timer enters selection mode with the long-pressed group pre-selected; haptic via `navigator.vibrate(50)`. While in selection mode every `GroupListItem` renders a circular checkbox (left of `RespondentCircles`); taps toggle selection instead of navigating. Cancel (X) + red trashcan are rendered via `<HeaderPortal>` (target `#header-portal` in `app/layout.tsx`, outside `ResponsiveScaling`) — same target the settings-page back arrow uses. The X button visually replaces the home page's gear icon by sitting at the same coords with `z-50`. Trashcan opens a `<ConfirmationModal>`; on confirm `forgetGroup(group)` (in `lib/forgetQuestion.ts`) loops the group's questions through `forgetQuestion` then fires `apiLeaveGroup(groupId ?? rootPollId)` to drop server-side membership. Selection mode does NOT auto-exit when `selectedGroupIds` empties — only the cancel button or Escape exits (matches the user spec: "Unchecking all items should not cancel edit mode"). Pitfalls when extending: (a) `onGroupsForgotten` carries every poll-id in every forgotten group, NOT just root ids — a group is multiple polls sharing `group_id`, so filtering the parent's `polls` by root id alone leaves follow-ups behind and `buildGroups` rebuilds a ghost group; (b) the home page applies an optimistic `setPolls(prev => prev.filter(...))` instead of awaiting `getMyGroups()` — `forgetGroup` already invalidates the per-question + accessible-polls caches via `invalidateQuestion`, so the next natural refresh re-syncs without an extra round-trip; (c) don't add a `portalReady` mount-flag pattern around `<HeaderPortal>` — the portal already encapsulates that via its own `mounted` state.
- **Backend**: `voter_names` field on accessible questions response — extracted from already-fetched votes when possible, DB query only for remaining open questions.
- **Group page uses document scroll with a fixed header.** The header is `position: fixed; top: 0` and the content below reserves a matching `padding-top` via a `ResizeObserver` that measures the header. Nothing flex-col wraps the content — the body is the scroller. When adding new fixed page chrome, put it in the template or portal it out; don't introduce inner scroll containers.
- **`useGroup(groupId)` is the canonical group loader** (`lib/useGroup.ts`). Returns `{group, loading, error}`. Initializes synchronously from the in-memory cache via `buildGroupSyncFromCache` (from `lib/groupUtils.ts`) and only falls through to the async fetch path on cache miss — so cache hits don't trigger redundant `apiGetGroupByRouteId` / `getAccessiblePolls` round-trips. Also writes `data-page-ready` on `<html>` so view transitions capture a fully-rendered snapshot. Use this hook for any new page that needs the group for a route id; don't re-implement the cache-first + fallback pattern inline.
- **Group sub-routes:** `/g/<id>/info` (participant list + total count, with Back/Edit buttons) and `/g/<id>/edit-title` (input to set/clear the `group_title` override). These render their own fixed headers and read `params.groupShortId`. `isGroupRootView(pathname)` in `lib/questionId.ts` distinguishes the root view (`/g` or `/g/<id>`, gets the group-like FAB + bottom padding) from sub-routes (plain layout, no FAB) via the regex `^\/t(\/[^/]+)?\/?$`. Update that helper when adding more group sub-routes. The legacy `/p/<id>/info` and `/p/<id>/edit-title` routes are thin redirect stubs (`LegacyRedirectPage` from `app/p/[shortId]/_legacyRedirect.tsx`).
- **Empty placeholder route:** `/g/` (no groupShortId) is the empty-group route surfaced by tapping the home page's "+" FAB. Implemented as `app/g/page.tsx` with two roles: with `?id=<question-uuid>` (legacy deep-link form) it resolves the question → its poll → its group root and `router.replace`s to `/g/<root>?p=<pollShort>` via `getGroupHrefForPoll`; with no params it renders `EmptyPlaceholder` (shared `GroupHeader` with `title="New Group"`, instructional message, `<div id="draft-poll-portal" />` for `CreateQuestionContent`). The placeholder matches `isGroupRootView`, so the category bubble bar (in the draft poll card) is rendered — the user picks a specific category bubble from there to open the new-question modal. The group "materializes" only when the user actually creates a question.
  - **Pitfall: `text-center` on the wrapper around `DRAFT_POLL_PORTAL_ID` cascades into the portaled draft poll card.** The placeholder copy ("Create a question and then share the link!") is centered, but the portal target div lives in the same wrapper, and CSS `text-align` inherits — so every form field, saved-question title, and label inside the draft poll card gets centered too. Scope `text-center` to the placeholder `<p>` itself, not the enclosing div. Same caution applies any time a portal target sits next to deliberately-centered placeholder content.
- **`GroupPageInner` is the resolution wrapper** at the bottom of `app/g/[groupShortId]/page.tsx`. The path id is unambiguously a poll short_id / poll uuid (the group root) — no question-uuid cascade. Synchronously resolves to a Poll from `questionCache` via `useMemo([groupShortId])`; falls back to async `apiGetPoll{ById,ByShortId}` (404 → `setError`) on cache miss. Reads `?p=<pollShortId>` via `useSearchParams` and resolves it to `initialExpandedQuestionId` (the poll's first question id) via the same cache lookup. Legacy `/p/<id>` URLs with arbitrary ids (poll short_id, poll uuid, OR question uuid) resolve via `app/p/[shortId]/_legacyRedirect.tsx` → 302 to canonical `/g/<root>?p=<pollShort>` before this component mounts. Don't reintroduce question-uuid resolution into `GroupPageInner` — handle it in the redirect stub if a new legacy form needs supporting.
- **Helpers for cache-walk + URL-build patterns:** `lib/groupUtils.ts: resolveGroupRootRouteId(poll)` walks `poll.follow_up_to` via `getCachedAccessiblePolls()` to find the group root and returns its route id (short-circuits when `poll.follow_up_to` is null). `lib/groupUtils.ts: getGroupHrefForPoll(poll)` returns `/g/<root>?p=<pollShort>` — the canonical "navigate to this poll's group with this poll expanded" URL. `lib/questionCache.ts: getCachedPollForShortId(id)` resolves an ambiguous id (poll uuid / poll short_id / question uuid) to a cached Poll. Use these whenever you need either pattern — don't re-inline the `getCachedAccessiblePolls + buildPollMap + findGroupRootRouteId` triplet or hand-roll the `?p=` URL.
- **Pitfall: `addAccessibleQuestionId` only accepts question ids.** It persists to localStorage's accessible-question list. Passing a poll uuid corrupts the list silently (the entry never resolves on subsequent loads, since lookups go through `apiGetQuestionById` → 404). When extracting the "first question id" from a Poll for access registration, guard with `if (firstQ)` rather than falling back to `poll.id`.
- **Shared `GroupHeader` component** lives at `components/GroupHeader.tsx`. Props: `headerRef`, `title`, optional `participantNames` + `anonymousCount` (renders `RespondentCircles` when provided), optional `subtitle`, optional `onTitleClick` (makes the title block a button when provided), optional `onBack` (defaults to navigating to `/`), optional `rightSlot` (renders an action node on the right; when provided, the right padding tightens from `pr-4` to `pr-2`). The title is always left-justified within its `flex-1` container. Used by `GroupContent` (real-group props), `EmptyPlaceholder` in `app/g/page.tsx` (just `title`), the `/info` sub-route (`onBack` + `rightSlot=<Edit button>`), and the `/edit-title` sub-route (`onBack` + `rightSlot=<Save button>`). Don't re-implement the fixed `top:0 + padding-top:env(safe-area-inset-top) + headerRef + back button` markup in another route — extend `GroupHeader` or import it.
- **Group page back button always navigates to `/`**, regardless of in-app history. Earlier the button used `hasAppHistory() ? navigateBackWithTransition() : navigateWithTransition('/')`, but after creating a question on `/g/`, the prior history entry was the now-empty placeholder — back popped the user back to it instead of home. Hard-coding `'/'` is the cleanest fix and matches the user's mental model ("back from a group → main list"). The `/info` and `/edit-title` sub-routes still use the conditional-back pattern because their natural back target is the group, not home.
- **`useEffect(..., [])` + conditional early return = ref never attaches.** When a page renders a loading placeholder on first paint and then swaps to the real content after an async load, an effect with empty deps runs once on the first render — when the real refs don't exist yet — and never re-fires, so observers like `ResizeObserver` silently fail to attach. Fix: gate the real content behind an inner component that only mounts when data is ready (`if (loading) return <Loading/>; return <Inner {...}/>`). Effects inside `Inner` then run against refs that definitely exist. Used in `app/g/[groupShortId]/info/page.tsx` and `.../edit-title/page.tsx`.
- **`useMeasuredHeight(deps?)` (`lib/useMeasuredHeight.ts`) is the canonical hook for the fixed-header padding-top compensation pattern.** Returns `[ref, height]`. Pass `[loaded]` as deps when the element is gated behind a loading early return inside the same component (e.g. `GroupContent` passes `[group]`); use the default `[]` when the element mounts once with the component (e.g. `EmptyPlaceholder`, `Info`, `Editor` — those gate the placeholder at the parent level so their inner component only mounts post-load). Don't re-inline `useLayoutEffect + ResizeObserver + offsetHeight` in new group chrome.

### Expandable Question Cards (Group View)

- **One component, one route.** `GroupContent` (exported from `app/g/[groupShortId]/page.tsx`) renders the group list. `GroupPageInner` (in the same file) resolves the URL params and mounts `GroupContent` with `initialExpandedQuestionId` set to the `?p=` poll's first question (or null when `?p=` is absent → no auto-expand). There is no longer a standalone question page — `QuestionBallot` is only rendered inline inside an expanded card.
- **Template treatment of group-family pages.** The template computes `isGroupLikePage = isGroupRootView(pathname)` (matches `/g`, `/g/`, `/g/<id>`, `/g/<id>/` but NOT sub-routes) and uses it for layout (flex-col overflow-hidden, no duplicate header/back button). A separate `isGroupFamilyPage` covers the broader "any /g/* OR /p/* (legacy redirect)" check used by the fallback header gate so neither canonical nor redirecting pages get the template's centered title bar. The copy-link button is rendered per-card in the upper-right of each card's compact header (visible whether collapsed or expanded), not at the page-corner level, so users can copy a poll's share link directly from the group view without navigating away. The title uses `flex-1 min-w-0` alongside the `shrink-0` button wrapper so it wraps (line-clamp-2) before colliding with the button. Tap-to-expand is gated off the button via `stopPropagation` on the button wrapper's click/touch events.
- **URL sync without remount.** On expand we call `window.history.replaceState` to swap the URL to `/p/<expanded-poll>/` without triggering a Next.js navigation. On collapse we leave the URL alone — the user's mental model is "I'm viewing this poll" so the just-collapsed poll stays in the URL. (Earlier the collapse branch wrote `/group/<root>/`; that fallback was removed when the `/group/` route went away.) CLAUDE.md warns that `history.replaceState` + App Router back-nav can fight, but here it's only for URL display (the browser's own back button still pops to the prior real history entry).
- **Content-fade expand animation.** Height is animated via CSS grid: the wrapper transitions `grid-template-rows` between `0fr` and `1fr`, and a child clipping div clips the pre-mounted content. The clip uses **`overflow-y: clip; overflow-x: visible; min-h-0`** (NOT `overflow: hidden`) so per-question category icons can hang to the LEFT of the card without being clipped horizontally, while the height-collapse animation still works vertically. Two non-obvious requirements:
  1. **`overflow: clip` (not `hidden`)** is required for the per-axis split. The legacy CSS rule that coerces `overflow-x: visible; overflow-y: hidden` to `overflow-y: auto` does NOT apply when `clip` is used; the spec was authored specifically to give us a per-axis non-scroll-creating clip.
  2. **`min-h-0` on the grid item** is mandatory. `overflow: hidden` establishes a Block Formatting Context which gives the box a 0 intrinsic height under `grid-template-rows: 0fr` — that's why the original `overflow-hidden` wrapper collapsed cleanly. `overflow: clip` does NOT establish a BFC, so the grid item retains its default `min-height: auto` (= intrinsic content height), and the row can't collapse to 0 against the 0fr track. The card stays visually expanded even when React state is collapsed (`aria-hidden="true"`, `grid-rows-[0fr]`). Adding `min-h-0` lets the item shrink against the 0fr track, restoring the animation. Symptom of forgetting this: tapping the title cycles `expandedQuestionId` correctly but the card appears stuck open. If you ever switch a height-collapse-via-grid wrapper between `hidden`/`clip`, audit `min-h-0`.
  3. **`min-w-0` on the grid item is also mandatory** — for the same reason, in the horizontal axis. Without it, the grid item defaults to `min-width: auto` = `min-content` of its children. With `overflow-x: visible`, a long unbreakable string deep inside the expanded card (e.g. a Burger King street address from a location suggestion) propagates its max-content width up through every `min-w-0`-bearing flex layer to land on this grid item's min-content — which then expands the implicit `auto`-sized grid track past the cardFrame's `minmax(0, 1fr)` width and pushes the entire card past the viewport. Symptom: card visibly extends off-screen on mobile when an expanded sub-card has long unbreakable content; respondent pills + status pills clip off the right edge. Confirmed via DOM walk (cardFrame=383px, clip-wrapper-with-`min-width:auto`=622px). Whenever `overflow-x: visible` lives on a grid item, pair it with `min-w-0` so the track can collapse and the inner truncate/ellipsis chains take over.
- **Pre-mount expanded content on viewport entry.** A shared `IntersectionObserver` on the scroll list adds a card's id to `visibleQuestionIds` when it enters the viewport (with a 200px rootMargin). Cards in `visibleQuestionIds` render `QuestionBallot` inside the grid wrapper even while collapsed (so fetches + effects complete before the user taps). Expansion is then instant — the `display`-like change is the grid-rows transition, not a mount.
  - Observer effect depends on `[!!group]`, not `[group]` — otherwise every forget/reopen mutation would tear the observer down and re-observe every card.
  - **Don't `console.log` inside a `setState` updater function.** The log forwarder (`CommitInfo`) intercepts console methods and dispatches a synchronous event that can call `setState` during React reconciliation, producing a "Cannot update a component while rendering" warning. Keep logs in event handlers / effects.
- **Long-press lives on the compact header sub-div**, not the whole card. That way the long-press handler fires for taps on the card background / title / metadata regardless of whether the card is expanded, but presses inside the expanded `QuestionBallot` (voting buttons, Submit Vote, etc.) don't misfire. The same pattern means we don't need to group handlers based on expansion state.
- **Swipe-to-abstain shares the compact header's touch handlers.** Cards that are awaiting (golden border) AND collapsed AND not closed are swipe-eligible: a left-swipe past 30% of card width auto-submits a batched abstain on every un-responded sub-question of the poll via `useGroupVoting.submitSwipeAbstain → apiSubmitPollVotes`. Mechanism: a single shared `swipeRef` (only one card can be swiped at a time) tracks the active gesture; `handleTouchMove` enters swipe mode once horizontal motion exceeds vertical (`adx > ady * 1.5`) AND crosses `SWIPE_DIRECTION_THRESHOLD_PX` (12px) leftward (`dx < 0`), then writes `transform: translateX(...)` directly to the cardFrame DOM ref every frame. The reveal layer (amber "Abstain" word stacked above a left-arrow SVG, right-justified, no background fill — only the text + arrow are colored so the page bg shows through) sits behind the cardFrame inside a positioning wrapper at `col-start-2 row-start-2` and is mounted only when `swipeEligible` so non-awaiting cards can't drag. The card keeps sliding with the finger past the abstain threshold; the "you're committed, release now" signal is the reveal text crossfading from `opacity-50 font-light` to `opacity-100 font-bold` over 200ms when the threshold is crossed. State for the bold flip lives in `swipeThresholdQuestionId` (state, since it drives JSX); ref-based `pastAbstainPoint` still tracks the haptic crossing edge separately. Past threshold on release: animate to `translateX(-cardWidth)` over 220ms, fire `submitSwipeAbstain` AFTER the slide-off completes (so the `isAwaiting` flip and reveal-unmount happen on the next render, not mid-translation), and clear the inline transform synchronously inside the same `setTimeout` so React owns the position again. Below threshold: snap back over 200ms and clear. `swipeJustHandled` mirrors the `touchJustHandled` pattern — set on touchend, cleared after 400ms — so the synthesized click after the touch release doesn't toggle expand. The threshold-cross also fires a 15ms haptic; commit fires a 20ms haptic. Right-swipe never engages (the entry condition gates on `dx < 0`); rightward overshoot during a left-swipe is rubber-banded with a 0.3 multiplier so the gesture feels anchored to leftward intent. The first touchmove that crosses the threshold sets `swiping = true` but does NOT translate that frame — translation kicks in on the next touchmove. On real devices touch events fire ~60Hz so this is invisible; in Playwright simulations it appears as a 1-frame lag, which is fine.
- **Synthetic-click-vs-long-press race.** A long-press that opens the modal fires a touch-release → browser synthesizes a click at the touch position → the click lands on the full-viewport modal backdrop and closes the modal on the same gesture. Fix: `FollowUpModal` timestamps `isOpen` and ignores backdrop clicks for 400ms after opening.
- **Concurrent expand + scroll animation.** Tapping a card below the viewport's useful band should scroll just enough to reveal the bottom of the expanded card, capped so the top never goes behind the fixed header. Two subtleties:
  1. `scrollTo({ behavior: 'smooth' })` gets **clamped by the list's current `scrollHeight`**. During the 300ms grid-rows growth, `scrollHeight` is still smaller than the final value, so a scroll target past the current max silently undershoots. Either defer scroll until `transitionend` (simple, but the scroll lags behind the expand), or manually rAF-animate `scrollTop` over the same 300ms — the clamping stops biting because scroll progress and `scrollHeight` growth happen in lockstep. The group page uses the rAF approach.
  2. The target height is measured from the **overflow-hidden wrapper's `scrollHeight`**, not the card's. `card.scrollHeight` reports the mid-animation laid-out height; the wrapper's scrollHeight reports the natural content height regardless of whether the parent grid row is `0fr` or `1fr`.
- **Compact row height.** The status-line slots (category icon left, countdown/badge right) default to `w-8 h-8` — bumping them up to `w-11` adds ~12px of whitespace above every collapsed card's title. Keep slot sizes small; scale the SVG inside (`w-7 h-7` fits in a `w-8 h-8` button).
- **Poll-card left-column iconography**: the column-1 slot (`col-start-1` of the outer grid) hosts two distinct elements stacked vertically: (1) at the top, a **creator-initials bubble** — `w-7 h-7` rounded-full div using `nameToColor(creator_name)` from `RespondentCircles.tsx` and `getUserInitials(creator_name)` from `lib/userProfile.ts`; falls back to `ANONYMOUS_FALLBACK_COLOR` ('#9CA3AF') + `'?'` for anonymous creators. (2) Below, one or more **per-question category emojis** rendered via the local `HangingCategoryIcon` helper (in `app/g/[groupShortId]/GroupCardItem.tsx`), absolutely positioned at `left: -2.375rem` with `width: 1.75rem` and `top: 0` — placing them in the same column as the creator bubble but anchored at the top of each question's `relative` parent box. **Single-question polls** render exactly one `HangingCategoryIcon` (the parent is the question's section div with `relative`). **Multi-question polls** render one `HangingCategoryIcon` per sub-question (parent is each section's `mb-2 relative` title wrapper). Both paths use the same helper + the same `top: 0` placement so the visual column reads consistently. Inside the `overflow-y: clip` expand wrapper, both the creator bubble (which lives outside it) and the category icons (which live inside) clip cleanly: the creator bubble is in the outer grid and stays visible; the category icons are inside the expand wrapper and hide via the height-collapse animation when the card is collapsed.
  - **`align-items: stretch` is the default for grid items.** A flex container that wraps an explicit-sized child but doesn't itself have a height will stretch to fill its grid row's height. When the row is tall (a fully-expanded card), `flex items-center` then vertically centers the child in the middle of the card — NOT at the top of the row where you want it. Fix: put the explicit height on the grid item itself (e.g. `h-7`), or apply `align-self: start`. The creator bubble was originally a `flex items-center` wrapper around a `w-7 h-7` circle; the wrapper stretched to row-2's height (the whole card), centering the bubble in the middle of the expanded card. Collapsed it to a single `w-7 h-7` element with the grid placement on the circle directly.
  - **Bounding-box centering ≠ visible-glyph centering for emojis.** Most emoji glyphs render in the LOWER half of their line-box, while text glyphs (cap-height) render in the UPPER half. A perfectly bounding-box-centered emoji next to text reads as "too low." For multi-question polls, the per-question icon was briefly biased upward (`top: -6px`) to optically center the emoji's visible area with the title's cap-height. That's removed — now both single-question and multi-question polls use `top: 0` for consistent placement (icon top edge anchored at the question area's top edge), since the user wanted "aligned with the top of the expanded question area" regardless of whether a title is present. If you later need optical-centering, the offset for `text-lg leading-tight` titles is empirically `top: -3px` (visible-text center) or `top: -6px` (cap-height center, more pronounced upward bias).
- **Tap toggles expand/collapse on the compact header only.** There is no collapse chevron — tapping the status line / title / metadata toggles the card. Taps inside the expanded `QuestionBallot` do NOT collapse (we tried bubbling a click handler on the grid wrapper with `target.closest('button, input, ...')` filtering; rejected because the "collapse on non-interactive tap" region was confusing — the user expects the top band, not the whole expanded body). Long-press still opens the follow-up modal regardless of expansion state.
- **Shared cross-component update channel.** When a question is closed/reopened from inside the expanded `QuestionBallot`, it dispatches `window.dispatchEvent(new CustomEvent('question:updated', { detail: { questionId, updates } }))`. The group page listens and merges `updates` into its local `group.questions` state (and any open `modalQuestion`). Without this, the group state stayed stale after close-from-card and the long-press modal didn't show the Reopen row. Guard the `setGroup` updater with `.some()` so no-match events don't allocate a new questions array.
  - **Don't dispatch `question:updated` from the same component that already called `setGroup` for the same question.** The group page's long-press-modal close/reopen flow updates `group.questions` locally; if it ALSO dispatches the event, the component's own listener re-applies the same update (the `.some()` guard only checks the question exists, not whether updates are already applied), forcing a redundant questions-array allocation + re-render. The dispatch is only needed when the mutation originates from a DIFFERENT component (e.g. the old in-card close handler in `QuestionBallot`). Rule of thumb: "dispatch iff you just mutated local state someone else might not have". Close Question was moved to the group-page modal explicitly to avoid this bounce.
- **`QUESTION_VOTES_CHANGED_EVENT` is the sibling channel for vote-list refresh.** After any vote submission/edit, `QuestionBallot` dispatches `window.dispatchEvent(new CustomEvent(QUESTION_VOTES_CHANGED_EVENT, { detail: { questionId } }))` (constant lives in `lib/api.ts`). Every `VoterList` listens and re-fetches if the `questionId` matches. This replaced the previous `refreshTrigger` prop plumbing (state in `QuestionBallot` → through `RankingSection` → into `VoterList`), which double-fired alongside the event for in-card VoterLists and required every new call site to group the state. The event handler + the existing 10s questioning interval cover same-tab and background refresh; no prop wiring needed.
- **Write localStorage BEFORE dispatching `QUESTION_VOTES_CHANGED_EVENT`.** `markQuestionAsVoted` (the function that updates `votedQuestions` in localStorage) used to run AFTER the dispatch. Listeners like the group page (which re-reads `loadVotedQuestions()` in the handler to clear the awaiting-response golden border on the just-voted card) saw the pre-vote state and the border stuck until a refresh. Also: run `markQuestionAsVoted` on vote edits too, not just new submissions — otherwise editing from "voted" to "abstained" never transitions `votedQuestions[id]` from `true` to `'abstained'`, so any UI that distinguishes the two (again, the golden border) goes stale.
- **`loadVotedQuestions()` always allocates fresh Sets.** The helper creates new `Set<string>` instances each call, so even when contents are identical, `setVotedQuestionIds(fresh.votedQuestionIds)` always schedules a re-render and re-runs every downstream memo/prop that depends on the Set identity. Any high-frequency caller (e.g. a `QUESTION_VOTES_CHANGED_EVENT` listener) should compare by contents before committing: `setVotedQuestionIds(prev => setsEqual(prev, fresh.votedQuestionIds) ? prev : fresh.votedQuestionIds)`. The group page's vote-changed handler does this.
- **Pin list sort to a snapshot when the items display live state.** The group page sorts awaiting questions to the bottom AND draws a golden border on them. If both read the same live state, voting in one card reshuffles the list and moves the card out from under the user's tap. Fix: `useMemo` the sorted array keyed on the group identity only (disable-next-line exhaustive-deps so `votedQuestionIds`/`abstainedQuestionIds` aren't listed as deps). The sort captures "awaiting at group-load"; the border reads live state. Only requirement: define the predicate and the `useMemo` ABOVE any early returns in the component so the hook call order stays stable on loading → loaded transitions.
- **Group-card respondent list uses `VoterList singleLine`** (under the card at `col-start-2 row-start-3`, as the right-hand flex child of a `flex items-start` row that also holds the creator/date label on the left; VoterList gets `flex-1 min-w-0 justify-end` so it takes whatever width is left after the creator/date natural width). The mode hides the count/icon prefix, renders one horizontal row (`whitespace-nowrap overflow-hidden`), and collapses overflow into a trailing `+N` badge. Measurement is a `useLayoutEffect` + `ResizeObserver` on the container that walks each child's `offsetWidth`, reserves space for the `+N` badge, and sets `display: none` imperatively on items that don't fit (bubbles are imperatively hidden; the `+N` badge itself is React-state-driven via the `overflow` state + `style.display`). Keep the two mechanisms separate — don't imperatively set the badge's display inside the effect or React will fight the DOM on re-render.
- **Measuring a React-hidden element with `offsetWidth` returns 0.** The `+N` badge is toggled via `style={{ display: overflow > 0 ? undefined : 'none' }}` — so on the very first measure (or any measure where `overflow === 0`), `plusRef.offsetWidth` is `0`. If the measurement loop then decides some items don't fit (reserving only `GAP + 0`), it sets `overflow > 0`, React reveals the badge, and the rendered row now exceeds container width by the badge's real width. With `justify-end` + `overflow-hidden`, the excess gets clipped off the LEFT edge of the leftmost visible bubble. Fix: temporarily force `plusEl.style.display = ''` before reading `offsetWidth`, save and restore the previous value so we don't stomp React's state-driven display. Any future "measure an element React has hidden" pattern needs the same save/read/restore dance.
- **Single pending-action confirmation modal.** Forget, Reopen, Close Question, End Availability Phase, and Cutoff Suggestions all share one `ConfirmationModal` driven by `pendingAction: { kind: 'forget' | 'reopen' | 'close' | 'cutoff-availability' | 'cutoff-suggestions'; question: Question } | null`. Per-kind copy (title/message/confirmText/confirmButtonClass) lives in a module-level `PENDING_ACTION_COPY: Record<PendingActionKind, ...>` lookup table. The modal is conditionally mounted (`{pendingAction && (...)}`) so each prop is a single lookup rather than parallel ternaries; `ConfirmationModal` already returns null on `!isOpen`, so no animation is lost. To add a new kind, extend the union + the table; don't rewrite the ternaries. The `onConfirm` body keeps one `if/else if` branch per kind since each branch's state-update logic genuinely diverges — always use explicit `else if (action.kind === '...')` rather than a bare trailing `else`, so that future additions to the union surface as no-op branches rather than silently landing in whatever was written last. **`cutoff-suggestions` and `cutoff-availability` share a single branch** (`else if (action.kind === 'cutoff-suggestions' || action.kind === 'cutoff-availability')`) — they have identical optimistic-state shape (patch poll's `prephase_deadline`, patch each returned question's `options`, refetch `questionResultsMap` for every returned question). Only the API helper differs (`apiCutoffPollSuggestions` vs `apiCutoffPollAvailability`), selected via a ternary. The post-cutoff results refresh fetches all `wrapper.questions` in parallel (`Promise.all`) since a multi-question poll's cutoff fans out to N siblings; the `setQuestionResultsMap` updater uses the canonical content-equality guard (compare `total_votes`/`yes_count`/`no_count`/`winner`/`suggestion_counts.length`) and only allocates a new Map when at least one entry actually changed.
- **Close Question, End Availability Phase, and Cutoff Suggestions all live in the long-press modal, not the ballot.** `FollowUpModal` renders a red "Close Poll" button (`onCloseQuestion` prop) when the question is open AND `getCreatorSecret(questionId)` is known (or dev), an amber "End Availability Phase" button (`onCutoffAvailability` prop) when additionally `isInTimeAvailabilityPhase(question)` is true, and an amber "Cutoff Suggestions" button (`onCutoffSuggestions` prop) when `isInSuggestionPhase(question, wrapper.prephase_deadline)` is true. Both amber buttons share an internal `AmberCutoffButton({label, onClick, onClose})` helper inside `FollowUpModal.tsx` — they're identical except for label, so don't add a third copy of the SVG+button block when adding a new amber-cutoff action; extend the helper. The group page wires both props → `setPendingAction({ kind, question })` → shared ConfirmationModal → mutation API call. For `close`: `apiCloseQuestion` + optimistic `setGroup({ is_closed: true, close_reason: 'manual' })`. For `cutoff-availability`: `apiCutoffAvailability` + optimistic `setGroup({ suggestion_deadline, options })` + follow-up `apiGetQuestionResults` to repopulate `questionResultsMap` since the end of the availability phase changes which results are meaningful (time-slot counts now exist). The questionResultsMap updater uses the same content-equality guard pattern as the viewport-intersection results-fetch in the group page — always allocating a new Map defeats the `===`-identity shortcut on downstream memos. `QuestionBallot` no longer carries close/reopen/cutoff-availability handlers, state, confirmation modals, or `QuestionManagementButtons` — all deleted as dead code when the buttons moved. If you see `handleCloseClick` / `handleReopenClick` / `handleCutoffAvailabilityClick` referenced in any future PR, it's a merge conflict with stale code.
- **Initial-expand scroll target differs from tap-expand.** Landing on `/p/<id>/` (or being redirected there after creating a question) should position the expanded card's top flush with the bottom of the top bar, regardless of where the card would naturally sit. The tap-to-expand "keep in view" rules (only scroll when the compact header is hidden above the top bar or the card overflows the bottom) are wrong for the entry case — e.g., a card that fits entirely in the viewport but isn't near the top wouldn't scroll at all, leaving dead space. The two paths now live in **two separate effects** (a `useLayoutEffect` for initial-mount-only, gated on a `hasHandledInitialExpandRef` ref, and a `useEffect` for subsequent expands gated on `expandedQuestionId !== initialExpandedQuestionId`). The initial path runs synchronously before paint and uses a direct `window.scrollTo`, no rAF animation, so the destination's first paint already has the correct scroll position. The subsequent path keeps the rAF animation that runs alongside the 300ms grid-rows expand. Gate the layout effect on `headerHeight > 0` so the first run (pre-ResizeObserver) doesn't compute against `visibleTopY = 0` and consume the one-shot ref.
- **`useLayoutEffect` cleanup that resets the "fire-once" ref re-fires on every dep change, not just on unmount.** The first version of the initial-scroll layout effect returned `() => { hasHandledInitialExpandRef.current = false; }` to handle React StrictMode's mount→cleanup→mount cycle. But useEffect/useLayoutEffect cleanup ALSO runs on dep changes — so when `group` mutated post-paint (e.g. an async `getAccessiblePolls` refresh after a cache-hit, or a vote-changed event), the ref reset, the effect re-fired, recomputed the scroll target against the now-taller page, and visibly nudged the user further down. `useRef.current` already persists across StrictMode's mount→cleanup→mount cycle, so the ref check above the body is sufficient — drop the cleanup entirely. Same pattern applies to any "fire-once-on-mount" useLayoutEffect: don't put state-reset logic in the cleanup return; rely on `useRef` persistence.
- **`navigateWithTransition` snapshots the destination at `data-page-ready`, not at the final layout.** The view-transitions helper waits for `data-page-ready` to match the target path, then captures the new snapshot. If `usePageReady` flips on a coarse signal like "group loaded" while a layout effect that adjusts scroll is still pending, the snapshot fires at scrollY=0 and the browser visibly jumps to the real scroll position once the layout effect lands. Gate `usePageReady` on a finer-grained signal that only flips after the initial scroll has been applied (an `initialScrollApplied` state set inside the same useLayoutEffect that scrolls). The transition snapshot then captures the post-scroll state and the user sees zero motion after the slide-in completes.
- **Group card chrome lives outside the card.** Each group item is a 2-col × 3-row CSS grid: col 1 row 2 holds the category icon, col 2 row 1 is intentionally empty (the old above-card status label moved into the card's footer row), col 2 row 2 holds the bordered card itself (title + in-card footer row), col 2 row 3 holds the below-card row (creator/age label on the left, respondents bubble row on the right). The `row-start-2` placement of the icon cell pins its top to the card's top without a magic padding. `QuestionBallot` no longer renders its own countdown inside the ballot; the in-card footer row is the single source of status info. Time questions' deferred-deadline notice ("Availability cutoff Xmin after first response") still renders in the ballot because it conveys run-duration info the footer's "Collecting Availability" label doesn't — the parallel "Suggestions cutoff …" notice was removed.
- **In-card footer row: status label left, compact pill right, shared line.** Below the title + copy-link row, a flex row renders the status label (countdown / "Closed X ago" / "Taking Suggestions" / "Collecting Availability" / "Voting Xh") on the left (`shrink-0`, `pl-1` for breathing room from the rounded corner, `leading-7` so its line-box matches the pill height) and the question-type-specific compact pill on the right (`flex-1 min-w-0 flex justify-end`). `PILL_CLASS` includes `min-w-0` so the winner name truncates with ellipsis when the status claims most of the line. The row uses `min-h-7 items-end`: `min-h-7` (~28px) pins it to the compact pill's natural height so the status text Y stays stable when the pill clips to 0 on expand; `items-end` aligns the status text with the BOTTOM of the pill column. Single-pill case looks center-aligned (status's `leading-7` line-box bottom = pill bottom, with the visible glyph centered inside that line-box). Multi-pill stacked case the status reads alongside the bottom-most pill instead of being centered with the whole stack — the user-mental-model is "the status describes the latest/winning result line", which is the bottom one. When both `statusEl` and `pillEl` are null (no countdown AND no preview) the row is skipped entirely so the gap doesn't appear.
- **Pill-column truncation needs `w-full min-w-0` on every layer of the column wrapper, not just the outermost flex item.** The compact preview chain is `pill column wrapper (flex-1 min-w-0)` → `CompactPreviewClip outer grid (w-full min-w-0)` → `overflow-hidden grid item (min-w-0)` → `flex flex-col items-stretch w-full min-w-0` → per-pill row wrapper (`w-full min-w-0`) → `flex justify-end gap-2 min-w-0` row → `<span PILL_CLASS truncate min-w-0 max-w-[14rem]>`. With only the pill's `min-w-0` set, the inner flex-col sizes to its widest pill row's max-content (the full untruncated winner name), the column wrapper allows it to overflow leftward, and the pill visually crashes into the status label on the left. The fix is `w-full min-w-0` at EVERY layer of the chain, plus `items-stretch` (NOT `items-end`) on the multi-pill flex-col so child widths inherit the full track. With every layer width-pinned to the available track, each pill row's own `flex justify-end` right-aligns the pill within the row, and `truncate` on the pill ellipses anything past the row's right edge — instead of the row growing to its content's natural width and shoving left. `items-stretch` on the flex-col + per-row `flex justify-end` > `items-end` on the flex-col with no per-row width — the latter sizes children to content. Symptom of regression: a long winner name's pill spans the full card width and the lower-left status text becomes visually overlapped/clipped.
- **Compact pill icons mirror the question's category — no generic fallback.** `CompactRankedChoicePreview` and `CompactTimePreview` accept an optional `categoryIcon?: string` prop. The `<span className="text-xs shrink-0">{categoryIcon}</span>` is rendered only when the prop is set; pass `getBuiltInCategoryIcon(sp.category)` (in `lib/questionListUtils.ts`) at the call site, which returns the `BUILT_IN_TYPES` emoji for built-in categories (`restaurant` 🍽️, `location` 📍, `time` 📅, `movie` 🎬, etc.) and `undefined` for `'custom'` / null / unrecognized categories — no hardcoded 🏆 trophy or 📅 calendar fallback. Custom-category ranked-choice polls render iconless. `getBuiltInCategoryIcon` is also called by the existing `getCategoryIcon` (which DOES still fall back to a question-type symbol for the per-question hanging icon use case) so the icon-source logic lives in one helper. Use `getBuiltInCategoryIcon` whenever the call site WANTS the "no icon for custom" semantics; use `getCategoryIcon` when a fallback symbol is required.
- **`items-center` on a flex row centers the margin-box, not the border-box.** `CompactPreviewClip` previously wrapped the pill in `<div className="mt-2">`, inside the overflow-hidden child. As a sibling in the footer flex row, its margin-box was ~8px taller on top, so `items-center` placed the pill's visible content below the status text. Fixed by dropping the inner `mt-2` — the parent flex row's own positioning handles the gap above. If you reintroduce a top margin inside a flex-item wrapper for vertical alignment reasons, know that it fights `items-center` (and now `items-end`).
- **The below-card row uses `items-start` + per-child `mt-*`, not `items-center`.** Creator/date (text-xs) and respondent bubbles (text-xs + py-0.5 padding) have different natural heights. `items-center` aligns their vertical midpoints; with `items-start` they both anchor to the top of the row and each child can nudge itself independently — useful if you want the creator label flush with the card while bubbles have breathing room above them (current values: creator `mt-px`, bubbles `mt-[3px]`). The creator span is `shrink-0` so it takes natural width; the VoterList is `flex-1 min-w-0 justify-end` so it fills whatever's left over (replacing the old `max-w-[75%]` cap). If the creator name plus date ever grows wide enough to swallow the bubble area entirely, the bubbles just collapse to the `+N` overflow badge — that's the intended trade of "creator label always wins" over "bubbles always get 75%".
- **Expanded card uses `pb-1.5`, collapsed uses `pb-0.5`.** The group card wrapper picks bottom padding off `isExpanded`. Collapsed cards use `pb-0.5` (2px) so the status/pill footer row sits snug against the card edge; expanded cards use `pb-1.5` (6px) — paired with `mt-1.5` (6px) on the wrapper around `QuestionBallot` inside the expand clip, this gives symmetric breathing room above and below the expanded results card. Originally `pb-0` + `mt-3` (no bottom padding, large top gap), tightened to keep the status label visually adjacent to its results without crowding the card edge. When adding new trailing content to an expanded card, the 6px is already there — don't re-pad inside `QuestionBallot` to fix trailing whitespace.
- **Icon vs title-line centering uses an empirical `mt-[7px]`** on a fixed-height 28px flex container (`h-7 items-center`). Pure line-box alignment (`mt-[9px]`) looks low because the line-box reserves descender space below the baseline; pure cap-to-baseline alignment (`mt-[5px]`) looks high because emoji glyphs are centered-ish in their em-box, not bottom-aligned. Splitting the difference reads right across the mix of emoji glyphs used for categories (🏆 👍 🗳️ 🙋 etc.). If the emoji set or title size changes, re-tune via Playwright `getBoundingClientRect` on both `<h3>` and the icon wrapper.
- **Yes/No results + voting UI is rendered externally by the group view.** `YesNoResults` (in `components/QuestionResults.tsx`) is rendered OUTSIDE the expand clip in `app/g/[groupShortId]/page.tsx`, not inside `QuestionBallot`. `QuestionBallot` takes an `externalYesNoResults` prop and skips its own `QuestionResultsDisplay` calls + the old ballot for yes_no questions when it's set, so the external render is the sole source of truth. The group page loads results via `apiGetQuestionResults` and the viewer's own vote via `apiGetVotes` (filtered by `getStoredVoteId(questionId)`) into `questionResultsMap` / `userVoteMap` state. Taps on option cards / Abstain fire `onVoteChange(newChoice)` which opens a `ConfirmationModal`; on confirm the group page routes to `apiEditVote` (existing vote) or `apiSubmitVote` (first-time vote, with saved `getUserName()`). After the call: `invalidateQuestion`, `setStoredVoteId` on first submit, `setVotedQuestionFlag`, `setVotedQuestionIds`/`setAbstainedQuestionIds` from `loadVotedQuestions()`, then dispatch `QUESTION_VOTES_CHANGED_EVENT`.
- **Yes/No results have a compact view and an expanded view driven by `hideLoser`.** `hideLoser=true` (group card collapsed): single-line winner pill + `N%` + `(count)`, right-justified. `hideLoser=false`: the two option cards sit side-by-side (`w-24` each, right-justified in a flex with `items-center`), the chosen card gets a blue checkmark badge (`w-[1.625rem]`, white SVG check, `strokeWidth={4}`) in its *outer* corner (`-top-2 -left-2` on the left/Yes card, `-top-2 -right-2` on the right/No card — mirroring keeps it from overlapping the neighbor), and percent + parenthesized count render on a row below the cards. Abstain / "You abstained" sits in the left column of the same flex, vertically centered with the cards via `items-center`. Don't add a "PRELIMINARY" label — user removed it. The Yes-card always occupies the left grid slot and No the right (regardless of winner) so the checkmark's corner choice is stable.
- **localStorage helpers live in `lib/votedQuestionsStorage.ts`.** `loadVotedQuestions()` (sets), `hasVotedOnQuestion(questionId)` (boolean — true for both voted and abstained), `setVotedQuestionFlag(questionId, true | 'abstained' | null)`, `getStoredVoteId(questionId)`, `setStoredVoteId(questionId, voteId)`, and `parseYesNoChoice({ is_abstain, yes_no_choice })`. Use these — don't write inline `JSON.parse(localStorage.getItem(...))` for the `votedQuestions` / `questionVoteIds` keys. The group page, `QuestionBallot`, and `forgetQuestion.ts` all consume these.
- **Post-vote ranked choice summary is a single "Your Ballot" amber link — EXCEPT for binary 2-option polls without a suggestion phase, which keep the cards visible.** For `questionOptions.length > 2` (or any ranked-choice with a suggestion phase): when `hasVoted && !isEditingVote && hasCompletedRanking`, `QuestionBallot` renders one centered `<button>Your Ballot</button>` using the shared Abstain-link class stack (`text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70`) that calls `setIsEditingVote(true)` on click. For `questionOptions.length === 2 && !canSubmitSuggestions`, the gate at QuestionBallot.tsx:1383 explicitly excludes that case (`&& questionOptions.length !== 2`) and falls through to `RankingSection` → `BinaryRankedChoiceBallot` — the cards stay visible with the user's choice highlighted (the existing `setRankedChoices(voteData.ranked_choices)` restore at QuestionBallot.tsx:495 populates `rankedChoices[0]`). Tapping a card after voting fires `handleBinaryChoiceTap`, which flips `isEditingRanking=true` so the wrapper Submit (`wrapperShouldShowSubmit`) surfaces. `ReadOnlyTierCards` is still used elsewhere but is no longer imported in `QuestionBallot`. Below-ballot preliminary results are also hidden whenever editing a ranked-choice vote (`!(isEditingVote && question.question_type === 'ranked_choice')`) — matches the above-ballot block, which was already hidden by `!isEditingVote`.
- **Binary 2-option ranked-choice ballot is rendered like the yes/no card pair (when no suggestion phase is in flight).** `RankingSection`'s `questionOptions.length === 2 && !canSubmitSuggestions` branch delegates to `components/QuestionBallot/BinaryRankedChoiceBallot.tsx`, which mirrors `YesNoResults`'s expanded view: two cards side-by-side, winner card colored from the live first-round IRV count (`results.ranked_choice_rounds`, `round_number === 1`), blue checkmark badge in the outer corner of the user's chosen card, % + count row beneath the cards, and an "Abstain" / "You abstained" text link to the LEFT (replacing `AbstainButton` for THIS branch only). The drag-to-reorder branch keeps `AbstainButton` below the rank list — when restructuring, move the abstain control inside its branch so each branch owns its own abstain affordance. Visual divergence from yes/no: green/gray instead of green/red (a losing option isn't a negation), and `flex-1 min-w-0` cards instead of `w-24` so rich `OptionLabel` content (restaurants/locations) fits.
  - **Suppress the rounds-list preliminary results when binary cards are visible.** `QuestionBallot.preliminaryResultsBlock` gates on `!suppressBinaryRcHere`, where `suppressBinaryRcHere = ranked_choice && questionOptions.length === 2 && !canSubmitSuggestions`. Cards now stay visible post-vote (tap to edit), so the suppression is unconditional for this shape — adding a `hasVoted` carve-out would re-introduce the duplicate-winner problem (rounds list + cards both showing the same first-round counts).
  - **Plumb `questionResults` into `RankingSection`.** The 2-option branch needs first-round counts + winner; the existing component prop list didn't have them. Added a `questionResults?: QuestionResults | null` prop and forwarded from `QuestionBallot`'s state. Other branches don't read it, so it's optional.
  - **Gate is the existing `!canSubmitSuggestions` clause, unchanged.** A 2-option ranked-choice with an open suggestion phase still renders the drag-to-reorder UI — the user might still grow the option list past two via suggestions, so a binary card pair would mis-promise.
  - **`Math.find()` over `ranked_choice_rounds` is fine for 2-option case.** With 2 options IRV runs at most one round, so the rounds array has 2 rows. Don't pre-emptively memoize into a Map — the cost is genuinely negligible.
  - **Binary RC tap-to-submit mirrors yes/no's tap UX, gated by `hasVoted`.** First-time tap → auto-submit, no confirmation modal. Edit tap (hasVoted=true) → only stages the choice + flips into `isEditingRanking` so the wrapper Submit button surfaces — the user must press Submit to actually change their vote. Implementation: `handleBinaryChoiceTap` in `QuestionBallot.tsx` sets `rankedChoices` + (for first-time) arms a `pendingBinarySubmit` flag; a `useEffect([pendingBinarySubmit, rankedChoices, isEditingRanking])` picks up the flag on the next render — once React commits the state — and fires `submitVoteRef.current()`. Reading through the ref ensures `submitVote`'s closure sees the freshly-committed `rankedChoices`/`rankedChoiceTiers` instead of the stale empty array from the tap-event closure. `RankingSection` exposes `onBinaryRankedChoiceTap` so non-QuestionBallot callers fall back to the legacy stage-only behavior. **The drag-to-rank multi-option ballot is unchanged** — tap-to-submit doesn't fit while reordering; the user submits via the wrapper Submit button.
  - **`AbstainButton` (the big yellow button) is replaced by a small gold-text link in both binary RC and the multi-option drag-to-rank ballot.** The active state is a `<button>` whose label flips between `Abstain` and `You abstained` — tapping `You abstained` toggles back through `handleAbstain`. Earlier the active state was a `<span>` and the user couldn't revert without also tapping a card. Class stack matches the yes/no `abstainContent` in `QuestionResults.tsx`: `text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70`. The `disabled` (read-only) state still uses a `<span>`. Ranking-section `AbstainButton` import is gone; the component is still imported by `TimeBallotSection`.
  - **`canImplicitlyEdit` in `QuestionBallot.tsx` is the shared "user has voted but still has work" computation** read by both `handleVoteClick` (auto-enter edit mode) AND `wrapperShouldShowSubmit` (keep wrapper Submit visible). Without it the early-voting (suggestion phase, allow_pre_ranking) flow hid the wrapper Submit button after suggestions were submitted, even though the user could still rank. Same for time questions transitioning availability → preferences. The expression is `hasVoted && ((canSubmitSuggestions && canSubmitRankings) || hasNotRankedYet || hasNotReactedYet)`. Mirror the value in BOTH consumers when changing the rules.

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
- **Stop hook ntfy filter**: `.claude/hooks/stop-check.sh` sends "Claude is ready for input" via ntfy on every clean-tree turn-end, but suppresses the notification when the most recent user prompt consists ONLY of `<github-webhook-activity>` events that all match PR-merged or branch-deleted patterns. Other webhook events (review comments, CI failures, push events, branch creation) and any direct user text still notify. Two pitfalls when extending the filter: (1) `"merged":true` only ever appears in actually-merged PR payloads, so it's a safe sole signal — but `"ref_type":"branch"` appears in BOTH `delete` AND `create` events, so the branch-delete check requires a co-occurring delete signal (`"event":"delete"` or `"action":"deleted"`) to avoid silently suppressing new-branch creations. (2) The transcript is read via `collections.deque(f, maxlen=50)` rather than `f.readlines()` so memory stays flat for multi-MB transcripts. The functional test pattern (synthesize a JSONL transcript with one user message, source `should_skip_notify_due_to_webhook` via awk-extract, assert SKIP/NOTIFY) is in this PR's commit message — re-run it whenever you tweak the regex patterns.

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

> **Migration 105 retired `polls.follow_up_to` and moved `polls.group_title` to `groups.title`.**
> Groups are flat lists of polls keyed by `polls.group_id` — no more chain-pointer walks.
>
> **API contract:**
>   * `CreatePollRequest.follow_up_to` (a question id) → `group_id` (a uuid).
>     Optional; null/omitted → server mints a fresh group. Unknown group_ids
>     fall through to "mint a fresh group" rather than 404.
>   * `PollResponse.follow_up_to` removed. `Poll.group_id` + `Poll.group_short_id`
>     (already on every poll since Phase B.4) are the canonical pointers.
>   * `QuestionResponse.poll_follow_up_to` removed. The FE-only chain-pointer
>     mirror is gone.
>   * `POST /api/polls/<id>/group-title` retired in favor of
>     `POST /api/groups/<route_id>/title` (route_id resolves the same four
>     forms as the other group endpoints: groups.short_id, groups.id,
>     polls.short_id, polls.id).
>   * `GET /api/questions/find-duplicate?follow_up_to=<qid>` →
>     `?group_id=<uuid>` (flat group-scoped lookup).
>
> **Server:**
>   * `_insert_poll` no longer walks parent → child; uses `_resolve_or_create_group`
>     with `req.group_id` (or mints a new group row).
>   * `_compute_display_title` falls through to `questions[0].title` when no
>     `group_title` override is set — preserves user-typed yes_no prompts
>     (the regression that triggered this whole effort: the original bug
>     was that `req.title` was being written into `polls.group_title`,
>     which the FE then displayed as the group name).
>   * `_attach_group_fields` (renamed from `_attach_group_short_id`) enriches
>     INSERT/UPDATE `RETURNING *` rows with both `group_short_id` and
>     `group_title` from the joined groups row. SELECT paths use
>     `_SELECT_POLLS_WITH_GROUP` which includes `t.title AS group_title`.
>   * `_resolve_parent_poll_id` deleted entirely (chain walking is gone).
>
> **FE:**
>   * `Poll.group_title` is sourced from `groups.title` via JOIN — same
>     FE field name preserved, but it's now a single source of truth.
>     Every poll in the same group carries the same value.
>   * `Poll.follow_up_to` and `Question.poll_follow_up_to` removed.
>   * `lib/groupUtils.ts` collapses chain-walking infrastructure:
>     `collectDescendants`, parent→children maps, multi-step discovery
>     are gone. Groups are now `groupBy(group_id)` via `groupPollsByGroup`.
>     `findChainRoot(polls)` now means "oldest poll by `created_at`" (the
>     natural anchor for a flat group); kept as a helper for callsites
>     that need to pick the chain root from a list.
>   * `<body data-group-latest-question-id>` → `<body data-group-id>`:
>     the create-poll form attaches new polls to the group directly,
>     instead of translating a question_id through the cache. Constant:
>     `GROUP_ID_ATTR` in `lib/groupDomMarkers.ts`.
>   * `apiUpdateGroupTitle(routeId, title)` (replaces `apiUpdatePollGroupTitle`).
>     Returns `{group_id, group_short_id, title}`. **Invalidates every poll
>     in the group automatically** — callers don't need to re-implement
>     the cache cleanup. Use this whenever the group name changes.
>   * `apiFindDuplicateQuestion(title, groupId)`: group-scoped lookup.
>   * `<FollowUpHeader>` (the "this is a follow-up to X" link inside the
>     long-press modal) is removed — the chain-pointer source is gone, and
>     the same poll is reachable via the group URL.
>   * `getCachedGroupIdForQuestion(questionId)` in `lib/questionCache.ts`
>     resolves a question id to its group_id from in-memory caches. Used
>     by the create-poll duplicate / vote-on-it flows that receive a
>     question id but need to attach the new poll to the right group.
>     Don't reinvent the lookup at call sites — both `app/create-poll/page.tsx`
>     and `components/VoteOnItModal.tsx` consume this helper.
>
> **Pitfall the bug fix surfaced:** `req.title` (the poll's display title,
> e.g. a user-typed yes_no prompt) is NOT the same as the group name
> override. Conflating them caused the "group name silently becomes a
> poll's title" symptom. The architectural fix moved the group-name
> override out of `polls` entirely so they're physically separate
> columns now and the conflation can't recur. If you ever need to add
> another wrapper-vs-group field, default to keeping it on the
> `groups` row — duplicating data across every poll in a group is the
> shape that goes stale and the COALESCE-on-create inheritance is the
> shape that propagates bugs.

> **Migration 106 retired per-poll access; group URLs grant whole-group
> membership.** The `poll_access` table, the `POST /api/polls/{id}/access`
> endpoint, the `?p=`-driven inline auto-grant, and the FE
> `apiGrantPollAccess` helper are all gone. Visiting any form of
> `GET /api/groups/by-route-id/{route_id}` (with or without `?p=`)
> writes a `group_members` row inline — sharing a group URL is the
> canonical "invite someone" mechanism. Visibility filter collapses to
> "group membership only" + the legacy bridge during the rollout
> window:
>
>   1. B has a `group_members` row for T AND
>      (`P.is_closed = false` OR `P.closed_at >= members.joined_at`), OR
>   2. (transitional bridge) The legacy `accessible_question_ids` list
>      contains a question_id whose poll lives in T — group-level, no
>      closed_at filter, /api/groups/mine only.
>
> The closed-before-join filter still applies, so a brand-new member
> sees open polls plus polls closed after their `joined_at` watermark
> but NOT polls closed before. If the URL carries `?p=<closedPreJoin>`,
> the linked poll is silently absent — the FE renders the rest of the
> group (per the user spec: "if they received a direct link to a poll
> closed before they joined, just show the group and don't try to show
> the old poll"). `?p=` is purely cosmetic at the API level — it drives
> FE auto-expand + scroll target + link-preview metadata, nothing else.
>
> `/by-route-id/{id}` only 404s when route resolution itself fails. An
> empty visible-polls list returns 200 with `[]` so the group page can
> still render its chrome (header + Share button + the "Create Poll"
> CTA). The previous "non-member with no `?p` → 404" rule is gone.
>
> **`grant_group_membership_inline(conn, group_id, browser_id)`** in
> `services/groups.py` is the canonical helper for the read-endpoint
> auto-join. ON CONFLICT preserves the original `joined_at` watermark
> across re-visits — load-bearing, since advancing it would silently
> un-hide newly-closed polls. The vote/create auto-join helpers in
> `services/memberships.py` (`join_group`, `join_group_for_poll`)
> still open their own connections (decoupled-transactions rule); only
> the visit-path uses the inline flavor.
>
> **`UserVisibility` (in `services/groups.py`)** carries
> `joined_by_group` + `bridged_group_ids` only — `access_poll_ids` is
> gone with migration 106. The previously-shared
> `group_ids_for_poll_ids` helper is also deleted (it only existed to
> fan out access-group sets).
>
> **Top-right Share button** in `GroupHeader.rightSlot`
> (`components/GroupShareButton.tsx`). Tapping invokes
> `navigator.share({title, url})` on iOS / Android, falls back to
> `navigator.clipboard.writeText` with a brief "Link copied" toast,
> then to a manual-copy `prompt()` as last resort. `AbortError` from a
> dismissed share sheet is swallowed silently. Shares the BARE group
> URL (`/g/<routeId>` with no `?p=`) — per-card copy-link buttons still
> emit `?p=<short>` URLs ("share this poll's view of the group"), but
> the access semantics are now identical: both forms grant the
> recipient group membership on visit. Wired into GroupHeader's
> existing `rightSlot` prop, which centers the title when populated.
> The `/info` and `/edit-title` sub-routes still pass their own
> rightSlot (Edit / Save) — only the canonical group view gets the
> Share button.

> **`DELETE /api/groups/{route_id}/membership` ("leave group") shipped
> in #268** as the explicit teardown counterpart to the auto-join
> writes. The endpoint removes the caller's `group_members` row for
> the resolved group (idempotent — strangers and
> already-left-and-leaving-again both 204; only an unresolvable
> `route_id` 404s). Resolves all four route_id forms
> (`groups.short_id`, `groups.id`, `polls.short_id`, `polls.id`).
> FE helper: `apiLeaveGroup(routeId)` in `lib/api/groups.ts`,
> fire-and-forget. Note that re-visiting the group URL after leave
> writes a fresh `group_members` row with a new `joined_at`
> watermark — "leave" is durable only against the user not navigating
> back.
>
> **Wired into the group-page forget flow on this branch.** When the
> user forgets their last remaining question in the group (the
> existing `remaining.length === 0` branch in
> `app/g/[groupShortId]/page.tsx`'s `pendingAction.kind === 'forget'`
> handler — i.e. the same condition that already triggers
> `router.push('/')`), we additionally call `apiLeaveGroup(groupId)`
> before navigating home. This is the unambiguous "no FE-visible
> questions left in this group for this browser" case. Forgetting one
> question of a multi-question/multi-poll group does NOT fire leave —
> the user is still consuming the group via the remaining questions.
> Once enough rollout time has passed for active browsers to exercise
> this path, the legacy `accessible_question_ids` bridge in
> `/api/groups/mine` becomes retirable — `group_members` will be the
> sole source of truth. (Migration 106 already collapsed the
> per-poll-access leg of the rule, so the bridge is the only remaining
> non-membership signal.)
>
> **Phase C.3 of the group-routing redesign shipped (#267).**
> The visibility rule is now enforced on `POST /api/groups/mine` and
> `GET /api/groups/by-route-id/{route_id}`. A poll P in group T is
> visible to browser B iff ANY of:
>
>   1. B has a `group_members` row for T AND
>      (`P.is_closed = false` OR `P.closed_at >= members.joined_at`),
>   2. B has a `poll_access` row for P,
>   3. (transitional) The legacy `accessible_question_ids` list passed
>      by the FE contains a question_id whose poll lives in T — treated
>      as **group-level** access (every poll in T visible, no
>      closed_at filter) so pre-B.3 callers passing one question_id
>      keep seeing the whole group (the Phase B.3 contract). Per-poll
>      bridging would silently shrink groups on first refresh
>      post-rollout. Applies to `/api/groups/mine` only — by-route-id
>      relies on `?p=` inline grant.
>
> Decisions on the previously-open semantic questions:
>
>   * **Join trigger**: vote/create only — Phase C.2 defaults
>     preserved. The /access endpoint and the `?p=` auto-grant on
>     by-route-id grant `poll_access` (per-poll, not group membership).
>   * **Non-member visiting `/g/<id>` with no `?p`**: 404. "No
>     visibility into any poll" is treated identically to "no such
>     group" — same FE error path.
>   * **Forget vs leave**: forget stays localStorage-only. When the FE
>     passes `accessible_question_ids`, `/api/groups/mine` narrows to
>     groups with a non-membership signal (poll_access OR legacy
>     bridge) so forget keeps its "group disappears from home"
>     semantics. An explicit `DELETE /api/groups/{id}/membership`
>     ("leave group") is a follow-up to retire the bridge.
>
> `closed_at` proxy: `polls.updated_at`, refreshed by the close
> trigger. Subsequent edits bump it forward — the filter fails open (a
> closed poll touched after the user joins becomes visible). Adding a
> dedicated `closed_at` column would be marginally tighter; deferred.
>
> **`?p=` inline auto-grant on by-route-id.** The endpoint accepts an
> optional `?p=<pollShortId>`; when present, a `poll_access` row is
> written inline BEFORE filtering. This race-safely surfaces a direct-
> link landing — without it, a stranger hitting
> `/g/<group>?p=<poll>` on a fresh browser would see by-route-id 404
> because the FE's parallel `apiGrantPollAccess` call hadn't yet
> landed. The lookup is **scoped to the resolved group**, so a `?p`
> referencing a poll in a different group is silently ignored — no
> cross-group access leak.
>
> **Visibility helpers in `services/groups.py`:**
>
>   * `UserVisibility` dataclass: a snapshot of one browser's
>     `joined_by_group` / `access_poll_ids` / `bridged_group_ids`.
>   * `load_user_visibility(conn, browser_id, *, legacy_question_ids)`:
>     reads every signal in one place. Both endpoints call this once
>     per request.
>   * `filter_visible_polls(conn, candidate_poll_ids, visibility)`:
>     applies the rule. Returns the visible subset.
>   * `grant_poll_access_inline(conn, poll_id, browser_id)`: writes
>     `poll_access` in the SAME transaction as the read. Used only by
>     the `?p=` auto-grant.
>
> **Migration cost.** Pre-B.3 voters who haven't re-voted have no
> `group_members` row. They keep working via the legacy bridge so
> long as their FE passes `accessible_question_ids`. Once they vote
> again, Phase C.2's auto-join writes restore membership and the
> bridge becomes redundant. The bridge will be retired in a follow-up
> phase after enough rollout time. Visibility enforcement on the
> legacy `POST /api/questions/accessible` is intentionally NOT added —
> the FE migrated to /api/groups/* in B.3, and gating the legacy
> endpoint retroactively risks breaking older client bundles.
>
> **Phase C.2 (#266) is the previous step.**
> The membership tables (added schema-only in C.1) are wired to live
> traffic. Three trigger points, all decoupled from the action that
> triggers them — each membership write opens its OWN `get_db()`
> transaction, logs+swallows failures, and uses `ON CONFLICT DO NOTHING`
> on the composite PK so re-votes/re-grants preserve the original
> `joined_at`/`granted_at` watermark (the Phase C.3 visibility filter
> compares poll closure timestamps against it):
>
>   * **Creator auto-join** — `POST /api/polls` writes `group_members`
>     AFTER the create commits (root polls' `group_id` only exists
>     post-`_insert_poll`).
>   * **Voter auto-join** — `POST /api/polls/{id}/votes` writes
>     `group_members` BEFORE the vote runs, so a vote rejected by
>     validation still records "attempted to participate" as the trigger.
>     `services.memberships.join_group_for_poll` fuses the
>     `polls.group_id` lookup with the insert via `INSERT … SELECT
>     group_id FROM polls WHERE id=… ON CONFLICT DO NOTHING` — single
>     round-trip on the vote hot path.
>   * **Direct-link grant** — new `POST /api/polls/{id}/access` endpoint
>     called by the FE when the user lands on `/g/<group>?p=<poll>` (and
>     transitively from legacy `/p/<id>` redirects, which funnel through
>     the same canonical URL once they resolve). The endpoint inlines the
>     INSERT and uses the FK violation as the existence check:
>     `psycopg.errors.ForeignKeyViolation` → 404 — single connection, no
>     TOCTOU window. Returns 204 on success.
>
> FE: `apiGrantPollAccess(pollId)` in `lib/api/polls.ts` is fire-and-forget
> (catches and discards). The group page (`app/g/[groupShortId]/page.tsx`)
> fires it from a `useEffect` keyed on a memoized `targetPoll` (resolved
> from `?p=` via `getCachedPollForShortId`); a `useRef<Set<string>>`
> dedupes the call so `rootPoll` churn (cache-hit initial paint then
> async refresh resets the same value) doesn't fire duplicate POSTs.
> `_browser_id(request)` helper in `routers/polls.py` reads
> `request.state.browser_id` so every Phase C handler reaches for the
> same one-liner.
>
> Backfill of pre-B.3 votes is still deferred — covered by C.2's
> auto-join writes for any returning browser plus the C.3 legacy
> bridge for users who haven't re-voted. See
> `docs/group-routing-redesign.md` → "Phase C — Membership with
> join-time visibility".
>
> **Phase C.1 (#265) is the previous step.** Migration 102 added the two
> membership tables (`group_members` and `poll_access`) with composite
> PKs and a secondary index on `browser_id`, schema-only. C.2 wires them.
>
> **Phase B.4 of the group-routing redesign shipped (#264).**
> Every `PollResponse` now carries `group_id` (uuid) and `group_short_id`
> so the FE builds `/g/<group.short_id>?p=<poll.short_id>` URLs in a
> single field read — no follow_up_to chain walking, no extra round-trips.
> Migration 101 mints fresh `groups.short_id`s from a separate
> `~`-prefixed keyspace via the `generate_group_short_id` trigger; the
> `~` is URL-safe (RFC 3986 unreserved) and not in the base62 alphabet,
> so it's collision-free with every existing `polls.short_id` (including
> the values B.1 backfilled into `groups.short_id` for legacy chain
> roots). Groups created in the B.1→B.4 window with `short_id = NULL`
> are backfilled with `~`-prefixed values by the same migration.
>
> FE rewiring: `lib/types.ts: Poll` gains `group_id` + `group_short_id`
> (both `string | null` for resilience against synthesized placeholder
> polls and pre-B.4 cached polls left in memory across a deploy);
> `lib/groupUtils.ts` (`getGroupRouteId`, `resolveGroupRootRouteId`,
> `findGroupRootRouteId`, `buildGroupSyncFromCache`) all prefer
> `group_short_id` and fall through to the legacy walk when it's
> absent. `lib/useGroup.ts` and `app/g/[groupShortId]/page.tsx:
> GroupPageInner` skip the per-question and per-poll resolution paths
> entirely — they call `apiGetGroupByRouteId(groupId)` (which the
> server resolves against `groups.short_id` first), find the chain root
> in the returned poll list, and warm the accessible-questions cache
> from there. The per-poll `apiGetPollByShortId` fallback in the group
> page remains as a last-ditch safety net for very old URL forms during
> a partial rollout.
>
> Server side: `_SELECT_POLLS_WITH_GROUP` in `routers/polls.py` is the
> single source of truth for "every polls SELECT must surface
> `group_short_id` + `group_title`". `services/groups.py:
> polls_for_poll_ids` imports the constant via the same deferred import
> as `_row_to_poll` / `_compute_poll_voter_data`, so there is no second
> SELECT to keep in sync — extending the constant with a new groups-table
> field reaches every read path automatically. (Earlier this section
> documented two "mirrored" SELECTs and warned that "extending one
> without the other will silently drop the field" — Migration 105 hit
> exactly that failure mode for `group_title`, which is why the second
> SELECT was retired in favor of the import.) `_attach_group_fields(conn, row)`
> enriches `RETURNING *` rows from INSERT/UPDATE paths with the same fields.
>
> Pitfall: `BIGSERIAL` populates existing rows on `ALTER TABLE ADD
> COLUMN` (Postgres 10+) so the migration's backfill UPDATE works. If
> the groups table is renamed/dropped/recreated in a future migration,
> manually preserve `sequential_id` so the `~`-encoded short_ids stay
> stable — the URL is the public ID for an entire group.
>
> **Phase B.3 (#263) is the previous step.**
> Two new endpoints — `POST /api/groups/mine` and
> `GET /api/groups/by-route-id/{routeId}` — collapse the legacy three-step
> bootstrap (`discoverRelatedQuestions` + `apiGetAccessibleQuestions` +
> client-side `buildGroups`) into one server round-trip driven by
> `polls.group_id`. Both return `list[PollResponse]` — the same shape as
> `/api/questions/accessible` — so the FE consumer is a drop-in. The
> aggregation body of `/api/questions/accessible` was extracted to
> `services/groups.py: polls_for_poll_ids(conn, poll_ids, *, include_results)`
> and is shared by both routers.
>
> A new `BrowserIdMiddleware` mints a uuid4 on first visit and echoes it
> via the `X-Browser-Id` response header. `lib/browserIdentity.ts` captures
> the value and persists to localStorage so subsequent requests carry the
> same id via the matching request header. **Header, not cookie** — the
> FE talks to the API same-origin in prod (Next.js rewrite) and direct in
> dev/CI; cookies require credentialed CORS which doesn't compose with
> `allow_origins=["*"]`. The header avoids that minefield while giving
> Phase C the same identity guarantee. Phase B.3 captures the id on
> `request.state.browser_id` but doesn't gate visibility on it yet — that's
> Phase C's job.
>
> FE rewiring: `lib/api/groups.ts` adds `apiGetMyGroups` /
> `apiGetGroupByRouteId` (both warm `cachePoll` + the per-question
> results cache); `lib/simpleQuestionQueries.ts: getMyGroups()` is the
> drop-in replacement for `getAccessiblePolls() + discoverRelatedQuestions()`
> that home/group/`useGroup` all consume. Newly-discovered question_ids
> are persisted to localStorage (subject to the forgotten-list filter)
> and the accessible cache is invalidated when the set grows so subsequent
> freshness checks pick up the expanded list.
> `discoverRelatedQuestions` and its `lib/questionDiscovery.ts` module
> were deleted entirely once all FE callers were retired; the server-side
> `/api/questions/related` endpoint stays as a compatibility surface for
> older client bundles. `next.config.ts` adds the `/api/groups` rewrites
> alongside the existing `/api/questions` and `/api/polls` ones.
>
> Phase B.3 leaves `main` shippable: no schema changes, no contract changes
> for existing endpoints. The legacy endpoints stay in place so any client
> running the previous JS bundle keeps working through the rollout window.
>
> **Phase B.2 (#262) is the previous step.**
> `algorithms/related_polls.py` no longer walks `polls.follow_up_to`
> chains — it groups by `polls.group_id`. The SQL in
> `routers/questions.py:get_related_questions` is now a single indexed
> `WHERE mp.group_id IN (...)` lookup; the Python algorithm just dedupes
> the result. `QuestionRelation` carries a single `group_id` field
> (replacing `poll_id` + `poll_follow_up_to`); `max_depth` is gone.
> Migration `100_tighten_polls_group_id_not_null` tightens
> `polls.group_id` to NOT NULL after a final backfill pass — any rows
> still NULL at that point (orphans whose `follow_up_to` chain root was
> deleted) get a freshly-minted `groups` row with `id = poll.id`.
> `_resolve_parent_poll_id` is unchanged: it's a single `WHERE id = $1`
> lookup translating a question_id (the public `follow_up_to` request
> contract) into a poll_id, not a chain walk. No API contract changes —
> see `docs/group-routing-redesign.md`.
>
> **Phase B.1 (#261) is the previous step.** Migration 099 introduced
> `groups(id, short_id, created_at)` and added `polls.group_id uuid
> REFERENCES groups(id)` (nullable). Backfill: group.id == root_poll.id
> set deterministically via a recursive CTE on `follow_up_to`;
> `groups.short_id` copied from the root poll's `short_id` so the Phase A
> route id continues to resolve once Phase B.4 starts using it. Server
> `_insert_poll` calls `_resolve_or_create_group_id(parent_poll_id)`:
> follow-ups inherit `parent.group_id`; root polls (no parent or missing
> parent group) get a fresh `groups` row via `INSERT INTO groups
> DEFAULT VALUES RETURNING id`. New groups created post-migration have
> `short_id = NULL` until Phase B.4 mints them. The integrity invariant
> "every poll's group_id matches its chain root" is enforced by application
> code in `_insert_poll`, not by a CHECK constraint (subquery CHECKs aren't
> allowed; doable via a trigger but skipped for B.1). See
> `docs/group-routing-redesign.md`.

> **Phase 5 + 5b shipped.** Migration 096 dropped the wrapper-level columns
> from `questions` (short_id, creator_secret, creator_name, response_deadline,
> is_closed, close_reason, follow_up_to, group_title, suggestion_deadline,
> sequential_id). The `polls` table is now the sole source of truth.
> **Phase 5b (this branch)** retires those fields from the API contract too:
> `QuestionResponse` no longer surfaces them, and the FE consumes them from
> `Poll` instead via:
>
> 1. `POST /api/questions/accessible` returns `PollResponse[]` (was
>    `QuestionResponse[]`). The home page passes `polls` directly into
>    `GroupList`. `apiGetAccessibleQuestions` returns `Poll[]`;
>    `getAccessiblePolls` is the canonical helper.
> 2. `lib/groupUtils.ts: buildGroups(polls, ...)` walks
>    `poll.follow_up_to` for chain construction. `Group` carries both
>    `polls: Poll[]` and the flattened `questions: Question[]`. Wrapper
>    reads (creator_name, response_deadline, is_closed, group_title) come
>    from `latestPoll` / each Poll directly.
> 3. Components that need wrapper context take a `poll: Poll` prop
>    (or specific deadline props for `RankingSection`). The group page
>    derives a `pollWrapperMap` from `group.polls` and groups
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
> uses `GroupList`). Legacy single-question mutation endpoints (`POST /api/questions`,
> vote/close/reopen/cutoff/group-title) and FE clients are gone (Phase 5).
> `Question.follow_up_to` is gone — chain logic uses `poll_follow_up_to`.
> `FollowUpHeader` now takes a poll_id.


### Submission paradigm (READ FIRST, alongside Addressability)

**Sub-questions cannot exist or be submitted by themselves.** A question is always a section of a poll. The poll is the unit of identity, sharing, voting, and submission. This is non-negotiable architecture, not a UX nicety.

- **Poll-level state lives on a poll wrapper component.** The wrapper owns: voter name input, Submit button, confirmation modal, "you voted / Edit" overall state, vote-changed event dispatch, cache invalidation. None of these belong inside a question component. Today (mid-rollout) the wrapper for multi-question groups is rendered inside the group-page card group; for 1-question polls the legacy per-question `QuestionBallot` Submit still exists but is being lifted (Phase 3.4 follow-up B).
- **Sub-question-level state lives on the question component** (`QuestionBallot` today, to be renamed `QuestionBallot`). Owns: category-specific ballot UI (yes/no buttons, RankableOptions, TimeSlotBubbles, suggestion entry), per-question abstain control, per-question ranking/preferences state, section label / context display.
- **Abstaining is per-sub-ballot, not per-poll.** A voter can abstain on one question while voting on others. There is no single "abstain from this whole poll" toggle. Each question's abstain control is rendered inside that question's section.
- **Ballot draft is per-poll** (one localStorage entry keyed by `poll_id` holding `{voter_name?, questions: { [question_id]: QuestionDraft } }`, written under `ballotDraft:m:<pollId>`). Voter name is shared across the poll; per-question state is keyed by question id inside the entry. `lib/ballotDraft.ts` exposes per-question convenience helpers — `loadQuestionDraft(pollId, subQuestionId)` / `saveQuestionDraft(...)` / `clearQuestionDraft(...)` — that read/write the slot inside the poll entry. Legacy per-question entries written under `ballotDraft:<subQuestionId>` are auto-hoisted into the poll entry on first `loadQuestionDraft` and the legacy key is dropped. Participation questions have no poll wrapper — pass `pollId === null` and the helpers fall back to the legacy per-question key path. `clearQuestionDraft` drops the whole poll entry once its last question slot is cleared and `voter_name` is unset, so stale entries don't accumulate. The deprecated `loadBallotDraft` / `saveBallotDraft` / `clearBallotDraft` aliases remain as thin wrappers over the null-pollId path; new callers should use the per-question helpers. The wrapper-level voter-name field is wired up by Phase 3.4 follow-up B as the poll-level Submit lands.
- **Vote submission is always atomic across the poll.** Every vote write goes through `POST /api/polls/{id}/votes`. The per-question `apiSubmitVote` / `apiEditVote` callsites are legacy — only reached today as fallbacks when `question.poll_id == null` (i.e. participation questions + any pre-Phase-4 unbackfilled question); removed entirely in Phase 5.

When designing any vote/submission feature, the rule is: **does this belong on the poll wrapper or inside a question's section?** Anything to do with identity, sharing, the act of submitting, or aggregate state goes on the wrapper. Anything specific to a category's ballot interaction goes inside the section.

### Addressability paradigm (READ FIRST)

**The poll is the addressable unit. Sub-questions are internal-only.** This shapes every Phase 2+ decision:

- **URLs reference polls inside groups, never questions.** Groups have a route id (currently the root poll's `short_id`; Phase B will mint a real `groups.short_id`). Polls have `id` (uuid) and `short_id`. The canonical URL is `/g/<groupShortId>?p=<pollShortId>` — path is the group root, query names the poll to expand. Sub-questions have a `questions.id` uuid for FK purposes but is never URL-able. Legacy `/p/<id>` URLs resolve via the redirect stub at `app/p/[shortId]/_legacyRedirect.tsx`; new code should always emit `/g/...?p=...` form (use `getGroupHrefForPoll(poll)` rather than constructing the URL by hand). The previous `/group/<id>/` route is gone too.
- **No client-side aggregation across questions.** Anything that conceptually belongs to "the whole poll" — voter participation list, total respondent count, copy-link target, share-via, vote-submission unit, close/reopen/cutoff target — must come from a poll-level data source. Don't iterate `poll.questions` on the FE to compute poll-level state. Either (a) the server returns the aggregate as a field on `PollResponse` / a sibling endpoint, or (b) a poll-level endpoint computes it server-side. Anything that lands as "merge N per-question fetches in the browser" is the wrong shape — push the aggregation to the server.
- **Per-question data still flows per-question.** Each question's ballot, results, options, suggestions, time slots, etc. continue to use `/api/questions/<question-id>` style endpoints. The principle is about POLL-LEVEL aggregates, not about retiring per-question plumbing.
- **Internal client state can still key on question ids.** Refs (`cardRefs`, `expandedWrapperRefs`), per-question cache entries (`questionCache`), and DOM keys all use question ids freely — they're stable internal identifiers, not URLs. The principle bites at the FE↔server boundary, not at internal data structures.

When designing a new feature: ask "is this a poll-level concept?" If yes, route through a poll endpoint or field; never sum/dedupe across questions in the browser.

**Status**: phasing plan in `docs/poll-phasing.md`. **Every phase shipped** (Phases 1 through 5b). The poll redesign is complete — all wrapper-level state lives on `Poll`, question data lives on `Question`, and the API contract reflects that boundary.

- **Phase 1 (schema + new API)** — migration 092 created the `polls` table and added nullable `poll_id` + `question_index` to `questions`; endpoints `POST /api/polls`, `GET /api/polls/{short_id}`, `GET /api/polls/by-id/{id}` create + read wrapper-and-questions atomically. Validation rejects participation questions, multiple `time` questions, and same-kind questions without distinct `context`. Auto-title is computed at read time from question categories + poll context (rules in `server/algorithms/poll_title.py`); explicit titles persist to `group_title`.
- **Phase 2.1 (frontend plumbing)** — `Poll` type in `lib/types.ts`, poll cache helpers in `lib/questionCache.ts`, `apiCreatePoll` / `apiGetPollByShortId` / `apiGetPollById` in `lib/api.ts`.
- **Phase 2.2 (writes route through polls)** — `app/create-question/page.tsx` calls `apiCreatePoll` for non-participation questions; participation keeps `apiCreateQuestion`. `app/g/[groupShortId]/page.tsx` loader tries `apiGetPoll*` first, falls back to `apiGetQuestion*` on 404 (uses exported `ApiError` for the status check). `next.config.ts` proxies `/api/polls` paths same-origin like `/api/questions`. Server-side `_resolve_parent_poll_id` translates `follow_up_to` QUESTION ids in the request into the parent's `poll_id` for the polls row, while the original question_id is also written onto each question's `questions.follow_up_to` so legacy group aggregation keeps working through Phase 5. `_insert_poll`'s group_title COALESCE has a third branch reading from the legacy parent question's `group_title` so groups with mixed-mode parents inherit titles correctly.
- **Phase 2.3 (What/When/Where bubble bar)** — replaced the single "+" FAB on group-like pages (`/group/<id>/`, `/p/<id>/`, `/group/new/`) with three pill buttons. Home page keeps the single "+" FAB which navigates to `/group/new/`. Each bubble preselects in the create-question modal: What → no preselection, When → `?mode=time`, Where → `?category=restaurant`. See "Navigation Layout" for full details.
- **Phase 4 (backfill)** — migration 093 wraps every non-participation question without a `poll_id` in a 1-question poll wrapper. After it runs, `polls.short_id` matches the source question's `short_id` (URLs preserved), `questions.poll_id` + `questions.question_index = 0` link them, and `polls.follow_up_to` references the parent's wrapper (NULL when the parent is a participation question). Migration is idempotent — `WHERE poll_id IS NULL` filter makes re-runs no-ops. The migration also self-heals dev DBs that lack `questions.short_id` / `questions.sequential_id` (a quirk where migration 030 dropped those columns and prod's Supabase-bootstrapped schema retained them but freshly-built dev DBs don't): a `DO` block adds them back when missing and back-fills sequential_id + short_id for pre-existing rows. No-op on prod.
- **Phase 2.5 (multi-question rendering)** — questions of one poll are treated as siblings when building groups. `Question` carries `poll_id` + `question_index` (server `QuestionResponse` exposes both, `_row_to_question` maps from DB, `toQuestion` maps to FE). `lib/groupUtils.ts: buildQuestionMaps` returns a `questionIdsByPoll` grouping (Phase 3.5 renamed `siblingsOf`); `collectDescendants` fans every visited question out to all its siblings. The group-page sort uses `question_index` as the tiebreaker for shared `created_at`. `server/algorithms/related_questions.py: QuestionRelation` carries `poll_id` + `poll_follow_up_to`; `get_all_related_question_ids` walks poll-level chains and expands every visited poll to its questions so discovery grants access to peer questions.
- **Phase 2.4 (multi-question create UI)** — `app/create-question/page.tsx` adds a `+ Add another section` button that calls `buildQuestionFromState()` to push a `CreateQuestionParams` onto a new `stagedQuestions` state, then resets per-question state (title, options, category, forField, optionsMetadata, ref location, min_responses, show_preliminary_results) while preserving poll-level state (creator name, voting cutoff, suggestion cutoff, details, follow_up_to). Staged rows render above the form; submit calls `questionDataToPollRequest(questionData, stagedQuestions)` (the helper now takes an `additionalQuestions` array that's prepended to the questions array — staged drafts come first, current form last). Persisted in the same `questionFormState` localStorage so modal close+reopen preserves the draft. The +Add button is hidden for `time` and `participation` (per MVP scope: no time-question staging; participation questions can't be questions at all). Submit is rejected client-side with a clear error if the user managed to switch to participation while staged questions exist. When staged questions exist AND `isAutoTitle === true`, the wrapper title is sent as `null` so the server's `generate_poll_title()` builds it from question categories — user-typed titles (isAutoTitle=false, e.g. yes/no questions) still pass through as the wrapper title. `recordQuestionCreation` is called for every question on success so the creator gets `creator_secret` access for each. Out of scope (Phase 3): per-question context UI, time-question staging, edit-staged questions, the dual-modal layout.
- **Phase 3.2 (group card aggregation)** — Sibling questions of a poll render as ONE card group instead of N cards. Server: `PollResponse` gains `voter_names: list[str]` + `anonymous_count: int` (computed via `_compute_poll_voter_data` — `array_agg(DISTINCT voter_name)` for named, `MAX(per-question anon)` for anon). Wired into every poll GET + close/reopen/cutoff endpoint. FE: group page iterates `groupedGroupQuestions` (memo grouping `groupQuestions` by `poll_id`); 1-question wrappers render identically to today, multi-question wrappers render one card with stacked `QuestionBallot` instances inside the expand clip (each with a section label = category icon + question's `details`). Poll wrapper is lazy-fetched via `apiGetPollById` on viewport intersection, stored in `pollWrapperMap`, refreshed on `QUESTION_VOTES_CHANGED_EVENT`. `VoterList` grows a static-data mode (`staticVoterNames` + `staticAnonymousCount`) that the group page uses to render the poll-level respondent row from the wrapper — never aggregated client-side per the Addressability paradigm. Copy-link routes through the poll's `short_id`. `maybeFetch` (results) treats anchor visibility as group visibility so every sibling's results are fetched together.
- **Phase 3.4 (unified vote endpoint + FE helper)** — `POST /api/polls/{poll_id}/votes` accepts `{voter_name, items: [{question_id, vote_id?, vote_type, ...}]}` and applies every item atomically inside a single transaction. Each item inserts (vote_id null) or updates (vote_id set) on its question_id; per-item validation, deferred-deadline arming, suggestion-phase enforcement, options_metadata merging, and auto-close all run inline so the unified path is functionally identical to N parallel per-question calls. Any item failure rolls back the whole batch — no half-applied state. `_submit_vote_to_question(conn, question_id, req, now) -> row` and `_edit_vote_on_question(conn, question_id, vote_id, req, now) -> row` are extracted from `routers/questions.py: submit_vote` / `edit_vote` so the per-question endpoints and the poll endpoint share the same logic; both helpers operate on a shared connection (no `with get_db()`) so the poll endpoint can wrap N calls in one transaction. FE helper `apiSubmitPollVotes(pollId, {voter_name, items})` lives in `lib/api.ts` alongside the existing per-question helpers; it cascades cache invalidation through `invalidatePoll` (which already evicts every question's per-question cache entry), so callers don't need to walk `items[]` manually. The `PollVoteItem` interface is exported.
- **Phase 3.4 follow-up A (poll-level Submit for all-yes_no multi-groups)** — When a group card holds 2+ yes_no questions (`isMultiGroup && group.subQuestions.every(sp => sp.question_type === 'yes_no')`), the per-question tap-to-vote-immediately flow is replaced by a wrapper-level Submit button + voter-name input rendered below the expand clip in `app/group/[groupId]/page.tsx`. Tapping yes/no/abstain on a question's external `QuestionResultsDisplay` writes to `pendingPollChoices: Map<question_id, 'yes'|'no'|'abstain'>` instead of firing `setPendingVoteChange`. The card's `userVoteChoice` reads staged-then-existing so the tapped pill highlights immediately. Submit is gated `disabled={submitting || !hasStagedChange}`; on confirm, `confirmPollSubmit(pollId, subQuestions)` builds a `PollVoteItem[]` from `buildPollItems(subQuestions)` (only questions with a staged choice), calls `apiSubmitPollVotes`, then distributes returned `ApiVote`s back into `userVoteMap` (keyed by `v.question_id` matched against `subQuestions`), syncs `setStoredVoteId` + `setVotedQuestionFlag` per item, fires `QUESTION_VOTES_CHANGED_EVENT` per item, and clears the staged choices for the poll. `pollVoterNames: Map<pollId, string>` keys the per-poll voter name input. Mixed-type multi-groups (yes_no + ranked_choice) and 1-question polls keep their existing per-question Submit flow until PR B lifts Submit out of `QuestionBallot` generally. Also: new `partOfPollGroup` prop on `QuestionBallot` suppresses the duplicate `<QuestionDetails details={question.details} />` render for multi-group questions (the group-page section label already shows `question.details` as the disambiguating context label). PR B will extend the same prop to gate Submit / voter name / confirmation.
- **`<QuestionDetails>` is also suppressed in single-question polls when `question.is_auto_title === true`.** The auto-title for time / ranked_choice questions encodes the per-question context as a "for X" suffix (e.g. a Time question with details="Partie" auto-titles as "Time for Partie"); rendering `details` below the title would surface the same string twice and read visually as if "Partie" were the question's "real" title separate from the poll's title. Yes/No questions store user-typed prompts (`is_auto_title === false`) and keep the details. The `=== true` comparison is deliberate: stale cached `Question` objects without the field default to `undefined`, which falls through to "show details" — matches the pre-rollout behavior. **`is_auto_title` flows through `lib/api/_internal.ts: toQuestion`** — when adding new fields to `QuestionResponse` server-side, audit `toQuestion` so the field actually reaches FE consumers (the field was on the Pydantic model + the FE `Question` type but missing from `toQuestion`, so every consumer got `undefined`).
- **Per-question section header is rendered ONLY in multi-question polls.** Format: `"<Label> for <Context>"` via `getQuestionSectionTitle(question)` in `lib/questionListUtils.ts`, mirroring the server's auto-title (e.g. a Time question with details="Partie" reads "Time for Partie" instead of just "Partie"). Without the type signal, a Time question's section header was indistinguishable from a Restaurant question's. The helper special-cases `time` (the Time bubble stores question_type=time but leaves category=custom, same load-bearing convention as `_category_for_title` server-side) and `yes_no` (server uses "Yes/No", BUILT_IN_TYPES has "Yes / No" — special-case keeps the FE in lockstep with server-generated wrapper titles). For single-question polls the card top already shows the question's title; rendering a section header underneath duplicated info, and for yes_no specifically it surfaced literal "Yes/No" right under the user's prompt — reading as if the category label were the title. The text branch is gated on `isMultiGroup` in `app/g/[groupShortId]/GroupCardItem.tsx`. **Hanging icon placement**: `HangingCategoryIcon` is `position: absolute` and anchors to its nearest `relative` ancestor's top edge, so the icon's parent must be a `relative` box for it to land in the correct column. Multi-question rendering keeps the existing `<div className="mb-2 relative">` header div as the icon's anchor + container for the title text. Single-question rendering moves the `relative` flag onto the OUTER section wrapper (the `<div key={sp.id}>`) and renders `HangingCategoryIcon` directly inside, with no intermediate header div — so the icon sits at the top of the section content area exactly as before, but the title text + its `mb-2` margin are gone and the rest of the question content (yes/no cards, QuestionBallot, etc.) slides up into the freed space. The earlier "must always render so closed-empty cases (e.g. ranked_choice with zero rounds = 'All voters abstained' with nothing else) keep an in-section identifier" rationale doesn't apply because the card top header always carries the title for single-question polls. **Per-question titles in multi-question polls**: every question row inside one poll shares the same `polls.title` (write-time), so reading `question.title` would surface the wrapper title for every section — `getQuestionSectionTitle` therefore uses the category label + per-question `details` (context) as the disambiguator, NOT `question.title`. If you reintroduce the section header for single-question polls, you reintroduce the redundant-title bug — guard new "must always render" use cases on `isMultiGroup` too. Putting the icon anchor on the outer `key={sp.id}` div is also load-bearing: an empty `<div className="mb-2 relative">` around just the icon would still consume the `mb-2` (8px) margin even with the title gone, leaving an unwanted gap above the question content.
- **`CompactRankedChoiceResults` renders the question's options list under the empty-state message** when `roundVisualizations.length === 0` (no votes OR all abstained). Without it, an expired all-abstain ranked_choice card collapses to just "All voters abstained" with no indication of what was on the ballot. The list pulls from `results.options` (already on `QuestionResults`, populated server-side); each row uses the existing `<OptionLabel>` so restaurant/location metadata renders the same as in the active ballot. The all-abstained branch is the canonical "All voters abstained" copy — earlier it stacked "No Votes" above "All voters abstained" as two separate `<p>`s, which read as redundant. The `total_votes === 0` branch keeps "No Voters" since "no one voted at all" is semantically distinct from "everyone voted abstain".
- **`confirmVoteChange` (yes_no tap-to-change for the non-staged path) routes through `apiSubmitPollVotes` when the question has a `poll_id`.** The group page's `confirmVoteChange` (used by 1-question yes_no polls AND by the yes_no anchor in mixed-type multi-groups where `usePollSubmit = isMultiGroup && allYesNo` is false) builds a single-item `PollVoteItem[]` and calls `apiSubmitPollVotes(pollId, { voter_name, items })`. The legacy `apiSubmitVote`/`apiEditVote` branch is preserved as a fallback for the `poll_id == null` case (theoretically unreachable for yes_no after the Phase 4 backfill, but kept for safety). On a fresh first-time vote the poll path also calls `saveUserName(voter_name)` so the name carries over to subsequent questions (matches the all-yes_no group flow).
- **`QuestionBallot.submitVote` also routes through `apiSubmitPollVotes` when `question.poll_id` is set** — same gate as the group page's `confirmVoteChange`. Builds a single-item `PollVoteItem` from the same `voteData` the legacy path uses, with `vote_id` set on edits / null on inserts. After this change, the only remaining `apiSubmitVote` / `apiEditVote` callsites in client code are the legacy fallbacks for `poll_id == null` — i.e. participation questions (kept on the legacy path forever) plus any not-yet-backfilled question. Suggestions are deliberately omitted from the item on ranked_choice edits past the suggestion-phase deadline (`isEditing && question.question_type === 'ranked_choice' && !canSubmitSuggestions`); the server's edit path uses `suggestions = COALESCE(%(suggestions)s, suggestions)` so sending `null` would also be safe, but matching the legacy `suggestions: undefined` pattern keeps the contract explicit. The explicit `invalidateQuestion(question.id)` call later in `submitVote` is intentionally NOT removed for the poll path: `invalidatePoll` only cascades to per-question evictions when the poll cache happens to be warm (`if (entry)` in `lib/questionCache.ts:178`); on a cold poll cache the question caches wouldn't be touched, so the explicit call is the safety net. Phase 3.4 follow-up B will lift Submit out of `QuestionBallot` entirely; this change retires the per-question endpoint usage one phase earlier so the wrapper-level lift becomes a pure UI refactor.
- **Phase 3.4 follow-up B (1-question case): wrapper-level Submit + voter name for every 1-question non-yes_no poll.** `QuestionBallot` is now a `forwardRef` component exposing `QuestionBallotHandle.triggerSubmit()`. New props on the component: `wrapperHandlesSubmit: boolean` (gates the inline Submit + voter-name + `CompactNameField` blocks in the time-availability and time-preferences branches AND propagates to `RankingSection` + `SuggestionVotingInterface` so they skip their internal Submit/voter-name); `externalVoterName?: string` and `setExternalVoterName?: (name) => void` (when passed, they override QuestionBallot's internal `voterName` state — `submitVote` always reads the wrapper-controlled value); `onWrapperSubmitStateChange?: (questionId, { visible, label }) => void` (fires whenever QuestionBallot's "should the inline Submit show + what does it say" computation changes — `visible` mirrors the original gating: hidden in the voted-not-editing steady state, visible during initial-vote and edit modes; `label` preserves the type-specific copy "Submit Vote" / "Submit Availability" / "Submit Preferences"). The `useImperativeHandle` for `triggerSubmit` is wrapped via a `useRef`-stashed `handleVoteClick` closure so the handle stays stable across renders while always invoking the latest closure. The `getUserName` initial-load `useEffect` skips when `wrapperHandlesSubmit` is true so QuestionBallot doesn't fire the wrapper's setter from inside the child on mount.
  - **Group page wiring** (`app/group/[groupId]/page.tsx`): `subQuestionBallotRefs: Map<string, QuestionBallotHandle>` collects per-question handles via callback refs. `wrapperSubmitState: Map<string, { visible, label }>` stores the per-question state from `onWrapperSubmitStateChange` (uses a single ref-cached stable callback so QuestionBallot's effect deps don't churn across parent re-renders). The wrapper Submit + voter-name JSX renders inside the same overflow-hidden expand clip as the all-yes_no follow-up A wrapper Submit, gated by `useWrapperSubmit = !isMultiGroup && !!group.pollId && group.subQuestions[0]?.question_type !== 'yes_no'`. The voter name input reads from / writes to the existing `pollVoterNames: Map<pollId, string>` (shared with follow-up A's all-yes_no flow). The Submit button calls `subQuestionBallotRefs.current.get(sp.id)?.triggerSubmit()` which routes to QuestionBallot's existing `handleVoteClick` → `ConfirmationModal` → `submitVote` → `apiSubmitPollVotes` flow — no duplication of submit machinery, no double-modal.
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
- **Phase 3.3 (non-anchor yes_no external rendering)** — Every yes_no question in a multi-group now uses the group-page's external Yes/No card (full results + tap-to-change → confirmation flow), not just the anchor. Implementation: the standalone external Yes/No block at the top of the card (gated on `question.question_type === 'yes_no' && isExpanded`) was REMOVED. The external card is now rendered INSIDE the per-question loop (`group.subQuestions.map`), immediately above each yes_no question's `QuestionBallot`. `useExternalYesNo` simplifies to `sp.question_type === 'yes_no'` (no anchor-only carve-out). Each external card reads `questionResultsMap.get(sp.id)` + `userVoteMap.get(sp.id)` and dispatches `setPendingVoteChange({ questionId: sp.id, newChoice })` so non-anchor questions go through the same confirmation modal + `apiEditVote` / `apiSubmitVote` flow as the anchor. QuestionBallot still mounts for yes_no questions but its yes_no branch returns null (`externalYesNoResults={true}`), preserving its data-fetching effects. The `allYesNo` margin guard relaxes from `allYesNo && !isMultiGroup ? '' : 'mt-1.5'` to `allYesNo ? '' : 'mt-1.5'` since multi-group all-yes_no cards now have their own `mt-2` per external block. Mixed groups (yes_no + ranked_choice + ...) preserve the user-defined `question_index` order because the external card is inline with its question, not lifted to the top of the card.
- **Phase 3.2 follow-up (stacked compact pills)** — The footer-row pill slot in `app/group/[groupId]/page.tsx` previously rendered only the anchor question's preview, leaving secondary winners invisible (e.g. a Yes/No+Restaurant card showed the Yes/No tally but hid the restaurant winner). The IIFE now extracts a `pillForQuestion(sp)` helper that returns the type-specific pill JSX (or null) for any question. Single-question groups: unchanged — yes_no still bypasses `CompactPreviewClip` (the pill is omitted when expanded because the full Yes/No cards take over below), other types still wrap in the clip. Multi-question groups: one pill per question, stacked vertically (`flex flex-col items-end gap-1`) inside a single `CompactPreviewClip` so the whole column animates to 0 in lockstep with the heavy expand clip. Sub-questions with no data yet (no votes / no suggestions) drop their row so the column stays compact. Pattern to extend: when adding a new question-supported type, add a branch to `pillForQuestion(sp)` — both the single-question and multi-question callsites pick it up automatically.
- **Phase 3.1 (poll-level operations)** — `POST /api/polls/{id}/{close,reopen,cutoff-suggestions,cutoff-availability}` close/reopen/cutoff the wrapper + every question atomically (single transaction). `close` re-runs `_finalize_suggestion_options` for any ranked_choice question mid-suggestion-phase (mirrors the per-question flow). `cutoff-suggestions` advances every question in a suggestion phase that has at least one suggestion vote, returning 400 only if NO question advanced. `cutoff-availability` targets the (≤1 enforced on create) time question. All four authorize on `polls.creator_secret`. FE: `apiClosePoll` / `apiReopenPoll` / `apiCutoffPollSuggestions` / `apiCutoffPollAvailability` in `lib/api.ts` (each invalidates + re-caches via the shared `pollOperation` helper). Group page long-press handlers (`app/group/[groupId]/page.tsx`) detect `action.question.poll_id` and route to the poll endpoint when set — the optimistic `setGroup` updater rewrites every sibling sharing the same `poll_id` (not just `id === action.question.id`) so closing one card visually closes them all. Falls back to `apiCloseQuestion` / `apiReopenQuestion` / `apiCutoffAvailability` when `poll_id` is null (participation questions).

**Every question now has a poll wrapper.** (Migration 094 removed the participation question type that was the lone exception.)

Frontend conventions for the poll plumbing:
- The exported `QuestionType` alias in `lib/api.ts` (`'yes_no' | 'ranked_choice' | 'time'`) is the canonical "what question types can be questions". Don't re-inline this union — the `participation` exclusion is enforced server-side too, and a shared alias keeps the two layers in sync.
- The `Poll` interface in `lib/types.ts` uses `| null` for nullable fields, while the legacy `Question` interface uses `| undefined`. This divergence is intentional: `toPoll` consistently maps with `?? null` while `toQuestion` uses `?? undefined`. Don't mix the two patterns inside one mapper, and don't migrate `Question` to `null` as a side effect of poll work.
- `cachePoll(poll)` automatically calls `cacheQuestions(poll.questions)` so subsequent `apiGetQuestionById` calls for any question hit warm cache. Conversely, `invalidatePoll(id)` cascades to `invalidateQuestion(sub.id)` for every question. This is the documented behavior — don't add another path that caches a poll without going through `cachePoll`, or question cache state will go stale.
- New API endpoint families share error handling via `fetchWithBase(base, path, options)`. The `apiFetch` (questions) and `pollFetch` (polls) wrappers exist only to bind the base URL. When adding a third endpoint family, mirror the pattern instead of duplicating the error-parsing logic.
- `CreatePollRequest.follow_up_to` carries a QUESTION id, not a poll id — same shape as the legacy `apiCreateQuestion`. The frontend never has to ask "is the parent a poll?". The server resolves to the parent's poll_id (or NULL for legacy parents) inside the create transaction. If you ever need to expose the poll-level reference directly (e.g. for an admin tool), add a separate field; don't repurpose this one.
- **Phase 3.5: poll-level `follow_up_to` is the source of truth for group chains.** `QuestionResponse` carries `poll_follow_up_to` (the wrapper's `follow_up_to`, a poll_id) populated via `LEFT JOIN polls mp ON p.poll_id = mp.id` in every server SELECT that feeds `_row_to_question` for FE consumption. Helper: `_SELECT_QUESTION_WITH_POLL_PREFIX` for SELECTs, `_attach_poll_chain_fields(conn, row)` for UPDATE/INSERT RETURNING * paths. `lib/groupUtils.ts: buildQuestionMaps` walks `Question.poll_follow_up_to` to build the parent→child poll edge map; `collectDescendants` fans out from any visited question to its siblings + the questions of the parent poll + the questions of every child poll. `findGroupRootRouteId(question, questionByPoll?)` walks the poll chain to the root — callers pass an optional `poll_id → Question` resolver (built from cached accessible questions) to avoid scanning the cache list twice per step. The legacy `questions.follow_up_to` column is still populated on writes (Phase 5 retires it) but the FE no longer reads it for chain logic.
- `questionDataToPollRequest(questionData, additionalQuestions?)` in `app/create-question/page.tsx` is the canonical mapper from the existing flat questionData into a poll request. Wrapper-level `context` carries today's `details` field; per-question `context` is reserved for the eventual disambiguation flow. The `additionalQuestions` parameter (Phase 2.4) is prepended to the questions array — staged drafts come first, the current form's question last. Add new fields to EITHER the poll-level OR question-level branch — never both — and keep participation questions on the legacy `apiCreateQuestion` path.
- **State → `CreateQuestionParams` is mapped in two places** — `questionDataToPollRequest` (current form, via the flat questionData) and `buildQuestionFromState` (staged sections, reads state directly). They MUST keep the same field shape; Phase 3 will likely consolidate these once the dual-modal flow lands. If you add a new per-question field, update both. The shared `validateRankedChoiceOptions(options, category)` module-level helper is the single source of truth for ranked-choice option validation; both `getValidationError` (full submit) and `getQuestionValidationError` (staging button) call it — don't duplicate the gap/length/uniqueness checks again. `questionDataToPollRequest`, `validateRankedChoiceOptions`, `shortenOption`/`shortenLocation`, and the deadline option arrays (`BASE_DEADLINE_OPTIONS`, `FRACTIONAL_CUTOFF_OPTIONS`, `ABSOLUTE_CUTOFF_OPTIONS`, `DEV_DEADLINE_OPTIONS`) live in `app/create-question/createQuestionHelpers.ts` — keep new pure helpers there too rather than buffering `page.tsx` with module-local noise.
- **`buildVoteData` + `buildPollVoteItem` in `components/QuestionBallot/voteDataBuilders.ts` are the single source of truth for FE vote-payload construction.** `QuestionBallot.submitVote` / `prepareBatchVoteItem` AND the group page's `confirmVoteChange` / `buildYesNoPollItems` all route through them. When a new field lands on `PollVoteItem`, update only these helpers (and `PollVoteItem` itself in `lib/api.ts`) — the four callsites pick it up automatically. The validators emit identical error strings across the immediate-submit and batched paths, so users see the same message regardless of where they tapped Submit. `BallotInputs.questionType` is `QuestionType` (`yes_no | ranked_choice | time` from `lib/api.ts`) — don't widen with `| string`.
- **Sibling questions share a `created_at`** (they're inserted in one transaction). Sort tiebreakers must use `question_index` to preserve the creator's intended order. The `question_index` is 0 for backfilled (1-question) wrappers; multi-question polls get sequential 0..N-1. `lib/groupUtils.ts: collectDescendants` already does this — mirror the pattern in any new sort that involves questions.
- **Per-question context lives in `questions.details`** (per Phase 2.2 mapping). Poll-level context lives in `polls.context`. They are NOT the same column. When the Phase 2.4 dual-modal flow lands and exposes per-question context as a UI field, it should write to `questions.details` for each question independently. Do not conflate the two; the existing `questionDataToPollRequest` writes the same value to BOTH for 1-question polls because there's only one ambiguous "context" the user could mean.
- **Server `_row_to_question` is the only place that maps DB rows to `QuestionResponse`.** When adding a new field, update `_row_to_question` (in `server/services/questions.py`), the `QuestionResponse` Pydantic model (in `server/models.py`), the FE `Question` interface (in `lib/types.ts`), and `toQuestion` (in `lib/api.ts`). Missing any of the four results in a silent NULL on the FE. Phase 2.5 added `poll_id` + `question_index` through this exact path.
- When adding a new `/api/<family>` endpoint, also add the rewrite in `next.config.ts: nextConfig.rewrites` (three entries: bare, trailing slash, `/:path*`). Without these, FE calls 404 from Next.js itself before reaching the proxy. Phase 2.2 hit this — the create UI silently failed loading polls until the rewrites landed.
- **Poll-level mutations must rewrite every sibling in the optimistic state update.** When `action.question.poll_id` is set, the close/reopen/cutoff handlers call `apiClosePoll(pollId, ...)` etc. — that hits every question on the server. The matching `setGroup` updater needs to filter on `p.poll_id === pollId`, NOT `p.id === action.question.id`, otherwise siblings stay visually open until a refresh. The legacy `p.id === action.question.id` path is kept only for the participation-question fallback (`poll_id` is null). Same logic applies to anything else that mutates question-shared state (e.g. follow-up creation, future Phase 3.2 voting endpoints).
- **Don't share `_finalize_*` helpers between routers by re-implementing them.** Both `routers/questions.py` and `routers/polls.py` import `_finalize_suggestion_options`, `_finalize_time_slots`, `_submit_vote_to_question`, `_edit_vote_on_question` etc. from `services/questions.py` — they're free functions on a connection and per-question-id, so reuse is clean. If you find yourself re-writing one of these in a router, that's a sign the helper is mis-scoped (extract it to `services/` or `algorithms/` instead). `_submit_vote_to_question(conn, question_id, req, now)` / `_edit_vote_on_question(conn, question_id, vote_id, req, now)` were extracted from `submit_vote` / `edit_vote` for the Phase 3.4 unified vote endpoint and are re-used directly inside the poll batch transaction. Both helpers raise `HTTPException` on validation failure (rolling back the entire batch); they don't open their own DB connection so the caller controls the transaction scope.

  > **Note (post-migration 094):** `_resolve_question_winner` was deleted along with the participation question type — it only made sense for the location/time question resolution flow. The pattern still applies to `_finalize_suggestion_options` / `_finalize_time_slots`.
- **Poll endpoint tests need `DISABLE_RATE_LIMIT=1` and ideally a per-test DB.** The existing `test_polls_api.py` defaults `DATABASE_URL` to `postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants` which on the dev droplet is the prod-shaped DB; the migration 093 backfill of real questions' short_ids into polls leaves the polls sequential_id sequence un-aware of the backfilled rows, so when tests advance the sequence they eventually collide on `polls_short_id_key`. Run tests against `dev_sam_at_samcarey_com` (smaller dataset, no collisions in practice) with rate limit off: `DATABASE_URL='...dev_sam...' DISABLE_RATE_LIMIT=1 uv run pytest tests/test_polls_api.py`. The sequence-collision is a pre-existing migration bug (out of scope here); a future cleanup should bump the sequence past the highest backfilled `encode_base62_inverse(short_id)` after Pass 1.
- **`dev_sam_at_samcarey_com` lacks the `questions.short_id` INSERT trigger.** Migration 093 self-heals the `questions.short_id` and `questions.sequential_id` columns on dev DBs but doesn't recreate the `trigger_generate_short_id` BEFORE-INSERT trigger that prod has. Result: legacy `POST /api/questions` tests (`tests/test_questions_api.py::TestCreateQuestion`, `TestGetQuestion::test_get_question_by_short_id`) fail on dev_sam with `short_id IS NULL` in the response. They pass against the prod-shape `whoeverwants` DB. If you need the legacy create endpoint to work on dev_sam, add the trigger via a one-shot psql command (don't bake it into a migration — prod already has it).
- **Surfacing a poll-level field on every `Question` response means updating *every* questions SELECT that feeds `_row_to_question`.** Phase 3.5 added `poll_follow_up_to` (the wrapper's chain pointer). The pattern: a `_SELECT_QUESTION_WITH_POLL_PREFIX` helper that does `SELECT p.*, mp.follow_up_to AS poll_follow_up_to FROM questions p LEFT JOIN polls mp ON p.poll_id = mp.id` (callers append `WHERE p.<column> = ...`), plus an `_attach_poll_chain_fields(conn, row)` helper for `RETURNING *` paths (UPDATE/INSERT) that does a separate lookup. `_row_to_question` reads `row.get("poll_follow_up_to")` and gracefully returns None when the field is absent — so SELECTs that don't go through the prefix simply produce a None field on the FE rather than an error. The legacy `POST /api/questions` create path skips `_attach_poll_chain_fields` entirely because it always inserts `poll_id IS NULL`. When adding a similar wrapper-level field in the future (Phase 5 will add more), follow this pattern and don't forget the `PollResponse` questions list — `_row_to_poll` enriches each question row inline since it already has the wrapper's value in scope (no extra DB lookup).
- **Don't reinvent the `poll_id → Question` Map lookup.** `lib/groupUtils.ts` exports `buildQuestionByPollMap(questions)` — every callsite that needs to resolve a question for a poll_id (e.g. for `findGroupRootRouteId`'s chain walk) should use it, prepending the current question if it isn't yet in the cached accessible list (`buildQuestionByPollMap([question, ...accessible])`). The first occurrence per poll wins, so the prepend ensures the live question wins over a stale cache entry. Earlier Phase 3.5 code had this pattern duplicated inline in three places; consolidate any new callsite onto the helper.
- **Use `findChainRoot(polls)` for "pick the chain root from a list of polls."** Lives in `lib/groupUtils.ts`. Returns `polls.find(mp => !mp.follow_up_to) ?? polls[0]` (or null on empty input). The fallback to `polls[0]` is load-bearing under Phase C.3 visibility filtering — when ancestor polls are hidden from the caller, the visible polls all carry a `follow_up_to` pointing outside the visible set, and a strict `find(!follow_up_to)` returns undefined. `polls[0]` (oldest visible) is the right anchor for `buildGroupFromPollDown` so the group renders the partial chain rather than 404'ing. Used by `buildGroupSyncFromCache`, `useGroup`, `GroupContent.fetchGroup`, `GroupPageInner.rootInitial`, and `GroupPageInner`'s async fetch — every "I have a list of this group's polls, what's the root?" site routes through this helper. Don't re-inline the find/fallback pair, and don't add a separate `polls.length === 0` guard before the call — the helper already returns null for empty input.
- **Audit-write rule for vote/create paths: decoupled transactions for membership writes.** Anything triggered by a vote/create/abstain that needs to write to `group_members` MUST run in its own `get_db()` transaction, NOT share the action's transaction. Pattern: helper functions in `services/memberships.py` that open their own connection, run `INSERT … ON CONFLICT DO NOTHING`, and `try/except Exception: log+continue` so audit failures don't block the action and action failures don't strand audit rows. The composite-PK `ON CONFLICT` is load-bearing: re-voting must NOT advance `joined_at`, since visibility compares poll closure timestamps against that watermark. Order in the handler: vote/abstain endpoint writes membership BEFORE the vote (so a rejected vote still records "attempted to participate"); poll-create endpoint writes membership AFTER the create (the root-poll's `group_id` only exists post-`_insert_poll`). The visit-path auto-join (migration 106) is the EXCEPTION — `services/groups.py: grant_group_membership_inline` runs on the CALLER'S connection because the read endpoint already holds one and the visibility filter immediately downstream needs to see the new row. Counterpart `services/memberships.py: leave_group(conn, group_id, browser_id)` also runs inline on the caller's connection. The DELETE silently affects 0 rows when no row exists, which is the intended idempotent semantics.
- **Use `_browser_id(request)` in `routers/polls.py` rather than `getattr(request.state, "browser_id", None)`.** `BrowserIdMiddleware` always sets the field, but the `getattr` fallback is the safe form for the rare path that doesn't go through middleware (direct `TestClient` instantiation, internal call sites). The helper exists because Phase C handlers will all reach for it; don't re-inline the `getattr`.
- **Fuse poll → group_id lookups with the audit-write SQL.** `join_group_for_poll(poll_id, browser_id)` does `INSERT INTO group_members SELECT group_id, %(browser_id)s FROM polls WHERE id=%(poll_id)s ON CONFLICT DO NOTHING` — one statement, one round-trip. Don't re-introduce a separate `SELECT group_id FROM polls` followed by an INSERT; that doubles the hot-path RTT.
- **Visibility helpers live in `services/groups.py`** (`UserVisibility`, `load_user_visibility`, `filter_visible_polls`, `grant_group_membership_inline`). Both groups endpoints share them — adding visibility enforcement to a third endpoint would call `load_user_visibility(conn, browser_id, legacy_question_ids=...)` once and pass the result to `filter_visible_polls(conn, candidate_pids, visibility)`. Don't reinvent the rule inline; the helper is the single source of truth so changes (e.g. a dedicated `closed_at` column, retiring the legacy bridge) ripple through every read path. Migration 106 dropped `access_poll_ids` from `UserVisibility` along with the per-poll signal — the visibility rule is now group-membership + the legacy bridge.
- **The legacy `accessible_question_ids` bridge is GROUP-level, not poll-level.** The Phase B.3 contract is "any question_id grants access to its whole group" (the FE always passed one question_id and got every poll in the group back). The bridge preserves this for backwards-compat: `bridged_group_ids` resolves question_ids → group_ids, and the visibility filter shows every poll in those groups with no closed_at filter. A per-poll bridge would silently shrink groups on first refresh post-rollout. Slated for retirement once enough rollout time has passed for active browsers to acquire `group_members` rows via the auto-join paths (vote / create / visit).
- **Forget bridge in `/api/groups/mine`.** When `accessible_question_ids` is non-empty, member-groups are narrowed to those still represented in the bridge list. Without this, a `group_members` row would keep a group alive on the home list even after the user forgot every question in it. Membership-only callers (empty list) skip the narrowing — the bridge is opt-in. Eventually retired once `apiLeaveGroup` (forget-of-last-poll) becomes the standard exit path.
- **Visibility uses `polls.updated_at` as the `closed_at` proxy.** The close trigger refreshes `updated_at` on every `is_closed` flip, so it tracks closure timing accurately for the initial close. Subsequent edits to a closed poll bump `updated_at` forward — that makes the visibility filter slightly more permissive (a closed poll touched after the user joins becomes visible) but never less. A dedicated `closed_at` column would be marginally tighter; not worth the migration cost in C.3.
- **Updating tests when the visibility contract changes.** `test_groups_api.py` was originally written for Phase B.3's "no enforcement" behavior and called the read endpoints with no X-Browser-Id header (TestClient mints fresh browser_ids per request, so the read had no membership). Phase C.3 added a `browser_id` fixture and a `_bid_headers` helper so tests pin the same browser through create + read calls — making the creator a group member that the read endpoints can see. When adding new tests for endpoints under visibility enforcement, follow this pattern: don't trust auto-minted ids to maintain identity across requests.

This section captures the design decisions from the original conversation so future sessions can reference them without re-asking.

### Core paradigm

- **Every question is a poll** containing one or more questions. Existing single questions migrate to 1-question polls (destructive DB migration). A 1-question poll renders the same as today's question — the wrapper is invisible in the UI for that case.
- **Participation questions were removed in migration 094.** Older "Phase X" notes below mention them as a separate codepath; that's stale — every question now has a poll wrapper.

### Entities

- **Poll**: top-level entity. Owns: optional context, voting cutoff, optional shared suggestion/availability cutoff, `follow_up_to`, `is_closed`, `close_reason`, `creator_secret`, `short_id`. Reachable inside its group via `/g/<groupRoot>?p=<shortId>`.
- **Sub-question**: a category-specific ballot section inside a poll. Owns: category, options, optional context, `question_type` (`yes_no`, `ranked_choice`, `suggestion`, `time`). Does NOT own: deadline, `is_closed`, `creator_secret` — all inherited from the parent poll.

### Cutoffs and phases

- A poll has ONE voting cutoff and AT MOST ONE shared suggestion/availability cutoff.
- A question has a "prephase" (suggestion or availability collection) only if its category supports one — `yes_no` does not. When in prephase, the question uses the poll's shared prephase cutoff.
- "In prephase" is a poll-level state, not a question-level state. All questions open for voting at the same moment — once the shared prephase cutoff has passed (if any), every ballot opens together.
- Cutoff actions (cutoff suggestions, end availability phase) operate at the poll level. The two cutoff buttons in the long-press modal merge into one shared "End Pre-Phase" action.
- Close, Reopen, Forget all operate at the poll level. Long-press on the group card opens the modal for the whole poll, not a single question.

### Creation flow

- Three "bubble" buttons replace the single "+" FAB on home and group pages: **What**, **When**, **Where**, equally spaced along the bottom.
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

### Follow-up / groups

- `follow_up_to` lives at the poll level (Phase 3.5: also the FE source of truth for group chain walking). Groups = chains of polls. Forks were removed in migration 095.
- On group pages, the What/When/Where buttons auto-set `follow_up_to` to the latest poll in the group (same as today's FAB behavior reads `data-group-latest-question-id`).

### URLs

- Single route: `/p/<shortId>/`. The `shortId` belongs to the poll, not a single question.
- Single-question polls render identically to today's questions — the poll wrapper is invisible.

### Migration

- One destructive migration wraps every existing non-participation question in a 1-question poll row.
- `follow_up_to` is rewritten to point poll → poll.
- Participation questions are NOT touched by this migration; they continue to function on their existing standalone codepath.

### Link-Preview Metadata (Open Graph / Twitter Cards)

Sharing `/g/<group>?p=<pollShortId>` to iMessage / Slack / Twitter / etc. should render a card with the linked poll's title. Implementation:

- **Backend `GET /api/groups/by-route-id/{route_id}/preview` (`server/routers/groups.py`)** is a public, identity-free endpoint that returns ONLY `{title, description}`. No visibility filtering, no membership writes — crawlers have no browser identity, and gating them on visibility would 404 every share. Returning ONLY title + description (never vote data, voter names, or per-question contents) keeps the surface tight enough that "anyone with the URL can see it" is acceptable. The matching `GroupPreviewResponse` Pydantic model is defined inline in the same router file. **Title** is the poll's auto-generated title via `generate_poll_title(...)`; the `group_title` override is intentionally bypassed so a custom group name (often a participant-name string like "Alice, Bob") doesn't replace the poll's actual subject. **Description**: comma-joined options across the poll's questions if any are set; else the poll's `details` (Notes); else null. Capped at 200 chars. The endpoint accepts an optional `?p=<pollShortId>` to target a specific poll within the group; otherwise it falls back to the group's most recent poll by `created_at DESC`.
- **Frontend metadata is on a server-component `app/g/[groupShortId]/page.tsx`**, NOT on a layout. The actual client UI lives in `app/g/[groupShortId]/GroupPage.tsx` (`"use client"`); the new `page.tsx` is a thin server-component shell that exports `generateMetadata` and default-exports `<GroupPage />`. The shell exists ONLY to access `searchParams.p` — page-level `generateMetadata` receives `searchParams`, layout-level does NOT. Without this split, the layout would have to pick a poll heuristically (latest by `created_at`) and shares of older polls in a multi-poll group would surface the wrong title. When you need to add metadata to ANY route whose page is `"use client"`, follow this same split: rename existing → `<RouteName>.tsx`, new `page.tsx` is server-component with `generateMetadata` + `import + default-export`.
- **Use `getApiEndpoint('groups')` from `lib/api/_internal.ts`** for the server-side fetch. Don't roll your own SSR-aware base URL helper — the existing one already handles `NEXT_PUBLIC_API_URL` overrides + branch-slug resolution + the `typeof window === 'undefined'` SSR branch. Earlier this work introduced a duplicate `lib/serverApi.ts` that missed the `NEXT_PUBLIC_API_URL` case; deleted in favor of the existing helper. The existing fetch wrapper `fetchWithBase` in `_internal.ts` is intentionally bypassed here — it injects `X-Browser-Id` (which would mint per-crawler `group_members` rows on the visibility-aware endpoint), and the preview endpoint is identity-free anyway.
- **Cache lightly: `next: { revalidate: 60 }`** on the metadata `fetch` so repeated crawls don't hammer the API but a poll's title becomes preview-correct within a minute of an edit. Next.js's Data Cache keys on the full URL including search params, so `?p=A` and `?p=B` are independent entries. If you change the schema (add a field to `GroupPreviewResponse`), bump the revalidation window down to 0 once and back to 60 after the rollout, or wait the cache out.
- **No `og:image` / `twitter:image`** on group previews. Per user spec: messaging-app previews dedicate the freed space to the title at larger size. Note: Next.js child Metadata REPLACES the parent's `openGraph` and `twitter` blocks entirely (NOT field-by-field merge), so simply omitting the `images` array on the child is enough to drop the inherited 512×512 image — no explicit `images: undefined` needed.
- **`metadataBase: new URL('https://whoeverwants.com')` on the root layout** (`app/layout.tsx`) is required for any relative-URL `og:image` / `twitter:image` to resolve. Without it, Next.js emits a relative path that crawlers can't fetch and skips the thumbnail. Even though group previews are imageless, root-level image metadata still needs `metadataBase` set so the home / settings / create-poll routes' previews work.
- **`_category_for_title(question_row)` in `routers/polls.py`** is the canonical source for "what category string should drive the auto-title for this question?" Time questions store `category="custom"` in the DB even when the user picked the Time bubble (the form's default category is "custom" and the bubble doesn't override it post-Phase-2.3). The helper returns `"time"` for any row with `question_type="time"` regardless of the stored category, so a time poll auto-titled "Time for Movie" doesn't get re-rendered as "Custom for Movie" by `_compute_display_title` or the link-preview endpoint. The helper is shared between `_compute_display_title` (in-app) and `get_group_preview` (link previews) so they can't drift. If you add a new question type whose category column may diverge from its conceptual category, extend this helper rather than fixing it at each callsite.
- **Pitfall: visibility-gated reads return [] to crawlers.** The visibility-aware `GET /api/groups/by-route-id/{id}` enforces `group_members` visibility against the request's `browser_id`. Server-component metadata fetches from Vercel run with no browser identity → fresh middleware-minted browser_id → membership inline-grant fires → SSR fetch sees only the polls in this brand-new "membership window" (open polls, closed polls untouched since the SSR call started). For link-preview content that should reflect a poll regardless of close timing, use the public `/preview` endpoint (separate route, no membership writes). Don't try to hack visibility-bypass into the visibility-aware endpoint; keep "public preview" and "authenticated read" as separate URLs with separate threat models.
- **Pitfall: Next.js metadata cache outlives the deploy.** After a server-side preview-format change (e.g. fixing the time-question category bug), the FE cached the OLD `{title, description}` body for up to 60s — `curl http://localhost:3001/g/<id>/?p=<poll>` keeps returning stale `<title>` until the cache window expires or you cache-bust by adding any unrelated query param. When verifying preview changes on dev, expect a 60s lag or hit a slightly different URL.

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
- Pushes to ANY branch that touch `capacitor.config.ts`, `ios/**`, `package.json`, `package-lock.json`, the workflow file, or `scripts/ios/**`. `main` builds the prod bundle (`com.whoeverwants.app`); every other branch builds the per-developer dev bundle (`com.whoeverwants.app.dev.<github-actor>`) so each contributor can install their dev build alongside prod without collision. Concurrency is keyed on `github.ref` with `cancel-in-progress: true`, so rapid pushes to the same branch only run the latest commit.
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
- **`contentInset: 'always'` produces visible black bars at the top and bottom on iPhone X-class devices.** The setting pads the WebView's scroll view away from the safe areas, exposing the configured `backgroundColor` underneath as a solid bar. The web app already handles safe areas itself (`viewport-fit=cover` + `env(safe-area-inset-*)` padding throughout), so the WebView should go edge-to-edge — use `contentInset: 'never'` in `capacitor.config.ts`. Pair with `backgroundColor: '#ffffff'` so any brief flash during load matches the page bg in light mode (Capacitor doesn't support theme-aware config values).
- **UIWindow's default `backgroundColor` is black, which leaks as a bottom-of-screen bar if the WebView's frame doesn't fully cover the window.** `CAPBridgeViewController.loadView()` is `final` and assigns `view = webView` — you can't restructure the view hierarchy. Defenses: (a) `AppDelegate.didFinishLaunchingWithOptions` sets `window?.backgroundColor = .systemBackground` (window is non-nil here for non-UIScene apps with `UIMainStoryboardFile` in Info.plist), (b) a `MainViewController: CAPBridgeViewController` subclass overrides `viewDidLoad` to set `view.backgroundColor = .systemBackground`. Use `.systemBackground` (not `.white`) so dark-mode users don't see white safe-area zones against a near-black page. Capacitor already writes `webView.backgroundColor` + `scrollView.backgroundColor` from `capacitor.config.ts` (CAPBridgeViewController.swift L308-310) — don't redo those in the subclass.
- **Adding a new `.swift` file requires hand-patching `project.pbxproj`.** `npx cap sync ios` doesn't pick up new native files — it only syncs web assets and plugins. Xcode's GUI handles file-add via PBXBuildFile + PBXFileReference + group children entries, but the headless CI build has no GUI. For small additions (1–2 short classes), colocate inside `ios/App/App/AppDelegate.swift` which is already in the build phase. Reserve new files for non-trivial code where colocation hurts readability.
- **Storyboard `customClass` references use the Xcode target name as `customModule`.** `<viewController customClass="MainViewController" customModule="App" customModuleProvider="target"/>` resolves to the `MainViewController` Swift class in the `App` target. Verify with `grep "name = " ios/App/App.xcodeproj/project.pbxproj` — the target name is the source of truth. Capacitor's default scaffold uses `customModule="Capacitor"` because the bridge VC ships from the Capacitor SPM package; subclasses defined in the app target need `customModule="App"` and the `customModuleProvider="target"` attribute.

---

## App Icons

The 👋 waving-hand emoji is the canonical app icon, rendered on a black rounded-rect background. Every icon file in the project is a render of the same SVG template — keep them in sync when changing the artwork.

### Inventory

| File | Size | Used by |
|---|---|---|
| `app/icon.svg` | viewBox 100×100 | Next.js metadata convention — auto-served at `/icon` as the browser favicon. |
| `public/icon-180x180.png` | 180×180 | `<link rel="apple-touch-icon">` in `app/layout.tsx` (iOS Safari "Add to Home Screen"). No SVG source — rendered from `public/icon-512x512.svg`. |
| `public/icon-192x192.svg` + `.png` | 192×192 | `<link rel="icon">` in `app/layout.tsx` + PWA manifest (`public/manifest.json`). |
| `public/icon-256x256.svg` + `.png` | 256×256 | PWA manifest only. |
| `public/icon-384x384.svg` + `.png` | 384×384 | PWA manifest only. |
| `public/icon-512x512.svg` + `.png` | 512×512 | `<link rel="icon">` in `app/layout.tsx` + PWA manifest. Also the source for the 180×180 PNG and the iOS app icon. |
| `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` | 1024×1024 | iOS Capacitor app icon (loaded by Xcode build into the bundle). Must be **opaque RGB** — no alpha channel — or TestFlight rejects with `Missing required icon file`. The rounded corners on the source SVG are composited onto a white background to fill them. |

### SVG template

All five `public/icon-*.svg` files (and `app/icon.svg`) share the same body:

```svg
<rect width="100" height="100" fill="#000000" rx="15"/>
<text x="52" y="75" font-size="74" text-anchor="middle" fill="white">👋</text>
```

Tuned so that the visible glyph (hand + motion lines) leaves ~12% gap on each side of the frame. The `x=52` (rather than 50) and `y=75` (rather than the line-box-centered ~88) compensate for Noto Color Emoji's 👋 glyph being slightly off-centered within its em-square.

### Regenerating PNGs

The PNGs are rendered via headless Chromium so they pick up Noto Color Emoji (Apt: `fonts-noto-color-emoji`) — that font ships on both the dev droplet and in the GitHub Actions runners, so renders are reproducible. The one-shot script lives in conversation history (search for `regen-icons.mjs`); rerun it whenever the SVG template changes:

1. For each `public/icon-NxN.png` (and the iOS 1024×1024), load the matching SVG into a Chromium page with viewport=N×N.
2. `page.screenshot({ omitBackground: true })` for the public PNGs (preserves rounded-rect transparency).
3. For the iOS PNG, render with white page background and `omitBackground: false` so the corners outside the rounded rect are filled white (then PIL converts RGBA→RGB).
4. The `public/icon-180x180.png` is rendered from `icon-512x512.svg` at viewport 180×180 (no dedicated 180-size SVG).

Don't render with `librsvg2-bin`'s `rsvg-convert` — it doesn't support color emoji and falls back to monochrome glyphs.

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

- **Historical migrations (091, 099–105) reference the legacy `threads` / `thread_members` / `polls.thread_id` schema names.** Migration 107 renamed them to `groups` / `group_members` / `polls.group_id`. The historical files are NOT rewritten — their SQL talks about the old names because that's what was on disk at the time. When reading those migrations to understand schema history, mentally substitute `groups` for `threads` etc. CLAUDE.md and `docs/*.md` use the current names throughout.

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
- **The group page's `QUESTION_VOTES_CHANGED_EVENT` patcher must include `prephase_deadline`.** The handler in `app/g/[groupShortId]/page.tsx` refetches the wrapper after a vote and merges fields into group state via `patchGroupPolls`. The `<GroupCardItem>` status row reads `wrapper?.prephase_deadline` to choose between the static "Taking Suggestions" / "Collecting Availability" labels and a live `<SimpleCountdown>`. If the patcher omits `prephase_deadline` (as it did originally — only `voter_names`, `anonymous_count`, `questions`), the freshly-fetched timestamp is silently dropped and the card stays stuck on the static label until a manual refresh. `QuestionBallot`'s own `setSuggestionDeadlineOverride` only updates the ballot's local UI, not the wrapper-driven group card. Same field also covers the deferred availability-timer for time questions. When adding any future "this field starts on first vote" semantics, audit every `patchGroupPolls(...)` callsite to ensure the field is propagated.
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
- **Don't use `env(safe-area-inset-bottom)` in layout-affecting properties that feed `scrollHeight`.** On iOS Safari browser mode the value is dynamic — `0` when the URL bar is visible (it occludes the home-indicator area), `~34px` when the URL bar hides. If a page's `padding-bottom` uses `calc(X + env(safe-area-inset-bottom))`, the document height animates in lockstep with the URL bar, making `max-scrollable` a moving target and producing a visible scrollY clamp during momentum near the bottom edge. Use a static value for content padding; reserve `env(safe-area-inset-bottom)` for the positioning of truly fixed elements (e.g., the floating "+" FAB) where it doesn't affect flow. The home-page padding is `6rem` flat (clearing the floating "+" FAB); group-like pages get `0.5rem` since the always-on draft poll form is the last thing in the list and has no floating chrome past it — anything more leaves visible dead space below the form when scrolled to bottom.
- **iOS Safari's bottom URL bar overlays the viewport at max scroll and clips the last row of the bubble bar.** When the user scrolls to the absolute bottom of a group page, Safari's URL bar (`~50-64px` tall, white in light mode) is fully extended and overlays the bottom of the visible viewport — without enough clearance, the bottommost row of the category bubble bar (rendered in-flow at the bottom of the draft poll card portal in `app/create-poll/page.tsx`) gets clipped. Symptom: a "white gap" between the bubbles and the screen edge that visibly sits *on top of* the bubbles' bottom edge. Firefox iOS doesn't show it (different chrome — URL bar at top, no overlapping bottom toolbar). The group page's outer `paddingBottom: '4.5rem'` (72px) alone isn't enough; the bubble bar wrapper takes a `pb-4` (16px) on top of that for ~88px total bubble-to-screen clearance. Putting the extra padding INSIDE the bubble bar (rather than bumping the outer `4.5rem` → `6rem`) keeps the dashed-border card from acquiring a visible empty zone below it on non-Safari browsers — the extra space reads as card-internal padding instead of dead space. `env(safe-area-inset-bottom)` is *not* the right tool here per the rule above (it's `0` exactly when the URL bar is visible, which is the case we're trying to handle).
- **Per-second `setState` in a countdown component causes Firefox iOS scroll jitter at scroll edges.** When ~15+ countdown spans each re-render every second via `setTimeLeft(...)`, Firefox iOS momentum scrolling near the top edge compensates scrollY by +200-230px in a single frame (a single-frame snap, not a smooth bounce). The React reconciliation pass triggered by the setState — even if the DOM diff is just a text-node swap — trips a layout event that FxiOS treats as reason to adjust `scrollY`. Fix: update countdown text imperatively via a ref (`span.textContent = ...` inside `setInterval`) so React never re-renders. Both `components/GroupList.tsx` and the inner `SimpleCountdown` in `app/group/[groupId]/page.tsx` use this pattern. Safari iOS doesn't exhibit the bug, but the ref-based approach is also more efficient.
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
- **Preferences-phase vote edits MUST re-send `voter_day_time_windows` + `voter_duration`.** `_edit_vote_on_question` writes both columns directly (not `COALESCE`d), because the same NULL-on-the-wire value carries two different meanings: in the availability phase it means "clear my availability" (abstain edit), but in the preferences phase the FE just leaves the field out of its UI. Symptom of forgetting: a voter who submits availability in phase 1, then submits preferences in phase 2, ends up with `voter_day_time_windows = NULL` because the phase-2 edit overwrote it — `compute_slot_availability` then returns 0 for every slot (winner is still picked from likes/dislikes, but the displayed "X of Y available" reads "0 of 0"). The fix lives in the FE: `voteDataBuilders.ts` preferences-phase branch reads `state.userVoteData?.voter_day_time_windows` / `voter_duration` and passes them through, so the SQL UPDATE writes the existing values back (effective no-op). Don't try to fix this with `COALESCE` server-side — that breaks the legitimate availability-phase abstain flow.
- **`TimeBallotSection` post-submit summary must skip the `hasVoted && !isEditingVote` branch when the voter has not reacted yet.** A voter who submitted availability in phase 1 transitions into phase 2 with `hasVoted=true` but `liked_slots/disliked_slots` still `null`. Without an explicit gate, the post-submit summary's ternary chain falls through to `null` — leaving `"Your preferences:"` sitting above the wrapper Submit with nothing in between. The gate is `const hasNotReactedYet = !inAvailabilityPhase && hasVoted && userVoteData?.liked_slots === null && userVoteData?.disliked_slots === null && !userVoteData?.is_abstain;` and `if (hasVoted && !isEditingVote && !hasNotReactedYet) { ...summary... }`. Falling through renders the active preferences form so the voter can mark slots. Mirrors the parent's `hasNotReactedYet` in `QuestionBallot.tsx:780` (which feeds `canImplicitlyEdit` for the wrapper Submit visibility).
- **Submitted availability is shown by re-rendering `TimeQuestionFields` with `disabled={true}`**, populated from `userVoteData.voter_day_time_windows` and `userVoteData.voter_duration` rather than the active form state (which may have been reset post-submit). Pattern used in the post-submit summary in `components/QuestionBallot/TimeBallotSection.tsx`. Duration callbacks are spread conditionally on `userVoteData.voter_duration` truthiness — when the voter didn't constrain duration, omit all four `onDurationXxx` handlers so `TimeQuestionFields`'s "render the duration block only when all callbacks are provided" gate hides it instead of showing `0–0` defaults.
- **Closed-state `TimeBallotSection` returns `null` unless the voter abstained.** The parent's closed-state block in `QuestionBallot.tsx:1244-1261` already renders `QuestionResultsDisplay` (the candidate slots) plus loading + "unable to load" fallbacks — so `TimeBallotSection`'s own closed branch only needs to add the "You Abstained" badge. An earlier version wrapped its (mostly empty) inner content in `py-6`, leaving ~48px of dead space below the candidate slots whenever the voter wasn't abstaining. When adding new closed-state content for a question type, audit whether the parent already handles it before adding a wrapping section.
- **Time results: heading is "Start Options" (no count) and the slot list is collapsed-by-default with fade + chevron.** `components/QuestionResults.tsx: TimeResults` wraps the day-rows divider div in `<CollapsibleStartOptions>`, which delegates to the shared `<CollapsibleFadeSection>` primitive (collapsed at 80px, 28px fade band). The legend (liked / disliked / unavail.) renders in the always-visible header next to the heading; only the rows themselves collapse. Same UX as the Notes field on a poll card.
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

- **`position: fixed; top: 0` goes behind the notch** in iOS PWA with `viewport-fit: cover` and `black-translucent` status bar. Either push content down via `padding-top: env(safe-area-inset-top)` on the fixed element (so its background fills the notch zone), or anchor the element at `top: env(safe-area-inset-top)` (so it sits below the notch). The group header uses the first pattern; the commit badge uses the second via `.pwa-badge-top`.
- **Body gets horizontal safe-area padding** (`padding-left/right: env(safe-area-inset-left/right)`); vertical safe-area insets are handled per-element by whatever sits at the top/bottom (fixed group header, home/settings titles via `.page-title-safe-top`, the floating "+" FAB via its flat `bottom: 1rem` offset — see "iOS PWA layout viewport vs physical screen" below for why we don't add `env(safe-area-inset-bottom)` here).
- **Use CSS media queries, not JS state, for PWA safe-area layout.** React state (`isStandalone`) starts `false` and only updates after `useEffect`, causing a visible jump on first render. `@media (display-mode: standalone)` applies instantly before any JS runs. Reserve `isStandalone` state for conditional rendering (e.g., back button visibility) where a one-frame flash is acceptable.
- **To position at the true screen edge**, render via a portal to `document.body` (outside the `.responsive-scaling-container`). From there, `fixed top: 0` = the safe area boundary (notch bottom) in PWA standalone mode.
- **Fixed header bars need to cover the notch zone, not just sit below it.** A header anchored at `top: env(safe-area-inset-top)` leaves the area above it (the notch zone) uncovered, showing scrolling content through it. Instead, anchor the bar at `top: 0` and push its content down with `padding-top: env(safe-area-inset-top, 0px)` so the background fills from the physical screen top. **The measurement ref (for computing a sibling's `padding-top`) must be on the OUTER fixed div, not the inner content div** — `offsetHeight` includes the element's own padding, so measuring the outer div picks up `env(safe-area-inset-top)` automatically (in iOS PWA where it's ~47-59px notch; in browser/desktop where env resolves to 0, the outer and inner heights match). An earlier iteration kept the ref on the inner content div with the rationale "stays content-only", but the consumer's `paddingTop: ${headerHeight}px + 0.5rem` then under-reserved by the safe-area amount and content sat behind the bottom of the header in iOS PWA. Most visible on the empty group placeholder (`/g/`) where a centered "Create a question…" caption was clipped by the header; on regular group cards the same bug just consumed the first ~47px of dead space and went unnoticed. Pattern used in `components/GroupHeader.tsx`.
- **iOS PWA layout viewport vs physical screen.** On iPhone X-class devices in PWA standalone mode (e.g., iOS 18.7 / Safari 26.4), `window.innerHeight` (= the layout viewport) can be smaller than `window.screen.height` (= the physical screen). One observed pairing: `innerH=812`, `screenH=874` — 62 logical points of physical screen sit BELOW the layout viewport. This is separate from `env(safe-area-inset-bottom)`, which reports the home-indicator zone WITHIN the layout viewport (typically 34px on iPhone X-class). Two consequences:
  - **Fixed-positioned DOM elements are clipped to the layout viewport boundary.** Anything at `top: ${innerH}px` or `bottom: -<n>px` simply doesn't render. Only `body`/`html` background paints into the strip below the layout viewport (verified by setting `--background: #ffff00` and observing the entire physical screen turn yellow). Therefore, the only knob on this strip is its bg color — you cannot put a button, text, or any DOM there.
  - **iOS PWA screenshots crop at the layout viewport bottom**, NOT the full physical screen. A `position: fixed; bottom: 0` element appears flush with the screenshot's bottom edge while sitting well above the device's actual screen edge. This burned multiple debugging cycles in the original session — markers that looked correct in screenshots were physically displaced on-device. When debugging iOS PWA layout from screenshots, mentally extend the screenshot's bottom edge by `screen.height - innerHeight` to get the true physical bottom. Or just trust the readout values, not the eye.
  - **The FAB sits at flat `bottom: 1rem` (NOT `max(1rem, env(safe-area-inset-bottom))`)** because adding the env value pushes it `1rem + ~34px` above the layout viewport bottom (which already sits well above the physical screen edge), producing a visibly far-from-edge button on iPhone PWA. Flat `1rem` keeps it 16px above the layout viewport bottom; the home-indicator gesture pill is centered horizontally at the bottom and doesn't reach the FAB's right-edge position, so iOS's reserved-zone overlap there is fine. The 62px physical strip below remains body-bg-painted "wasted" space that we currently leave matching the page background.

### Navigation Layout

- **No bottom bar. No home button.** The old three-button bottom bar (Home / + / Profile) was removed. Navigation is:
  - **Floating "+" FAB on home only**: a single circular blue "+" button pinned bottom-right via `position: fixed` + `max(1.5rem, env(safe-area-inset-right, 0px))` / `max(1rem, env(safe-area-inset-bottom, 0px))`. Tapping it navigates to `/p/` (the empty placeholder), where the draft poll card's category bubble bar lets the user pick a category to start a new poll. Home does NOT show the bubble bar — choosing a category is a per-group decision, not a "starting fresh" decision.
  - **Category bubble bar on group-like pages**: rendered IN-FLOW inside the always-on draft poll card on the group page, NOT as a floating bottom-fixed bar. One bubble per `BUILT_IN_TYPES` entry plus an "Other" custom bubble — see `BUBBLE_ENTRIES` in `app/create-poll/page.tsx`. Each bubble calls `openModalFor(category)` which seeds a fresh draft via `emptyDraft({category})` and opens the new-question modal. (Earlier iterations had a floating What/When/Where 3-bubble bar with `?mode=time` / `?category=restaurant` URL preselection; that's gone — see the historical note in the Active Plan section above.)
  - **Settings gear**: only on the home page, upper-left, icon-only (no text). Links to `/settings`. Rendered as `position: absolute` inside a `relative` wrapper around just the h1, with `top-1/2 -translate-y-1/2` so its vertical center auto-tracks the title's midline (no hardcoded offset — survives font-size/padding changes). Sits in normal page flow and **scrolls off-screen with the page** (intentionally not fixed). The outer container's `padding-top` (`calc(0.75rem + env(safe-area-inset-top, 0px))`) handles the iOS notch clearance.
  - **Back arrow**: the HeaderPortal back button only renders on the settings page when there's in-app history; all other pages (group, question) render their own back button in their fixed header.
- **Content wrappers on home + group-like pages reserve `calc(5.5rem + env(safe-area-inset-bottom, 0px))` of bottom padding** so the last card can scroll above the bubble bar. Other pages use the normal `pb-6`/`py-6` from the outer Tailwind classes.
- **FAB portal target**: `#floating-fab-portal` (previously `#bottom-bar-portal`) in `app/layout.tsx`. Lives outside `.responsive-scaling-container` so fixed positioning is relative to the viewport, not the scaled container.
- **The "+" FAB and What/When/Where bubble bar slide with the root snapshot during view transitions.** Earlier they shared `view-transition-name: floating-plus` on a `.floating-plus-button` class so the bar would stay "pinned" across home ↔ group navigation. The browser paired the small "+" element with the wider bubble-bar element as a single transition group — and even with `animation: none` on both pseudo-elements, the old "+" and the new bar coexisted in their original sizes/positions for the 500ms transition window, which read visually as the "+" growing and lingering at the bottom while the bubble bar expanded in. Removed the shared name + the `.floating-plus-button` class entirely; both portal-rendered controls now belong to the root snapshot, so the home "+" slides off-screen with the home page and the group bubble bar slides in with the group page (and vice versa on back). Don't re-introduce a shared `view-transition-name` between conceptually different controls just because they occupy the same screen position — the browser will pair them and the morph will look wrong unless you can make the two elements visually identical.
- **The outgoing root snapshot slides fully off-screen (`translateX(±100%)`), not a 25% parallax.** The first iteration used iOS-style parallax: outgoing 25% with opacity 0.5, incoming 100%. That stranded the bubble bar (which spans most of the bottom width) in the right portion of the viewport during back-nav — the new home page covered only the left half by the time the old page settled at +25%, leaving the rightmost button visible at half opacity under the incoming page. Symmetric 100%/100% slide ensures the bar fully exits the viewport before the new page lands. If you want the parallax look back later, you'd need to keep the outgoing page mostly off-screen (e.g. translateX(80%)) and accept a shorter trail — don't go below ~80% or the wide bubble bar will linger again.
- **Create-question modal close cleans up `category` along with `create`/`followUpTo`/`duplicate`/`voteFromSuggestion`/`mode`.** The Where bubble adds `?category=restaurant` to the URL; closing the modal must strip it so the URL display stays tidy. The cleanup list lives in `navigateCloseModalRef` in `app/template.tsx` — extend it whenever you add a new query param that the create modal consumes on entry.
- **`?category=<value>` preselection on the create-question modal** — `app/create-question/page.tsx` reads `categoryParam = searchParams.get('category')` once and feeds it as the initial `useState` value for `category` (defaults to `'custom'` when absent). The Where bubble uses this; future per-bubble flows (Phase 2.4 dual modal) can extend it. **The URL param wins over the saved-draft `questionFormState.category`** — the localStorage restore is gated on `formState.category && !categoryParam`, so a stale "restaurant" draft can't override a "What" tap that explicitly arrives with no `category` param. If you add another URL preselection mechanism that interacts with the saved-draft restore, mirror this guard.

### Back Button Navigation Strategy

- **On poll pages the back arrow always renders and leads to the containing group** — including on direct/first-link loads where there's no in-app history. Computed at click time by walking up `follow_up_to` in the `questionCache` via `findGroupRootRouteId`; a standalone question resolves to `/p/<itself>`, which renders as a single-item group. For the settings page the old "only when there's in-app history" rule still applies.
- **Detect standalone mode with `isStandalonePWA()`** which checks both `navigator.standalone` (iOS) and `window.matchMedia('(display-mode: standalone)')` (Android/Chrome). Both are device constants — evaluate once on mount, not on every navigation.
- **Don't use `document.referrer` or `window.history.length` for navigation decisions.** `document.referrer` is unreliable (privacy settings, cross-origin, browser variations). `history.length` is cumulative across the tab's lifetime, not app-specific. Use `sessionStorage` to track in-app navigation count instead (per-tab, auto-cleared on close).
- **After a create-question submission, the back button should lead to the group containing the new question**, not back through the `?create=1` URL (which reopens the modal) and not to whatever random page the user was on before opening the modal. Implemented via `lib/questionBackTarget.ts`: the create-question flow calls `questionBackTarget.set(questionRouteId, groupRootRouteId)` before `router.replace('/p/<id>')`; the back button in `app/template.tsx` calls `questionBackTarget.consume(questionRouteId)` and uses `navigateWithTransition(router, customBack, 'back', { mode: 'replace' })` to replace the question entry with the group entry — so subsequent `back` from the group skips over the question. Skip setting the target when the page underneath the modal already matches the group URL (avoids leaving a duplicate history entry).
- **`history.replaceState(null, '', url)` does not integrate with Next.js App Router back navigation.** When popstate fires with `state === null` (because we bypassed the router), Next.js's popstate handler can't resolve the target route and falls back in unpredictable ways — on the first attempt of this pattern, standalone questions were landing on the main list instead of the group URL we'd injected. Use `router.replace` (which writes proper Next.js route state) combined with sessionStorage overrides for custom back destinations; never rely on raw `replaceState` to feed Next.js router back navigation.
- **Consecutive `router.replace` + `router.push` calls in Next.js App Router don't reliably produce two history entries.** Both navigations are scheduled through React transitions and can batch, so only one may actually commit. If you need the prior entry to be a different URL, use the sessionStorage-override pattern (a single `router.replace` plus back-button override in the next page).

### Group-Page Layout Stability

- **Each card is a `React.memo`'d `<GroupCardItem>` (`app/g/[groupShortId]/GroupCardItem.tsx`) with slice-based custom equality.** A vote/expand/press/swipe on card A no longer re-renders cards B..N. The parent's `.map()` recomputes per-card primitives (`isExpanded`, `isPressed`, `isAwaiting`, `isClosed`, `isVisible`, `isSwipeThresholdActive`, `isTooltipActive`, `isPlaceholder`) from its useState values and passes them as props — for cards whose primitive didn't flip, the memo's first cheap-boolean comparison short-circuits to `true` and the card's ~600-line JSX render is skipped entirely.
- **State Maps (`questionResultsMap`, `userVoteMap`, `pendingPollChoices`, `wrapperSubmitState`, `pollVoterNames`, `pollSubmitting`, `pollSubmitError`) are passed by reference; the equality fn slices them by THIS card's question/sub-question/poll IDs.** Every Map mutation produces a new identity (e.g. `setQuestionResultsMap(prev => new Map(prev).set(id, fresh))`), so a default shallow-compare would invalidate every card on every Map update. The slice-based equality fn iterates `next.group.subQuestions` and compares only `prev.questionResultsMap.get(sp.id) !== next.questionResultsMap.get(sp.id)` (and similar for the other Maps); siblings of the changed entry compare equal and skip re-render.
- **Stable handler/setter identity is invariant across the component lifetime — the equality fn does NOT compare them.** This is a deliberate assumption: useState dispatchers are inherently stable, callbacks passed to `GroupCardItem` are wrapped in `useCallback([])` (`attachCardEl`, `detachCardEl`, `resetSwipeRef`) or pinned via `useRef(...).current` in `lib/useGroupVoting.ts` (`setPollVoterName`, `handleWrapperSubmitStateChange`, `submitSwipeAbstain`). If a parent stops pinning a callback, it'll show up as a stale-closure bug, not as missed re-renders — fix it in the parent. New handlers passed to GroupCardItem MUST be stable; before adding one, audit its closure for reactive state and pick the right pinning pattern.
- **Card-local handlers (touch/swipe/click) live inside `GroupCardItem`, not in the parent.** `handleTouchStart`, `handleTouchEnd`, `handleTouchMove`, `finalizeSwipe`, `toggleExpand`, `handleClick` close over per-card props (`question`, `group`, `swipeEligible`, `isExpanded`) plus stable refs/setters/callbacks passed in. Recreating them per render is cheap because they only ever execute when the user touches that specific card. The previous version recreated all N×6 handler closures on every parent render — moving them to the child means each card's handlers are recreated only when that card itself re-renders.
- **The placeholder branch stays in the parent's `.map()`.** Unmounted groups render as `<div style={{height: groupHeightById.current.get(group.key) ?? ESTIMATED_GROUP_HEIGHT}} />` directly inside the parent — they're trivial JSX with no per-card state that needs memoization. `attachCardEl`/`detachCardEl` are shared between the placeholder and `GroupCardItem` so both register in `cardRefs` (the scroll-helper logic that iterates `cardRefs` works regardless of mount state).
- **`SwipeState` and `GroupCardGroup` types live in `GroupCardItem.tsx`** and are imported by the parent. Same-file colocation keeps the prop interface and the consumer's primitive computation discoverable in one place; if a future refactor needs these elsewhere, lift them to a shared `groupCardCommon.ts`.
- **`pendingPollSubmit`, `pendingVoteChange`, `voteChangeSubmitting`, `confirmPollSubmit`, `confirmVoteChange` stay in the parent** — they only feed the page-level confirmation modals, never the per-card chrome. Don't push them into `GroupCardItem`'s prop interface.
- **Future bounded-memory scroll-window (deferred): the IO-driven mount/unmount window past ±2 viewport heights is now affordable** (a card's mount/unmount is ~free for siblings since memo skips them). Implementing this means changing the progressive-fill effect to instead drive `mountedGroupKeys` from the IntersectionObserver: add when crossing into a `±2 × innerHeight` envelope, remove when crossing out. The placeholder's measured height keeps scroll position stable across mount/unmount cycles. Hold off until groups actually hit hundreds of polls — premature scroll-driven virtualization can cause flicker if the placeholder height is mismeasured.
- **Initial mount = anchor only; rest fills in idle-time around the anchor.** Mounting all groups upfront pays a heavy initial-render cost on long groups (each card in the .map is ~200ms in dev mode). The current compromise: initial render contains only the URL-anchored card. A `useEffect` then walks a distance-from-anchor queue and mounts groups in batches of 4 per `requestIdleCallback` tick (falls back to `setTimeout(16)`), so the surrounding cards "fill in around" the anchor visibly. With memoized cards, each progressive-fill batch only re-renders the newly-mounted cards — not the entire list — so the fill is visually smooth even on long groups.
- **Placeholder divs are kept around for groups not yet mounted (the bulk during the initial fill, plus the brief window between a new poll arriving and the maintenance useEffect adding it to mountedGroupKeys).** Each placeholder renders as a `<div>` with `style={{ height: groupHeightById.get(key) ?? ESTIMATED_GROUP_HEIGHT }}` so the doc height is stable across the swap. A shared `ResizeObserver` populates `groupHeightById` from each rendered group's `borderBoxSize` (NOT `offsetHeight` — that forces a layout per entry, which on iOS URL-bar transitions stutters the scroll because every observed card fires at once).
- **Anchor pin (single source of truth) lives in `applyScrollAdjustmentRef.current`** (a ref-stored function so both `useLayoutEffect` and the `ResizeObserver` callback can call it without dep churn). Two modes:
  - **Card-anchor** (`initialExpandedQuestionId` set): re-apply `scrollTo(card.offsetTop - headerHeight)` every layout settling, until `userInteractedRef.current` flips.
  - **Bottom-pin** (`initialExpandedQuestionId === null`, suppressExpand): re-apply `scrollTo(scrollHeight - innerHeight)` until `userInteractedRef.current` flips.
- **Gate on user input, not scrollY deltas.** The first version tracked `prev.offsetTop` and scrolled by `newOffsetTop - prevOffsetTop` to preserve visual position. That broke when cards above mounted SMALLER than estimated → doc shrank → browser silently CLAMPED scrollY (e.g. 1796 → 1568) → my prev was stale → my delta calculation produced wrong scrolls. Hard to distinguish browser-clamp scroll events from user-initiated ones at the JS level. Switching to "pin until first pointerdown/wheel/keydown" sidesteps the entire problem: layout settling is unambiguous (no user input has happened), so we just re-pin every time.
- **`userInteractedRef` listens to `pointerdown` / `wheel` / `keydown` in capture phase.** NOT `scroll` — programmatic scrolls (our own `scrollTo`, browser clamps when doc shrinks) all fire `scroll` events with `isTrusted: true`, indistinguishable from a user gesture. `pointerdown` (in capture phase) is the unified touch+mouse+pen event and reliably fires on iOS even when scroll engages immediately.

### Scroll API Pitfalls

- **Non-scrollable headers in iOS PWA need `touch-action: none`** to prevent elastic rubber-banding. iOS WebKit allows bounce/elastic behavior from touch gestures even on content that has no scroll to offer. Adding `touch-none` (Tailwind) to fixed header bars prevents touches on them from initiating any scroll behavior. Taps (`onClick`) still work — `touch-action` only controls default browser behaviors.
- **Viewport-relative `position: fixed` works** only because `.responsive-scaling-container` has no `transform` on mobile. Any `transform` (even `scale(1)`) creates a containing block that traps fixed children. The scaling container applies `transform: scale(1.5/2)` on desktop only, via media queries.
- **Use `window.scrollTo` / `window.scrollY` for page scroll**, not per-element scroll refs. The document is the scroller — there are no inner page scroll containers. Auto-scroll patterns (e.g., group page's scroll-to-bottom on load): `window.scrollTo(0, document.documentElement.scrollHeight)`. Expand-scroll: read/write `window.scrollY`.
- **Group-page scroll behavior is documented in one place** — the "Group-page scroll strategy" comment block at the top of the scroll section in `app/g/[groupShortId]/page.tsx` (just above the initial-load `useLayoutEffect`). It covers all four coupled concerns: (1) initial-load scroll, (1b) anchor pin (re-applied from layout effect AND ResizeObserver until first user interaction), (2) tap-expand smooth-scroll, and (3) the up/down scroll-helper arrows. When changing any group-page scroll behavior, update that block — don't accumulate scattered notes here. The arrows are mutually exclusive (up takes precedence) and both target awaiting polls (open polls the viewer has neither voted on nor abstained from). Up shows when no awaiting poll is visible AT ALL and at least one is wholly above; down shows when no awaiting poll is FULLY visible, none is above (wholly or top-clipped), and at least one needs scrolling down (wholly below or bottom-clipped). Both arrows align the target card's top flush with the bottom of the fixed header. **Always rAF-coalesce the body-subtree MutationObserver** that drives visibility — every awaiting card's `getBoundingClientRect()` is read per evaluate, and a vote / expand / countdown burst would otherwise trigger N forced layouts. Pattern: `let rafId: number | null = null;` + `const schedule = () => { if (rafId !== null) return; rafId = requestAnimationFrame(evaluate); };` + clear `rafId` at the top of `evaluate`; cancel in cleanup.

### Portal Targets and Mount-Timing Races

- **Don't use a single `setTimeout` retry to find a DOM target that's mounted by a sibling component.** `CommitInfo` (in `layout.tsx`) needs the `#commit-badge-portal` element rendered by `template.tsx` behind its own `isMounted` flag. A 100ms retry worked on the home page but raced unpredictably on `/p/<id>/` and other routes where the template's mount effect commits later — leaving the commit-age badge missing for the rest of the session. Use a `MutationObserver` on `document.body` (with `childList: true, subtree: true`) and keep it running for the component's lifetime: React can replace the portal target across navigations, leaving a stale reference pointing at a detached node, so the observer re-queries on every DOM mutation and updates state only when the node identity changes.

### Dev Server Pitfalls

- **Dev server rate limiting is disabled** via `DISABLE_RATE_LIMIT=1` in `dev-server-manager.sh`. Dev servers are single-user, so production rate limits (120 GET/30 POST per minute) just cause friction during development.
- **`npm run dev` spawns a process chain** (`npm` -> `next` -> `node`). Killing the parent PID doesn't reliably kill child processes holding the TCP port. After PID-based kill, always `fuser -k <port>/tcp` to clean up orphaned children — otherwise the next start gets `EADDRINUSE`.
- **Dev server shows stale commit info** when the restart fails silently. The old process keeps serving pages. Always check `dev-server-manager.sh list` for `[STOPPED]` status after a push if the commit info doesn't update.
- **App-router directory renames poison Turbopack's filesystem cache.** Renaming/deleting an `app/<route>/` directory (e.g. `app/profile/` → `app/settings/`) leaves a pinned `AppPageLoaderTree` cell in `.next/cache` that no longer resolves. Turbopack panics `Failed to write app endpoint /<old-route>/page` on every request and broadcasts an HMR event that the client converts into a full reload — producing a ~1 Hz spontaneous-refresh loop on the dev site even though the source tree is correct. Fix: wipe `.next/` on the dev server and restart (`rm -rf /root/dev-servers/<slug>/.next && dev-server-manager.sh upsert <email> <branch>`). Note: `git pull` does not clear `.next/` — the normal push → webhook → upsert path won't fix a poisoned cache. If you see the loop pattern after a route rename, go straight to the `.next` wipe.
- **`dev-server-manager.sh upsert` must force-clean the working tree before checkout.** Earlier versions ran `git checkout "$branch" || git checkout -b "$branch" FETCH_HEAD || git checkout "$branch"` with `2>/dev/null` on the first two — when the dev tree had stranded local mods or untracked files (a stale `.tsx` edit, leftover `test-*.cjs` debug scripts, an untracked file shadowing one the new branch wanted to add), all three checkouts failed and only the third's `pathspec did not match` line surfaced in the webhook log. Net effect: every push silently failed to update the dev server until somebody manually cleaned the tree. Current sequence is `git fetch + git reset --hard HEAD + git clean -fd + git checkout -B "$branch" FETCH_HEAD + git reset --hard FETCH_HEAD`. **Never use `clean -x`** — that wipes `.next/`, `node_modules/`, `.api.pid`, `*.log` (all gitignored runtime/build state). To diagnose this class of failure, `tail -30 /var/log/dev-webhook.log` on the droplet for the post-fetch ERROR; if you see "pathspec did not match" or "would be overwritten by checkout", the working tree drifted.
- **Manually-triggered upsert may not stop the previous Next.js dev server.** When a previous dev server crashes or is killed without going through `dev-server-manager.sh stop`, its PID in `.dev-meta.json` goes stale; the next upsert assigns a fresh port (e.g. 3001 → 3004), starts a new Next.js, and Turbopack's per-directory lock detects the orphaned old process in the same dir and refuses to start: `⨯ Another next dev server is already running. PID: <old>`. The old process keeps serving on the OLD port; the new server doesn't bind. Fix: `kill <old PID>` (the log shows it explicitly) + `fuser -k <old port>/tcp` and re-run upsert. The lock check is per-directory, not per-port, so even with different ports they conflict. **Mitigated by `reap_orphans_for_slug` (next bullet)** which now runs unconditionally before port allocation.
- **Orphan reaper runs before port allocation in `cmd_upsert`.** `stop_api`/`stop_nextjs` only know which port to free if `.dev-meta.json` was written by the previous upsert — when an upsert crashes mid-flight and never writes meta, its API/FE processes survive as untracked orphans on the same ports. `find_available_port_in_range` then sees every port held and bails with "No available ports in range 8001-8005", and each retry leaves another orphan on top (the failure mode that wedged `sam-at-samcarey-com`'s dev server with 6 stacked orphans across 5 API ports + 1 FE port). `reap_orphans_for_slug` (in `scripts/dev-server-manager.sh`) walks `/proc/[0-9]*/cwd`, matches every process whose CWD is the slug's dev dir or anywhere underneath (catches both `/root/dev-servers/<slug>` and `/root/dev-servers/<slug>/server` etc.), and SIGKILLs them — port-independent, meta-independent. Called AFTER `stop_api` + `stop_nextjs` (which handle the meta-tracked happy path) and BEFORE `find_available_port_in_range`. Alternatives are worse: `pgrep -f` matches argv not CWD (can't distinguish this slug from a sibling dev server's), `lsof +D` walks the whole subtree (slow + not installed by default), `fuser -m` matches mountpoints (way too broad). The `/proc/*/cwd` walk is sub-10ms on the droplet's ~100-200 process count.
- **`/proc/*/cwd` walkers must skip `$$` and `$PPID`.** `cmd_upsert` `cd`s into `${dir}/server` and back to `${dir}` for git/uv work BEFORE calling `reap_orphans_for_slug`, so the upsert script's own `/proc/$$/cwd` symlink resolves into the slug dir. The reaper then matched its own PID (and its parent shell's, since the `cmd-api.py` HTTP handler invokes the script with the dir as cwd) and SIGKILLed itself — surfacing as `Killed` / `exit code: 137` mid-upsert that looked like an OOM. Symptom: the webhook log shows `Reaping orphan processes for <slug>: <single-pid>` followed by `Killed` and the upsert never completes, even with plenty of RAM. Always exclude `$$` and `$PPID` (use the bash builtin, not `awk '{print $4}' /proc/$$/stat`) when building a victim list from `/proc/*/cwd`.

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
  - **Suppress the warning in voter-facing contexts via `hideReferenceLocationWarning`.** `OptionsInput` is reused inside `SuggestionVotingInterface` for voter suggestion entry; if the creator never set a reference location, the "Choose a reference location above to enable search" message is un-actionable for voters (no field "above" — only the creator could have set it). The `SuggestionVotingInterface` callsite passes `hideReferenceLocationWarning` to suppress just the message; `searchDisabled` is still derived from `needsReferenceLocation` so Nominatim still gets blocked and voters can still type free-form options. The prop is presentation-only and orthogonal to `searchDisabled` — don't conflate them. If `OptionsInput` ever lands in a third context where the caller can't fix the missing reference location, pass `hideReferenceLocationWarning` rather than inventing an `isVotingContext`-style flag — visible-effect naming (`hideLoser`, `hideRespondents`) travels better than context naming and matches existing prop conventions in the codebase.
- **Document `mousedown` (outside-click) dismissal does NOT cover iOS keyboard accessory buttons.** `AutocompleteInput`'s dropdown was originally closed via a document-level `mousedown` listener + `Escape` keydown. iOS keyboard's Done checkmark and the form-navigation up/down arrows blur the input but don't fire any document-level pointer event or keydown that JS can observe — so the dropdown stayed open after focus moved away. Always pair outside-click dismissal with an `onBlur` close on the input itself. Tapping a dropdown item still works because each `<li>` uses `onMouseDown` with `e.preventDefault()` (prevents the input from blurring before `selectSuggestion` runs). Same gotcha applies to any other popup/menu/tooltip anchored to an input — outside-click alone is insufficient on iOS.

### Create-Poll: Form Fields & Helpers

- **`CreateQuestionContent` is exported** from `app/create-poll/page.tsx` and lazy-loaded via `React.lazy` in `template.tsx`. The `/create-poll` URL is a redirect stub that bounces to `/g/` (where the bubble bar lives).
- **`draftPollPreview(drafts, pollContext)` mirrors `server/algorithms/poll_title.generate_poll_title`** so the placeholder card's title matches what the server picks on submit. The duplication is intentional and called out in a header comment; both sides have to evolve together when adding a new category to `BUILT_IN_TYPES`. The auto-title rules (matched on both sides):
  - **1 question**: title equals the question's own auto-title (category + its `forField` as "for X" suffix). E.g. `[Restaurant + forField=Tonight]` → "Restaurant for Tonight". Yes_no questions whose title was user-typed (`!isAutoTitle`) keep the typed title.
  - **N questions sharing the SAME context** (poll-level `context` OR every question's `forField` matches case-insensitively): comma-join the categories + " for X". E.g. `[Restaurant, Movie, all forField=Tonight]` → "Restaurant, Movie for Tonight".
  - **N questions, distinct per-question contexts**: greedy "Cat for Ctx" pairs joined with commas, ending in ", etc." once the next pair would overflow. Falls back to "Questions" if not even one pair fits.
  - **N questions, no context anywhere**: comma-join the category labels (no "for X" suffix, no "and").
  - **Length cap**: `_TITLE_CHAR_LIMIT = 40` on the server, `TITLE_LIMIT = 40` on the FE (the same constant `buildOrList` already uses for question-level "or"-list titles). When the comma-joined "Cat1, Cat2 for X" form exceeds the cap, fall back to "Questions for X". Tune both constants in lockstep if mobile rendering changes.
  - **Per-question contexts source on the server**: `questions.details` (mapped via the `_contexts_for_title()` helper in `routers/polls.py`). Don't confuse with `polls.details` (the multi-line Notes field).
- **`sharedDraftContext(drafts)` exported from `createPollHelpers.ts`** returns the case-insensitive-shared `forField` across every staged draft, or null when one is missing or values diverge. Used by `openModalFor` in `app/create-poll/page.tsx` to pre-fill the new question form's `forField` when restoring multi-question staging — a 2nd "Restaurant for Tonight" added to a "Movie for Tonight" poll inherits "Tonight" without retyping. Don't double-apply: `emptyDraft({ forField: ... })` plumbs the value into a fresh draft only.
- **Poll-level Context vs Notes** are two separate fields. Context is a short single-line input that drives the auto-title's "for X" suffix (maps to `polls.context`); Notes is a multi-line textarea with link support (maps to `polls.details` — wrapper column added in migration 103, wired through `CreatePollRequest` / `PollResponse` / `_insert_poll` / `_row_to_poll`). Don't confuse with `questions.details` (per-question context, added by migration 068 to the OLD polls table that 097 renamed to `questions`) — the two `details` columns live on different tables and carry different meaning. **Notes never feed the autotitle.** The FE-only `Context` field doesn't exist yet, so submit always sends `context: null` and `draftPollPreview(drafts, '').title` mirrors that — passing the Notes textarea (`details` state) into `draftPollPreview` would make the preview show a "Cat for <notes-text>" title that the server would never produce, divorcing preview from reality. If a Context UI field is added later, it goes into the `pollContext` arg of `draftPollPreview`, not Notes. **Poll-level notes render in the expanded group card** via `<QuestionDetails details={wrapper.details} label="Notes: " />` at the top of the expand-clip wrapper in `app/g/[groupShortId]/GroupCardItem.tsx` — same component used for `question.details` (per-question context inside `QuestionBallot`, no `label` passed), so multi-line text + link rendering + truncation/expand chevron come for free. The optimistic placeholder (`synthesizePlaceholderPoll`) carries `details` through too so the user sees their typed Notes immediately on submit, before the API resolves.
- **Pitfall: wiring a column through API code without a migration causes silent prod-only drift.** Migration 068's `details` column lives on `questions` after the 097 rename — adding `polls.details` to `_insert_poll`, `_row_to_poll`, `CreatePollRequest`, and `PollResponse` without a fresh migration left every `POST /api/polls` 500ing on prod (`column "details" of relation "polls" does not exist`). Dev DBs created post-097 from scratch happen to ALSO be missing the column, but the failure manifested only on prod because dev wrappers were created against a checkout that pre-dated the wire-through. When adding a new column-shaped field to a wrapper / table, audit `\d <table>` on prod (or grep `database/migrations/*.sql` for an `ALTER TABLE <table> ADD COLUMN <field>` since the table was last renamed) before wiring it through. The fix here was migration 103.
- **No duplicate/follow-up confirmation card.** When the modal is opened with `?duplicate=<id>` or `?followUpTo=<id>`, the underlying form logic still wires the new question up correctly — but there's no visual "this is a follow-up to X" header card. If you need a "remove association" UX in the future, also re-introduce a way to reset the related state.
- **Category and Context are stacked standard form fields inside the top card, with a live auto-generated title preview rendered ABOVE the card (outside it).** The title preview uses bold `text-xl` text in `text-blue-600 dark:text-blue-400` with `fontFamily: "'M PLUS 1 Code', monospace"` (the project's title-style monospace blue font, also used by `components/AnimatedTitle.tsx` and `app/page.tsx`'s home title); empty-state placeholder `‹title›` keeps the slot visible before the user picks a category. Category field uses the shared `TypeFieldInput` dropdown (same `BUILT_IN_TYPES` + custom-text fallback). Context is a normal `<input>` with `FOR_FIELD_PLACEHOLDERS[category]` as the category-aware placeholder (Restaurant→"Dinner, Lunch, etc.", etc.), falling back to "Context" when no entry. The Context field is hidden when `category === 'yes_no'` (yes/no has no "for X" suffix; the title IS the prompt and renders via the existing `titleField` input below). An earlier iteration used a custom `CategoryForLine.tsx` component that put both fields on one auto-sizing line in the title's place — that's been deleted; the new layout is just two stacked label/input pairs that get the same job done without the binary-search font-fitting, mirror-sizer width tracking, or auto-completion-of-options-as-italic-placeholder machinery.
- **`ConfirmationModal` z-index must be above z-60** (the create-poll bottom sheet). Currently at `z-[70]`. Any new modal that needs to appear over the create flow must exceed z-60.

### Create-Poll Bottom Sheet — Current Architecture

The flow has gone through four iterations: docked-panel (top + bottom sheets), always-visible inline form inside the draft card, then a rounded-corner modal that staged drafts into a visible draft poll card, and now (current) a single bottom-sheet modal that submits the entire poll directly. There is no longer a separate "draft" stage in single-question mode — tapping the modal's check button submits the poll immediately.

- **Bubble bar at the bottom of the scroll** (in-flow, not floating fixed) lists every `BUILT_IN_TYPES` entry plus an `Other` tile. Centered + wrapping. Tapping any bubble calls `openModalFor(category)` which seeds a fresh `emptyDraft({ category })` and opens the bottom-sheet. The bubble bar always renders on group-like pages; constant lives at module scope as `BUBBLE_ENTRIES` (don't recreate per render). Order matches the `TypeFieldInput` dropdown so muscle memory carries over.
- **Bottom sheet, not draft card.** The modal is a slide-up sheet anchored to the bottom edge with rounded top corners (`rounded-t-3xl` + `animate-slide-up`). The previous architecture rendered an inline draft poll card in `#draft-poll-portal` showing staged questions + a separate Submit button; that card is GONE in single-question mode. The portal still exists (the constant `DRAFT_POLL_PORTAL_ID` is still mounted by group routes) and hosts only the bubble bar. Don't reintroduce a visible draft card without first restoring the multi-question staging flow.
- **Sheet height is fixed (`height: calc(100dvh - 3rem)`), not content-driven (`maxHeight`).** Using `maxHeight` made the panel size to its content, so a short form (e.g. yes_no with no options yet) only slid up partway — the slide-up animation ended at a visually arbitrary height that depended on how many fields were rendered. Fixed height pins the top edge to a consistent location regardless of form state; the inner `overflow-y-auto` already handles tall content, and short content just gets empty space below. Don't switch back to `maxHeight` to "tighten" the visual — the inconsistent top edge is more disorienting than the empty space.
- **Two stacked borderless cards inside the sheet** — top card holds the question form (category + options + per-question fields), bottom card holds poll-level settings (voting cutoff, prephase cutoff, notes, voter name). Each card is `rounded-3xl bg-white dark:bg-gray-800 px-4 py-4` with no border. The sheet itself uses `bg-gray-100 dark:bg-gray-900` so the inner cards read as raised panels on a slightly darker surface. The cards' `space-y-3` gap visually separates the two responsibilities.
- **The check button submits the entire poll immediately.** Tapping the right-aligned check in the sheet header calls `handleSubmitClick` directly — no intermediate "draft" stage. On success the sheet closes (`setIsModalOpen(false)`) and the optimistic placeholder card is already in place on the destination group. On validation/API failure the sheet stays open with form values intact. Backdrop click + Escape dismiss without submitting.
- **Form state reset is on the success path ONLY.** A previous version called `applyDraftToState(emptyDraft())` BEFORE the poll-level validation step in `handleSubmitClick`. If validation failed (or the API rejected), the user saw an error in a now-empty modal and lost everything. The reset must run after `apiCreatePoll` resolves successfully, never before. Same applies to the duplicate-redirect branch (see next bullet) — clear state inline before `router.replace`. **Pitfall**: with the visible draft card gone, there is no fallback UI for staged drafts — once the form is wiped without a successful submit, the user can't recover their typing. Never insert a "reset early to keep the JSX simpler" change here.
- **Duplicate-redirect rule: same-creator + 30s window only.** `apiFindDuplicateQuestion` exists to catch accidental double-submits, NOT to forbid duplicate titles in general. The redirect only fires when both: (a) the current browser holds a `creator_secret` for the existing question (i.e. it's the creator), and (b) the existing question was created less than `DUPLICATE_REDIRECT_WINDOW_MS = 30_000` ago. Otherwise the create-poll flow proceeds and a real duplicate is created. The earlier "any matching title in the group → redirect" rule blocked legitimate duplicates (e.g. a fresh `Movie?` suggestion round in the same group). The `getCreatorSecret(existing.id)` check in `app/create-poll/page.tsx` is the canonical way to ask "am I the creator?" — there's no persistent user identity across polls, so it's the only signal available.
- **The duplicate-redirect branch must tear down submit state BEFORE `router.replace`.** Without it, `isLoading` stays true, the modal stays open, and the spinning check button covers the destination group forever. Fix is: `isSubmittingRef.current = false; setIsLoading(false); setIsModalOpen(false); applyDraftToState(emptyDraft()); setError(null);` before the redirect call. Symptom of regression: tapping the same built-in suggestion-mode bubble (e.g. Movie) twice in the same group within the 30s window hangs the submit forever — the auto-title `Movie?` matches and the duplicate-redirect fires but never closes the modal.
- **Auto-open the modal when URL params (`?duplicate=`, `?voteFromSuggestion=`) prefill the form.** Without this the prefill is invisible because the modal opens via explicit user action only. One-line `setIsModalOpen(true)` after the prefill effects.
- **Per-category defaults live in `emptyDraft`, not `openModalFor`.** `emptyDraft({ category })` initializes:
  - `dayTimeWindows: [{ today, [] }]` when category is `'time'` (or legacy `mode: 'time'`)
  - `isAutoTitle: false` when category is `'yes_no'` (the title IS the prompt)
  - everything else default
  Don't add per-category branches to `openModalFor` — the helper is a single `applyDraftToState(emptyDraft({category}))` call. Other entry points (auto-stage on Submit, post-submit reset) call `emptyDraft()` with no opts and get the same defaults.
- **Time category uses `questionType: 'question'` (not `'time'`).** All bubbles, including Time, set `questionType='question'` so the standard Category + Context fields render. The `questionFormBody` branches on `category === 'time'` to render `TimeQuestionFields`. The legacy `questionType === 'time'` path remains for the duplicate flow but new code shouldn't reach for it.
- **Body-scroll-lock is the standard `position: fixed` + saved scrollY pattern** (matches `TimeGridModal` / `DaysSelector` / `RankableOptions`). `overflow: hidden` alone doesn't block iOS PTR. There's an outstanding cleanup opportunity to extract a shared `useBodyScrollLock(isOpen)` hook — deferred until the pattern duplicates one more time.
- **MutationObserver for the `#draft-poll-portal` target stays armed for the component's lifetime, not self-disconnecting.** The portal target is rendered inside `GroupContent`'s main return — but `GroupContent` has loading + error early-returns that don't render it. When the page transitions through one of those states (or after a route change to a fresh group), a self-disconnecting observer keeps a stale reference to a detached node and the bubble bar portals into invisibility. Always-armed + rAF coalescing keeps the cost negligible.
- **DOM markers are named constants, not magic strings.** `lib/groupDomMarkers.ts` exports `GROUP_LATEST_QUESTION_ID_ATTR`, `GROUP_ID_ATTR`, and `DRAFT_POLL_PORTAL_ID`. The group page (writer) and create-poll (reader) both import them. Hardcoded strings on either side would silently break the integration without the constant.
- **Implicit follow-up via `<body data-group-id>`.** The submit handler reads the body attribute directly to determine the group to attach the new poll to. Skipped when on `/g/` (empty placeholder) — by construction the user is starting a new group, and the body attribute can be stale (the group route's cleanup is a useEffect return that React/HMR/view-transitions can delay). `EmptyPlaceholder` also clears the attribute on mount as belt-and-braces. The on-empty-group regex `^\/t\/?$` is computed once at the top of `handleSubmitClick` — used both for the body-attribute gate and the post-success `router.replace` decision.
- **No DOM-mutation form-disable.** The submit handler used to imperatively walk `document.querySelector('form').querySelectorAll(...)` and set `.disabled = true`. Two failure modes: it only matched the FIRST form on the page (potentially the wrong one), and the captured form ref went stale across `router.replace` so `reEnableForm` operated on a detached tree — manifesting as "submit button unresponsive after first submit". Every input/select/button already takes `disabled={isLoading}` from React state; that's the single source of truth.
- **Empty-group submits stay on `/g/` until the API resolves.** Eagerly redirecting to `/g/<placeholderPoll.id>/` (the previous flow) loses, because `pending-...` ids don't resolve as UUIDs or short_ids — the destination renders "Group Not Found" and that view doesn't include `#draft-poll-portal`, so a subsequent API failure has no UI to surface the error. Stay on `/g/`; success branch redirects to the real short_id, failure branch leaves the user in place with the modal open + form intact.
- **Same-kind / distinct-context pre-validation.** Mirrors `server/routers/polls.py: _validate_request` client-side: groups drafts by `(question_type, category)` and rejects when group contexts collide (case-insensitive, empties collide). Surfaces inline in the modal's red error box. Currently dormant for single-question polls (one draft can't conflict with itself) but kept around for the multi-question staging flow that will return.
- **Inline-form contributions to poll-level predicates must gate on `isModalOpen`.** `pollHasPrephase` / `pollHasRankedChoice` are the union of "any staged draft matches" + "the in-progress inline form matches". After dismiss, `applyDraftToState(emptyDraft())` resets the inline form to defaults — `questionType='question'`, `category='custom'`, no options — which incidentally satisfy `isSuggestionMode` and `inlineFormIsRankedChoice`. Without an `isModalOpen` gate, those defaults wrongly light up the prephase predicates after every dismiss, surfacing "Suggestion/Availability Cutoff" + "allow voting before options are finalized" in Settings even when no question has a prephase. Don't try to fix this by tweaking `emptyDraft()`'s defaults (they're load-bearing for the open-modal first-paint UX) and don't reach for `inlineFormHasContent()` — that helper checks "has the user typed anything?" (used for auto-stage on Submit), which is a stricter gate than needed. The right gate is exactly "is the user editing right now?" which is `isModalOpen`. Same fix applies to any future poll-level predicate that mixes staged-draft state with inline-form state.
- **The Suggestion/Availability cutoff label is unified, not type-conditional.** Earlier the cutoff field flipped between "Suggestions Cutoff" (any non-time prephase) and "Availability Cutoff" (any time-question draft). The label is now fixed as "Suggestion/Availability Cutoff" because (a) a multi-question poll can have BOTH a suggestion-mode question and a time question sharing the same cutoff, and (b) the toggle's gate is `pollHasPrephase` regardless of which kind. Don't reintroduce a conditional label — the unified form is correct for every combination.
- **Modal close has two paths with different state semantics.** Header is upper-left **X button** + centered title + upper-right blue checkmark (submit). Backdrop-click and Escape route through `closeKeepState()` — close-without-reset, so the React form state + the `questionFormState` localStorage auto-save are both preserved (subject to `openModalFor` reseeding the form on the next bubble tap). The X button routes through `handleCloseClick`: when `inlineFormHasContent() || drafts.length > 0`, it opens a destructive-red `ConfirmationModal` whose confirm calls `discardAndClose` (resets form + clears drafts); when there's nothing to lose, it calls `closeKeepState` directly. The submit-success + duplicate-redirect callsites still inline the same reset operations as `discardAndClose` (not refactored to call it because they need to slot specific ordering with `router.replace` etc.).
- **Stacked-modal Escape double-fire pitfall.** When the inner `ConfirmationModal` is open, BOTH listeners are registered on `document` — `ConfirmationModal`'s own keydown handler AND the sheet's body-lock effect's keydown handler. A single Escape press fires both, dismissing both modals if the outer doesn't gate itself. Fix: the sheet's `handleEsc` reads `showDiscardConfirmRef.current` and bails when the inner modal is open. **Use a ref (not direct state in the effect's deps)** so toggling the confirm doesn't tear down + rebuild the body `position: fixed` lock on every open/close — the cleanup runs `window.scrollTo(0, scrollY)` and on iOS the brief unlock between cleanup and re-effect could let PTR engage. The pattern: `const showDiscardConfirmRef = useRef(showDiscardConfirm); useEffect(() => { ref.current = showDiscardConfirm; }, [showDiscardConfirm]);` then read `ref.current` inside the listener. Apply this any time you stack a modal over the create-poll sheet (or any other modal with its own document-level keydown).
- **`ConfirmationModal` renders message + a single confirm button only.** No title, no cancel button — `title` and `cancelText` props are accepted but unused (kept for callsite compatibility, both optional). Cancel is via backdrop click or Escape (the component installs its own document-level keydown listener for Escape → `onCancel`). When stacking it over another modal with a document keydown listener, gate the outer listener — see the stacked-modal Escape pitfall above.
- **Multi-question staging is currently dormant.** `drafts` state and the auto-stage path in `handleSubmitClick` are kept around so the multi-question flow can plug back in cleanly. Today they only ever hold a single auto-staged draft transiently mid-submit. The `editingDraftIndex` state was removed entirely (it was truly dead — nothing wrote it after the staged-draft list UI came out). When restoring multi-question staging, that's the state to add back along with a list UI somewhere — the previous draft poll card is gone.

### Submit Morph (Optimistic Placeholder + Fade-In)

Submitting a draft used to navigate to `/p/<newPollShortId>`. The user described the route change as a "page reload" feeling. The flow now stays on the current page; the placeholder mounts in its sorted slot and fades in via a CSS keyframe.

- **`POLL_PENDING_EVENT` + `POLL_HYDRATED_EVENT`** in `lib/eventChannels.ts` are the cross-component event channels. On Submit, `CreateQuestionContent` (a) synthesizes an optimistic placeholder `Poll` from the draft state via `synthesizePlaceholderPoll` (id prefixed `pending-`), (b) caches it, (c) dispatches `POLL_PENDING_EVENT` with `{ poll, fromBbox }`, (d) clears draft state, and (e) starts `apiCreatePoll` in parallel. On API success, `POLL_HYDRATED_EVENT` swaps the placeholder fields for the real Poll. (`fromBbox` is still captured + passed through the event for backwards compatibility but is no longer consumed; drop it next time the event interface gets touched.)
- **GroupContent's POLL_PENDING listener** rebuilds the group state to include the placeholder. The placeholder card mounts with `pendingPollFirstQuestionId === question.id` so the status row / voter circles / countdown are suppressed until hydration — only the title shows. The cardFrame's className picks up `card-pending-enter` (defined in `app/globals.css`) which fades it in from `translateY(8px)/opacity:0` to natural over 300ms.
- **Why CSS keyframe instead of FLIP.** Earlier the morph was a JS FLIP that animated the cardFrame's width/height from the draft card's captured bbox to its natural slot. The cardFrame is a CSS Grid item, and Grid items default to `min-height: auto`/`min-width: auto`, both of which resolve to **min-content** — that clamps the cardFrame to its intrinsic content size and prevents the height transition from interpolating below it. Even after pinning `min-height: 0` and switching to a double-rAF dance + ease-out, the morph was inconsistent: `getComputedStyle().height` reported the from-value for ~80% of the animation duration, with an abrupt snap to the final value near the end. The CSS keyframe is fully declarative, no min-height edge case, and reads as "the new card just appeared".
- **`rebuildGroupFromCacheOrPrev(prev, mutate?)` is the shared rebuild for POLL_PENDING / POLL_HYDRATED / POLL_FAILED.** Source-of-truth merge: `byId = prev.polls + cached + (mutate.add) - (mutate.remove)`. **Always merging `prev.polls`** is the resilience fallback for stale `accessiblePollsCache` — the cache has a 60s TTL, and the submit handler's `cacheAccessiblePolls([...getCached() ?? [], newPoll])` pattern wipes every other poll out of the cache when the cache happens to be stale (idle >60s). Without `prev.polls` in the merge, `buildGroupFromPollDown(rootPollId, ...)` can't find rootPollId and bails, leaving the group frozen. Earlier the success path was an in-place `prev.polls.map(p => p.id === placeholderId ? realPoll : p)`, with a fallback for "POLL_PENDING bailed"; the hand-rolled swap was fragile across browsers (Firefox iOS hit a listener-registration race that left the swap a no-op). Both POLL_HYDRATED and POLL_FAILED route through this rebuild now and return `prev` when the rebuilt poll-id sequence matches (so identity-based memos stay stable). The submit handler ALSO uses `updateAccessiblePollsIfFresh(merge)` (`lib/questionCache.ts`) instead of the raw `cacheAccessiblePolls(...getCached() ?? [])` pattern — the helper's null-guard prevents wiping the cache to just `[newPoll]` when the cache was stale.
- **`mutate.add` / `mutate.remove` are required so swap is explicit.** Without them, leaving the placeholder AND the real poll both in the rebuild source yields a group containing both as children of the same parent. POLL_PENDING passes `{ add: placeholder }`, POLL_HYDRATED passes `{ add: realPoll, remove: placeholderId }`, POLL_FAILED passes `{ remove: placeholderId }`.
- **`isPendingPollId(id)` (`lib/groupUtils.ts`) is the canonical check** for placeholder polls. Used by the group page's `maybeFetch` and POLL_FAILED-state guard, and by `GroupList`'s viewport prefetch — all to skip API calls on `pending-...` ids that 500 server-side (`psycopg.errors.InvalidTextRepresentation` because they're not valid UUIDs). Don't inline `id.startsWith('pending-')`.
- **POLL_PENDING / POLL_HYDRATED also setMountedGroupKeys directly.** GroupCardItem rendering is virtualized: groups not in `mountedGroupKeys` render as a fixed-height gray placeholder div, with progressive-fill walking outward from the URL anchor in idle-time batches of 4. When a brand-new poll lands, the validation effect (`mountedGroupKeys = prev ∩ validKeys + anchor`) doesn't add the new key — it was never in `prev` and isn't the URL anchor — so the new card renders as a gray div until progressive-fill reaches it. On a 50+ poll group anchored mid-group, that's ~17 batches (≈270ms) for a chronologically-last new poll. Fix: each handler does its own `setMountedGroupKeys((prev) => { if (no-change) return prev; const next = new Set(prev); next.add/delete; return next; })` alongside the setGroup, mounting the new card on the same render tick. The validation effect's intersection preserves these keys on subsequent runs since they end up in `validKeys` once the rebuild lands them in group state. Symptom of forgetting this: card animates in via POLL_PENDING (it happened to be in the queue from prior progressive-fill), then disappears into a gray div on POLL_HYDRATED.
- **POLL_HYDRATED async-refresh fallback for missing-ancestor case.** When the new poll's parent isn't in `prev.polls` (e.g. the parent was discovered AFTER group state was built — accessiblePollsCache was invalidated by discovery, so the cache fallback can't fill it in either), the in-place rebuild leaves the new poll out of the chain. After the optimistic setGroup, async `await getAccessiblePolls()` (which fetches based on localStorage's full accessibleIds, including newly-discovered ancestors) and re-runs the rebuild. **Skip the async refresh when the optimistic already added the realPoll** (`optimisticWillAdd = hasPlaceholder || isFollowUp || isOwnRoot`, computed from `groupRef.current` BEFORE setGroup because setState is async). On the happy path this saves a cache-fetch + redundant setState per submit. The async path remains the only fix for the missing-ancestor case where the optimistic bails to prev.
- **Submit handler always caches the real poll (or evicts the placeholder on failure) before dispatching, so the cache is the source of truth.** POLL_FAILED additionally early-returns when no `pending-...` poll is in group state — the failure typically fires while the user is on a different group.
- **Home page listens to POLL_HYDRATED only.** Newly-created polls auto-appear in the home list without refresh. POLL_FAILED is intentionally not listened to (placeholder polls never reach the home cache, so failure can't change the home list). The handler diffs poll-id sequences before calling `setPolls` — `getAccessiblePolls()` returns a new array on every call, so a content-equality check prevents re-rendering every `GroupList` row when nothing changed.
- **Per-question titles match the combined poll title.** The server gives every question of a multi-question poll the SAME title (e.g., "Movie and Video Game"), so `synthesizePlaceholderPoll` does the same — every placeholder question's title = the combined `draftPollPreview(drafts, '').title`. Earlier the placeholder used `deriveDraftTitle(d)` per-question, producing single-question titles like "Movie?" that morphed into "Movie and Video Game" on hydration. Server `_CATEGORY_LABELS` (`server/algorithms/poll_title.py`) now uses "Place" for `location` (matches the FE dropdown label in `TypeFieldInput.tsx`); the previous "Location" label caused a flicker on hydration.
- **Server `_CATEGORY_LABELS` keys must match `BUILT_IN_TYPES` `value` exactly.** The FE's `components/TypeFieldInput.tsx: BUILT_IN_TYPES` defines the wire-format value for each category (e.g. `value: "video_game"` with underscore). The server map keys must include that exact form, or the lookup misses and the fallback `_label_for(category)` runs — which only gets it right by accident. Symptom: a poll auto-title rendered as "Video_game" instead of "Video Game". Defense in depth: `_label_for`'s fallback now does `.replace("_", " ").split()` so any underscored future category title-cases correctly without a dedicated map entry, and the FE's `app/create-poll/createPollHelpers.ts: _CATEGORY_LABELS` carries BOTH spellings (`video_game` AND `videogame`) for the same reason. When adding a new built-in: add the entry to `BUILT_IN_TYPES`, mirror it in BOTH `_CATEGORY_LABELS` maps, and add a `test_<category>_label` regression test in `server/tests/test_poll_title.py` that asserts the wire-format value resolves.
- **View Transitions API was tried first but didn't fit.** The browser's `::view-transition-old(name)` / `::view-transition-new(name)` are bitmap snapshots — even with `width: 100%; height: 100%; object-fit: fill` they stretch as the group resizes (so the title squashes/elongates with it). For in-place content morphs, neither view transitions nor JS FLIP work cleanly; the simple fade-in is what shipped.
- **Hot-path event listener pattern: state-via-ref + empty deps.** GroupContent's POLL_PENDING listener used to depend on `[group]`, which tore the listener down + re-added on every vote / hydration / cache refresh. Now `groupRef.current = group` is updated in a separate effect and the listener reads from the ref with empty deps. Same pattern as the existing POLL_HYDRATED listener. Apply this any time a long-lived window listener needs to read state that changes frequently.

### Within-Group Poll Sort

- **Within-group sort is pure chronological ascending (`created_at` oldest first, newest at the bottom).** `lib/groupUtils.ts: collectDescendants` no longer groups closed/expired polls separately — the comparator is just `new Date(a.created_at) - new Date(b.created_at)`. Result: the most recently submitted poll (open or closed) always lands at the very bottom of the group, just above the bubble bar. `latestActivityMs` is still computed as the true `max(created_at)` across all polls so the home page's cross-group "by recency" sort doesn't get coupled to the in-group order.

### Adding New Question Categories

- **Built-in categories** are defined in `TypeFieldInput.tsx: BUILT_IN_TYPES`. Add new entries there.
- **`isLocationLikeCategory()`** in `TypeFieldInput.tsx` controls which categories show reference location input and use proximity search. Update it when adding location-aware categories.
- **`isAutocompleteCategory()`** in `TypeFieldInput.tsx` controls which categories use the autocomplete dropdown (derived from `BUILT_IN_TYPES`).
- **Search dispatch** is in `AutocompleteInput.tsx: doSearch()` — add a new branch for each category's API endpoint.
- **Metadata rendering** is in `OptionLabel.tsx` — add detection function (like `isRestaurantEntry()`) and inline/stacked layout branches.
- **Place detail modal**: Tapping a restaurant/location name opens `PlaceDetailModal` (map embed + metadata). Tapping the address opens an iOS-style action sheet (`AddressActionsModal`) with "Open in Maps" (Apple Maps), "Open in Google Maps", and "Copy Address". Don't use `geo:` URIs on iOS — they're unreliable (may open Google Earth or other random apps). Don't include the business name in maps queries — it triggers a search for multiple branches instead of navigating to the specific address.
- **`line-clamp-2` breaks flex layouts**: Don't apply `line-clamp-*` to containers with flex children (like `OptionLabel`). The CSS treats flex items as flowing text and truncates unexpectedly. Use `overflow-hidden` instead and let inner components handle their own truncation.
- **Voting Cutoff field is a shared component**: `components/VotingCutoffField.tsx` renders the inline colored-value dropdown + conditional custom date/time inputs used by every question category in `app/create-question/page.tsx`. Reuse it when adding new categories — don't copy-paste the JSX. The custom date/time inputs inside use ids `customDate` and `customTime`; the component assumes only one instance is rendered at a time (enforced by the mutually exclusive `category === 'time'` vs `category !== 'time'` branches).
- **Three places to mirror new built-in labels**: `components/TypeFieldInput.tsx: BUILT_IN_TYPES`, `app/create-poll/createPollHelpers.ts: _CATEGORY_LABELS` (used by `labelForCategory`, the canonical FE label resolver), and `server/algorithms/poll_title.py: _CATEGORY_LABELS`. The two label maps must stay in lockstep — the server drives auto-generated wrapper titles; the FE drives draft preview + per-question section headers. **`BUILT_IN_TYPES.label` and `_CATEGORY_LABELS` are NOT 1:1**: e.g. yes_no's BUILT_IN label is `"Yes / No"` (with spaces) for the dropdown UI, while the auto-title label is `"Yes/No"` (no spaces) on both server and FE. When you need the auto-title-aligned label string, route through `labelForCategory` — don't read `BUILT_IN_TYPES.label` directly. `getQuestionSectionTitle` in `lib/questionListUtils.ts` follows this convention (special-cases `time` → `"Time"` and `yes_no` → `"Yes/No"` to match the server, falls through to `getBuiltInType(category)?.label` for everything else).
- **Time questions need a `question_type === 'time'` short-circuit before reading `category`**, mirroring `_category_for_title` in `server/routers/polls.py`. The Time bubble in `app/create-poll/page.tsx` sets `question_type=time` but leaves `category="custom"` (the form's default). Reading the category alone gives "Custom" everywhere this matters — auto-title generation, section headers, label lookups, AND category-icon lookups (e.g. compact preview pills): `getBuiltInCategoryIcon(sp.category)` returns `undefined` for time questions because "custom" isn't a built-in, so the pill rendered iconless. The `CompactTimePreview` callsite in `app/g/[groupShortId]/GroupCardItem.tsx` hard-codes `getBuiltInCategoryIcon("time")` since it's already inside a `question_type === "time"` branch — same fix idiom. Both `getQuestionSectionTitle` (FE) and `_category_for_title` (server) implement the short-circuit; if you write a third helper that maps a question to its display label, icon, or any other category-driven attribute, it must too.

### Rich Selection Styling (Autocomplete Options)

- **Options selected from autocomplete are styled as "chips"**: underlined text (Tailwind `underline decoration-blue-500/50 underline-offset-2`) and a favicon/image on the left edge (`pl-8` + absolutely positioned `<img>`). Plain-typed options have no special styling.
- **Chip-like clear behavior**: on focus, all text is selected (`input.select()`), so backspace or any keystroke replaces the entire value. After `selectSuggestion`, `requestAnimationFrame(() => input.select())` auto-selects; on re-focus when `isRichSelection`, text is selected again.
- **Metadata lifecycle**: `isRichSelection` is derived from `!!optionsMetadata?.[option]`. When the user edits a rich selection (any keystroke), `onRichValueCleared` fires and the parent calls `clearMetadataForOption()` to remove the metadata entry. The underline/icon disappear and the field reverts to plain text. Deleting an option via the trash button also cleans up its metadata.
- **`clearMetadataForOption()`** in `OptionsInput.tsx` is the single helper for metadata cleanup — used by both `removeOption` and `onRichValueCleared`. Don't duplicate this pattern.

### Trim-on-Blur Policy (App-Wide)

- **All text inputs trim leading/trailing whitespace on blur.** This is applied globally across the app: create-question form fields (title, options, category, context, details), settings page (name, location), `CompactNameField`, `AutocompleteInput`, `LocationTimeFieldConfig`, and `ReferenceLocationInput`. When adding new text inputs, add `onBlur` trim handling.

### Always-Visible Name Field

- **`CompactNameField` is always visible.** Earlier iterations had a two-state collapsed/expanded pattern ("Your Name: [Add]" → input → null when name was set), with an internal `isEditing` flag to keep the component mounted across keystrokes. The collapsed "Add" button + the hide-when-set null-return + the wrapping `empty:hidden` divs at the 7 call sites are all gone. The component now renders the input unconditionally; the "(optional)" label hint and the input's `placeholder` text were also dropped — the field affordance plus its label is enough. When adding similar pre-vote name/identity fields in new flows, follow the same pattern: always-visible input, trim-on-blur, no collapse/expand state machine.
- **General rule on call-site conditional rendering of stateful components**: still applies. Any `{somePredicate && <Component/>}` wrapper whose predicate depends on state the component itself mutates will unmount the component on the first internal mutation, killing focus mid-keystroke. That's why we collapsed the "Add"-button state machine entirely rather than re-introducing a `{!name.trim() && <CompactNameField/>}` wrap at every call site. If you ever need conditional rendering of a stateful input, put the gate INSIDE the component (with the internal state included in the gate's input), never at the call site.

### Create-Question Form UI Patterns

- **Settings rows in the new-poll cards are `flex items-center justify-between gap-3 h-12`** (the `cursor-pointer` variant adds it for `<label>` rows that wrap a select/checkbox). All single-line fields in the create-poll bottom-sheet use this exact row shape: Category / Context / Title (top card) and Voting Cutoff / Suggestion-or-Availability Cutoff / Min Responses / Share Results / Allow-pre-ranking / Your Name (bottom card). Cards themselves have NO vertical padding (`px-4` only) so card height = `48px × N rows + (N-1) hairline borders`. The conditional widgets (custom date/time pickers, time-question fields, warnings) still expand below their `h-12` label row when active — those are NOT field rows, just collapsible extras. When adding a new settings field, copy the exact class string from any existing row; don't introduce `min-h-` or `py-*` variations on it. (Considered extracting a `<SettingsRow>` component for the ~9 occurrences but the row shape is genuinely a 1-liner — abstraction would obscure rather than clarify.)
- **Amber "needs attention" highlight for required form buttons**: The Tailwind class stack `bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-400 dark:border-amber-500 hover:bg-amber-200 dark:hover:bg-amber-900/60` is the codebase's idiom for drawing the user's eye to a button they need to tap to resolve a validation error. Used on the `+ Time` button in `DayTimeWindowsInput.tsx` when a day has zero time windows, and on the Select Days / Add/Remove Days button in `ParticipationConditions.tsx` when `dayTimeWindows` is empty. Match this style for any new "button that needs attention" states so the UI stays consistent.
- **Derive validation highlights from source state, not error strings**: When a form element needs to highlight in response to a specific validation failure, derive the highlight boolean from the underlying state (e.g. `dayTimeWindows.length === 0`) rather than comparing `validationError === "some exact string"`. String comparison silently breaks on typos or rewording. The pattern in `ParticipationConditions.tsx: highlightDaysButton` passes a simple state-derived boolean from the parent.
- **Compact tappable-value → modal pattern**: For form fields that don't need to be adjusted often (like Minimum Participation), use a single-line `<div>` with a `<button>` showing the current value in blue (`text-blue-600 dark:text-blue-400`). Tapping opens a modal with the full control (slider, picker, etc.). Don't wrap the whole thing in a `<label>` — there's no form control to associate with. Example: `MinimumParticipationModal.tsx` + the compact field in `app/create-question/page.tsx` (time question block).
- **Time-question split across cards.** The create-poll modal now renders three time-question-specific cards above Notes: (1) the question form's top card carries Category + Context + Duration (Duration stays inside `TimeQuestionFields` via `renderDaysSection={false}`); (2) the **Time Windows** card sits directly under the top card with an external "Time Windows" label and a right-justified "Select Days" pill on the same line, then a `divide-y` body of `borderless` `DayTimeWindowsInput` rows; (3) the **Minimum Availability** card sits between the bottom poll-settings card and Notes. All three are gated on `showTimeFields`. The pill is always-on `rounded-full border` with the border color swapping between amber (no days) and gray (≥1 day) so the pill height stays stable across states; gate any future amber→neutral pill on `border` being part of the *always-applied* class chunk rather than conditional, otherwise the pill jumps 2px tall on toggle. The "Select Days" pill uses `items-center` + `py-0.5` so its visible glyph aligns with the label baseline; `items-end` left the pill riding above the label (button top above label top because the button is taller).
- **`lib/useDayTimeWindowsState.ts` is the shared hook** behind both the embedded days section in `TimeQuestionFields` and the lifted Time Windows card in `app/create-poll/page.tsx`. Owns the `removed-day window cache` ref (re-adding a day after removing it restores its previous windows) and exposes `onDaysSelected` / `onWindowsChange` / `onDeleteDay` + a `reset()` for clearing the cache. **Always call `reset()` when transitioning to a fresh draft.** The page-level usage wires it into `discardAndClose`; without that, the ref — attached to the long-lived `CreateQuestionContent` instead of the per-modal-session `TimeQuestionFields` — would silently re-populate windows from a discarded draft if the user picked the same day in a fresh poll. The hook tolerates `onChange = undefined` (no-ops every handler) so consumers can call it unconditionally at the top of the component even when their `onDayTimeWindowsChange` prop is optional. Mirror this lifecycle pattern any time you lift a ref out of a per-modal component to a longer-lived parent: expose a reset and wire it into the explicit-discard path.
- **`DayTimeWindowsInput`'s `borderless` prop** drops the standalone `bg-gray-50 dark:bg-gray-800 rounded-lg border` chrome + `p-1.5` padding so the row composes cleanly inside a parent card's `divide-y` layout. Pair `borderless` with `min-h-12 py-2` on the wrapper so single-pill rows match the form's `h-12` baseline and multi-pill rows still grow. The non-borderless flavor is preserved for the voter ballot's `TimeBallotSection`, which still renders the embedded days section via `TimeQuestionFields`.
- **Pill-on-info-line → modal pattern**: `components/SearchRadiusBubble.tsx` is the shared "blue pill shows current value, tap to edit in a small modal" control. Used on the question-creation form (`ReferenceLocationInput`) AND on the voting page's "Near X" info line (`QuestionBallot`) — owning `searchRadius` state in `QuestionBallot` and forwarding it as a prop to `SuggestionVotingInterface` keeps the two surfaces in sync with a single source of truth. When adding another numeric-value-with-unit pill control, reuse this component or mirror its structure (pill uses `bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full` class stack).
- **Radius bubble on the "Near X" voting-form line is gated on `canSubmitSuggestions && isLocationLikeCategory(category)`** — it's only meaningful during suggestion collection for location questions. `reference_location_label` is always co-set with `reference_latitude`/`reference_longitude`, so checking the label is sufficient — don't re-guard on latitude.

### Social Test Report Bidirectional Linking

- **Question-to-report back-links require `SOCIAL_TEST_REPORT_URL` in the test subprocess environment.** `generate_report.py` derives it from `--site-url` (or `SOCIAL_TEST_API_URL` env var) + `/{REPORT_FILENAME}.html` and passes it to pytest. Without it, `conftest.py`'s `REPORT_URL` is empty and no back-link is injected into question `details` fields.
- **Report-to-question forward links work independently** — they read `question_id` from test results JSON after the run. Only the reverse direction (question → report) requires the URL to be known at test time.
- **The report filename is defined once** in `REPORT_FILENAME` constant in `generate_report.py`. Update it there if the filename changes.
- **After deploying a report to a dev server, always verify it loads** by curling the URL and checking for a non-empty 200 response. Pipe-based base64 transfers can silently produce empty files. Then share the verified URL with the user.

### Yes/No Result Edge Cases

- **All-abstain questions return `winner=None`, not `"tie"`.** In `server/algorithms/yes_no.py`, when `yes_count == 0 and no_count == 0` (but `total_votes > 0` due to abstains), the winner is `None`. A tie means competing sides got equal votes; all-abstain means no decision was made. The `total_votes == 0` early return handles the no-votes-at-all case separately.
- **Yes/No tap on a single-question poll skips the confirmation modal for first-time votes.** The dispatcher `dispatchYesNoTap(questionId, newChoice)` in `app/g/[groupShortId]/GroupCardItem.tsx` checks `!isMultiGroup && !userVoteMap.get(questionId)` and routes to `submitYesNoChoice(questionId, newChoice)` (exported from `lib/useGroupVoting.ts`) directly, bypassing `setPendingVoteChange` + the modal. Vote-edits (existing entry in `userVoteMap`) and multi-question polls still go through the modal. `submitYesNoChoice` was extracted from `confirmVoteChange` so both the modal-driven and direct-submit paths share one implementation; `confirmVoteChange` is now a thin wrapper that pulls from `pendingVoteChange` state and delegates. **The confirmation modal's copy branches on `!!current`** — `"Submit your vote: Yes?"` for first-time submits (defensive — the dispatcher should bypass the modal in this case, but it can still fire for multi-group cards where the modal is intentional) and `"Change your vote from No to Yes?"` for edits. Forgetting the branch produces a stray empty string: `"Change your vote from  to Yes?"`.

### Compact Preview Strips (Group Card Footer Row)

- **Every question type has a compact "top result" strip in the in-card footer row's right slot, mounted regardless of `isExpanded` so the pill never remounts on toggle.** Yes/no splits the render: when collapsed, the status row's pill slot hosts `<QuestionResultsDisplay hideLoser={true}>`; when expanded, a separate `<QuestionResultsDisplay hideLoser={false}>` renders below the status row for the full cards. (Single-render-with-internal-switch doesn't work here because the two presentations live in different DOM positions — the compact pill is a sibling of the status label, the full cards are a sibling row.) Ranked choice / suggestion / time use smaller type-specific components (`CompactRankedChoicePreview`, `CompactSuggestionPreview`, `CompactTimePreview`) in `components/QuestionResults.tsx`. Each is wrapped in an **inverse grid-rows clip** (`grid-rows-[1fr]` when collapsed, `grid-rows-[0fr]` when expanded — opposite of the heavy-content expand clip below). The two clips animate in lockstep over 300ms: pill smoothly shrinks to 0 height while the rounds visualizer / time-slot bubble grid grows in to fill the same vertical space. No flicker (pill stays in DOM, no remount), no redundant duplication of winner info when expanded, and the header reclaims the pill row for the heavy content. Prior iteration #1 gated the pills on `!isExpanded` (caused unmount-flicker — instant 32px gap collapse during the 300ms grid-rows growth, leaving the corner empty). Prior iteration #2 left them rendered always (DOM-stable but visually duplicated the winner once in the pill and once in the rounds visualizer). Inverse-clip handoff is the synthesis. To add a preview for a new question type: (a) add the component, (b) add a `question.question_type === '...'` block in the footer-row IIFE in `app/group/[groupId]/page.tsx` wrapping the pill in the same `CompactPreviewClip`, (c) extend the `wantsResults` allowlist in `maybeFetch` so results get fetched when the card enters the viewport.
- **Shared pill primitives** in `QuestionResults.tsx`: `PILL_CLASS` (includes `min-w-0` so it can shrink below content width when the status label on the left claims most of the flex row), `PILL_COLORS_OPEN` (blue), `PILL_COLORS_CLOSED` (green). Reuse these rather than copying class stacks — the review agents flag divergence fast. Empty-state copy ("No voters", "No suggestions yet") is NOT rendered in the card's pill slot anymore — it lives below the card in the respondents row (see the "Respondent Row" section below). Every compact preview component (`YesNoResults` hideLoser path, `CompactRankedChoicePreview`, `CompactSuggestionPreview`, `CompactTimePreview`) returns `null` when empty and the wrapper at the callsite is also skipped so no gap lingers.
- **Closed questions show "Closed Xm ago" (faint) in the in-card footer row's status slot** — the compact pills (Yes/No, CompactRankedChoicePreview, CompactSuggestionPreview, CompactTimePreview) are the single source of truth for the winner, so the status slot is repurposed for timing info only. Uses `compactDurationSince(closedAt)` from `lib/questionListUtils.ts`, which promotes to the next larger unit only when that unit's count would be ≥ 2 (13d stays `13d`; 14d becomes `2w`). The `closedAt` source is `response_deadline` when `close_reason === 'deadline'` (more accurate than `updated_at`, which would drift on subsequent edits), else `updated_at` (reliable for manual / max_capacity / uncontested closes — the DB trigger refreshes it on every `is_closed` flip). Don't call `getResultBadge` here — it's no longer imported into the group page.
- **Time questions in the availability phase render "Collecting Availability" in the footer row's status slot**, not in the pill slot — same format and styling as "Taking Suggestions". Use `isInTimeAvailabilityPhase(question)` (in `lib/questionListUtils.ts`) as the single check; the `CompactTimePreview` pill returns null during that phase so nothing is duplicated.
- **`QUESTION_TYPE_SYMBOLS` needs an entry for every new question type** (in `lib/questionListUtils.ts`). Without it, questions with that type and no matching category fall through to `'☰'` — a giveaway that the icon's wrong. Currently: `yes_no: '👍'`, `ranked_choice: '🗳️'`, `time: '📅'`.
- **Ties aren't possible in the ranked_choice winner field.** After Borda count tiebreak fails, the algorithm falls back to alphabetical. So `results.winner === 'tie'` only happens in yes_no; compact previews for ranked_choice can treat a missing winner as "no voters yet" rather than ambiguously tied.
- **Plain-text fallbacks get `mr-[0.4rem]` extra right margin** on top of the card's `px-2` (≈80% more distance from the card border) so they don't visually crowd the edge. Pill content keeps its own internal padding and sits at the default right edge of the card.
- **Category icon vertical centering**: `mt-[4px]` on the icon wrapper (previously `mt-[7px]`). Pure line-box centering (9px) reads low because the line-box includes descender space; biasing toward cap-height centering (5px) reads better for emoji glyphs across the category set. If the emoji set or title size changes, re-tune with Playwright `getBoundingClientRect` on both `<h3>` and the icon wrapper.

### Group Card Respondent Row (Below-Card Bubbles)

- **The row under each group card is ALWAYS rendered with the same height**, whether it shows respondent bubbles, loading skeletons, or an "empty" message. The old design let the row collapse to 0px when there were no respondents, which (a) caused visible jitter from skeleton → empty, and (b) pushed every card below up. `VoterList` in `singleLine` mode accepts an `emptyText` prop; when the voters array is empty (or all voters are excluded-current-user), it renders `<EmptyPlaceholder text={emptyText}>` at bubble height (text-xs 16px + py-0.5 4px = 20px) instead of returning null. Skeleton pills also have explicit `height: 20px` to match — all three states (skeleton / empty / populated) occupy the same vertical space.
- **`VoterList` accepts `includeSelf` to keep the current user in the bubble row.** Default is `false` — the singleLine row excludes the viewer because their state is signaled by the card's golden border. The group-card respondent row passes `includeSelf={isInSuggestionPhase(...)}` for ranked-choice suggestion phase: a single-suggester poll would otherwise render `"No suggestions yet"` even though the viewer just submitted a suggestion (excluded-self collapses the row to empty). Only set `includeSelf={true}` when the card-border signal is absent (post-vote) AND the user wants their own bubble visible. Static-mode (poll-level wrapper data) and live-mode (per-question fetch) both honor the flag.
- **Empty-state copy lives here, not in the card.** The group page passes `emptyText={isInSuggestionPhase(question) ? 'No suggestions yet' : 'No voters'}` to VoterList. Every compact preview in `QuestionResults.tsx` returns `null` when it would otherwise render an empty note — the respondents row is the single source of truth for empty copy. When adding a new compact preview: return `null` on empty, and let the callsite in the group page skip the wrapper (so no `mt-2` 8px gap lingers).
- **The below-card singleLine `VoterList` is the SOLE source of truth for poll respondents — no in-card respondent renders allowed.** It already aggregates everyone who has participated or abstained in any phase of the poll (suggestion, ranking, availability, preferences) via the wrapper's `voter_names` + `anonymous_count` (poll-level static mode) or per-question votes (per-question live mode). An earlier version of `RankingSection` rendered a non-singleLine `<VoterList label="Ranked">` (👥 icon + count + bubbles) under the ranking list during the suggestion phase, duplicating the below-card row and visually crowding the ballot. Don't add another in-card respondent display for any new question type or phase — anything you'd want to surface there is already in the below-card row.

### Cross-Tab Real-Time Refresh

- **`/g/<id>` polls `apiGetGroupByRouteId` every 5 seconds** (`app/g/[groupShortId]/GroupPage.tsx`) so other users' new polls and votes appear without a manual reload. Recursive `setTimeout` (5s after the previous response resolved), NOT `setInterval` — a slow network can't pile up overlapping fetches; the `inFlight` flag rejects re-entry. Skipped when the tab is hidden (`document.visibilityState !== 'visible'`); a `visibilitychange` listener fires an immediate refresh on re-show. Skipped while ANY placeholder poll is in group state — `POLL_PENDING_EVENT` / `POLL_HYDRATED_EVENT` owns that timeline and racing it would re-attach the placeholder after the user already saw the real card.
- **`mergePollListPreservingIdentity` (`lib/groupRefresh.ts`) keeps prev `Poll` references for polls whose content didn't change.** `GroupCardItem`'s `arePropsEqual` compares `prev.group.poll !== next.group.poll` by reference — passing the SAME `Poll` object is the difference between zero and N card re-renders per refresh tick. Steady-state ticks (no remote writes since the last fetch) return `prev` from the merge → `setGroup` returns `prev` from the updater → no re-render at all. Same pattern for `mergeQuestionResultsMap`: returns `prev` Map identity when no result-content changed. **Do NOT replace `group` wholesale on a refresh** — even if every poll's data is unchanged, fresh `Poll` objects fail `arePropsEqual`'s reference check and every card re-renders.
- **`isPollContentEqual` covers every field that can change at runtime** — `is_closed`, `close_reason`, `response_deadline`, `prephase_deadline`, `prephase_deadline_minutes`, `group_title`, `title`, `context`, `details`, `anonymous_count`, `updated_at`, `creator_name`, `voter_names` (length + values), and per-question `isQuestionContentEqual` (which itself walks `title`, `updated_at`, `response_count`, `question_index`, `poll_id`, `options`, `results`). When adding a new field that flips on user action (vote/close/edit), extend BOTH equality helpers OR a stale ref will be silently kept and the card won't re-render. The `updated_at` comparison alone is NOT sufficient: votes don't bump `updated_at` on the poll (the close-trigger only refreshes it on `is_closed` flips), and the FE-only `voter_names` aggregate is recomputed server-side per query.
- **Defer `loadVotedQuestions()` to inside the `setGroup` updater's changed-content branch.** The function allocates two fresh `Set<string>` instances and parses localStorage every call. Calling it once per 5s tick means most ticks (the no-change steady state) pay the cost for no reason. Move the call below the `if (!merge.changed) return prev;` short-circuit so it only runs when a poll genuinely changed.
- **`removed.size === 0` is redundant when paired with `merged.length === prev.length`.** In `mergePollListPreservingIdentity` the merged list is built from `fresh`; if `prev` had a poll that `fresh` doesn't, `merged.length < prev.length` and the existing length check catches it. The pre-merge identity-equality short-circuit needs only the length check + per-index reference equality; tracking a separate removed-set is dead weight in this path. (Removal IS detected via the length mismatch; `anyContentChanged` flips true via the additions side.)

### Avoiding Layout Shift in Group List on Refresh

- **Compact preview slots must be populated on first paint.** `questionResultsMap` is seeded synchronously from inline `question.results` in its `useState` initializer (from `initialGroup.questions`) AND again in an async `setQuestionResultsMap` updater before `setGroup` on cache-miss loads. Without this, the slot mounts empty and fills in once the viewport-intersection fetch resolves — making every card grow ~26-32px. Guard the updater with `filter(...).length === 0 ? prev : new Map(prev)` so a no-op doesn't allocate.
- **`apiGetAccessibleQuestions` now returns inline `results` for every open question with `show_preliminary_results=true` and `min_responses` unset-or-met.** The old backend gate required `min_responses` to be SET AND met, which left typical open questions (no threshold) without inline results and forced per-card round-trips. If you loosen / tighten this further, update `server/routers/questions.py: get_accessible_questions`.
- **`apiGetAccessibleQuestions` also calls `cacheQuestionResults` for every inline result** so the per-question results cache stays consistent with the bulk response. Without this, a later `apiGetQuestionResults(id)` call would cache-miss and re-fetch despite the data already being in hand.
- **Votes prefetch happens immediately after the groups-endpoint response lands.** The group page calls `apiGetGroupByRouteId(groupId)` (which already does server-side discovery via `polls.group_id`), then fires `void apiGetVotes(sp.id).catch(() => null)` for every question of every returned poll. `apiGetVotes` is cache + in-flight coalesced, so the per-VoterList fetch that fires at mount hits either the cache or the already-in-flight promise. This is what makes respondent bubbles appear on the same frame as the cards instead of ~100ms after.
- **`VoterList` seeds state from the votes cache synchronously in the `useState` lazy initializer.** Uses a shared `deriveVoterState(votes, filter)` helper (also used by the async fetcher) to produce `{voters, anonymousCount, key}` from a votes array. Lazy `useState(() => ...)` runs once at mount; do NOT use `useRef(iife())` — the IIFE argument is evaluated eagerly on every render and the useRef-initial-value-only-on-first-render behavior doesn't suppress that. Combined with the group page's parallel prefetch, this means no skeleton flash even on cold refresh.
- **Measure the group page's fixed-header height in `useLayoutEffect`, not `useEffect`.** `useEffect` runs after paint → the first frame has `paddingTop=0` and the content sits at `y=0` → re-render shifts it down by ~100px. `useLayoutEffect` runs between the DOM commit and the browser paint, so the first painted frame already has the correct padding.
- **Don't use `useRef(initialValue)` with a complex expression to cache "run once on mount" computations.** The initial-value argument is evaluated on every render; `useRef` just ignores subsequent values. Use `useState(() => computeOnce())` — React guarantees the initializer runs exactly once at mount.

### API Development Pitfalls

- **`server/services/questions.py` is the home for non-route helpers.** Anything that's a free function operating on a DB connection (`_fetch_question_full`, `_finalize_*`, `_submit_vote_to_question`, `_edit_vote_on_question`, `_row_to_question`, `_compute_results`, etc.) lives in `services/questions.py` and is imported by both `routers/questions.py` and `routers/polls.py`. Don't reach across routers (`from routers.questions import _foo` from a sibling router) — that pattern was retired when `services/` was introduced. Underscore-prefixed names are kept as a "low-stability internal API during poll Phase X churn" signal; OK to drop the underscore once the surface stabilizes.
- **`server/services/groups.py` is the equivalent home for group-aggregation helpers (Phase B.3).** `polls_for_poll_ids(conn, poll_ids, *, include_results)` builds the `PollResponse[]` payload (with inline results, voter aggregates, response counts) from a list of poll_ids. Both `/api/questions/accessible` and `/api/groups/*` use it. `group_ids_for_question_ids` and `poll_ids_for_group_ids` are thin SQL wrappers; `resolve_group_id_from_route_id(conn, route_id)` does the four-form lookup (groups.short_id → groups.id → polls.short_id → polls.id). Phase B.4 introduced `~`-prefixed group short_ids that resolve via the first lookup; the legacy `/g/<root-poll-short-id>` form still resolves via the same first lookup because B.1 backfilled `groups.short_id` from the root poll's short_id. The polls.short_id / polls.id fallbacks remain only for redirects from legacy URL paths.
- **`BrowserIdMiddleware` reads/mints a `X-Browser-Id` header per request (Phase B.3).** A header (not cookie) because the FE talks same-origin to the API in prod (Next.js rewrite) and direct in dev/CI; cookies would require credentialed CORS which doesn't compose with `allow_origins=["*"]`. The id is always echoed on the response (even on 4xx/5xx) so the FE can adopt server-issued ids on the very first request. `request.state.browser_id` is populated for every request; **Phase B.3 only captures, doesn't enforce** — Phase C will add `group_members` and start gating visibility on this id. Reading/setting from a router: `getattr(request.state, "browser_id", None)`.
- **FE `lib/browserIdentity.ts` is the canonical browser-id storage.** `getBrowserId()` returns the localStorage value or null. `adoptServerBrowserId(value)` is called by `_internal.ts: fetchWithBase` after every fetch — it's a first-write-wins merger so a compromised middlebox can't rewrite the id mid-session (mismatch logs a warning and keeps the existing id). Don't roll your own UUID — let the server mint and adopt the response.
- **`apiGetMyGroups(accessibleQuestionIds)` and `apiGetGroupByRouteId(routeId)` (in `lib/api/groups.ts`) replace the legacy `discoverRelatedQuestions + apiGetAccessibleQuestions` pair.** Both warm `cachePoll` and the per-question results cache so subsequent `apiGetQuestionById`/`apiGetQuestionResults` calls hit warm cache. Use these for any new "give me this group" flow; don't reach for `apiGetAccessibleQuestions` in new code (it's preserved for the legacy compatibility layer). The drop-in `getMyGroups()` wrapper in `lib/simpleQuestionQueries.ts` is what `app/page.tsx`, `app/g/[groupShortId]/page.tsx`, and `lib/useGroup.ts` consume — it adds in-flight coalescing (StrictMode-safe), accessible-id persistence (the server-discovered question_ids get added to localStorage subject to the forgotten-list filter), and accessible-cache invalidation when the set grew.
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
- **Don't snapshot fields the destination form auto-derives.** `buildQuestionSnapshot` deliberately omits `title` and `is_auto_title`: the create-poll page's auto-title `useEffect` (`app/create-poll/page.tsx` ~line 272) regenerates the title from current form fields whenever `isAutoTitle` is true, and a user-typed yes_no prompt is meant to be retyped on a fresh copy rather than carried verbatim. Copying the title verbatim produced anachronistic "A or B?"-style auto-generated titles that reflected the source poll's old options/suggestions, not the new copy's input. The `?duplicate=` handler in `app/create-poll/page.tsx` therefore does NOT call `setTitle(duplicateData.title)`. Same principle applies when adding new auto-derived form state: if the destination already has an effect that recomputes the value from inputs, don't snapshot it. The `voteFromSuggestion` flow (a separate feature that builds a preference question from suggestions, not a duplicate) intentionally keeps writing the title — it's a different code path with different semantics.

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
- **Destination pages must signal "ready" via `usePageReady` (`lib/usePageReady.ts`).** The hook writes `data-page-ready=<normalized-pathname>` on `<html>` in a `useLayoutEffect`. `navigateWithTransition` waits on a `MutationObserver` for that attribute to match the expected pathname before releasing the transition. Every client page that is a navigation destination must call it — otherwise `waitForNavigation` falls back to its 3000 ms timeout and the browser captures stale DOM as the "new" snapshot, producing the "slide plays but new page looks identical to old" bug. Pages using `useGroup` (`lib/useGroup.ts`) inherit the signal for free. Pass `true` as soon as the page can render something meaningful (a spinner is fine, beats stale content); don't wait for full data-load.
- **`navigateWithTransition` fails closed when `data-page-ready` never lands.** If `waitForNavigation` times out, the transition callback throws `page-not-ready` and the browser skips the animation (per spec), doing an instant page swap. That's a better failure mode than animating stale→stale. Keep the `transition.finished.catch(() => {}).finally(cleanup)` dance — the catch is required because we deliberately throw.
- **`navigateBackWithTransition` must wait for `data-page-ready` symmetrically with the forward path.** An earlier version waited a flat 120 ms after `history.back()` and then let the browser capture whatever DOM was there as the "new" snapshot — which on a slow commit could include a partially rendered destination, or the still-mounted source route mid-re-render, reading visually as "the group flashes a different group before sliding to home." The back path can't pre-compute the target (we don't know it until `history.back()` flips the URL), so the sequence is: `history.back()` → `waitForUrlChange(predicate)` → read `window.location.pathname` as the target → `waitForPageReady(target, deadline)`. Same `throw new Error('page-not-ready')` on timeout aborts the transition for an instant swap. Same `.catch(() => {}).finally(cleanup)` plumbing on `transition.finished`. If you ever revert this to a fixed-delay wait, you'll re-introduce the stale-snapshot flash.
- **Same-path `router.push` is a no-op — don't wrap it in a transition.** `navigateWithTransition` early-returns when `normalizePath(targetPath) === normalizePath(location.pathname)` so `startViewTransition` never fires with identical old/new snapshots. Also covers the case where card-expand `history.replaceState` already moved the URL to the target.
- **Next.js App Router uses `history.pushState` internally, which does NOT fire `popstate`.** `popstate` only fires on back/forward. `lib/viewTransitions.ts` monkey-patches `history.pushState`/`replaceState` at module load to dispatch a custom `__app:urlchange` event — lets `waitForNavigation` Phase 1 await a real event instead of questioning. Idempotent via `window.__urlEventInstalled` flag. The patch runs on every route that imports the module; the guard makes re-imports free.
- **Trailing slashes require normalization.** The app uses `trailingSlash: true`, so `router.push('/group/xyz')` navigates to `/group/xyz/`. Any pathname comparison must strip the trailing slash; `lib/questionId.ts: normalizePath()` is the canonical helper.
- **Defer background refreshes on cache-hit to let React commit first.** On `app/group/[groupId]/page.tsx` the destination mounts synchronously from `questionCache`; the `fetchGroup` refresh (`apiGetGroupByRouteId` + votes prefetch) is scheduled via `requestIdleCallback` (with `setTimeout(0)` fallback for Safari) so it doesn't compete with the initial React commit during the transition. This collapses `ready-after-url` from ~300 ms to near-zero — remaining click→ready time is dominated by `router.push` internals, not user-code work.
- **View transitions capture DOM snapshots — Playwright `.screenshot()` reads the live DOM, not the pseudo-elements.** During an animation, the underlying DOM is the destination page; Playwright shows that, not the sliding pseudo-elements. Verify animation visibility by checking CSS animation events (`transition.ready`, `transition.finished`) or by slowing `animation-duration` to capture mid-frames.
- **`view-transition-name` on destination page headers makes them separate transition groups during EVERY navigation** — not just matching ones. If page A has `view-transition-name: hero` and page B doesn't, navigating A→B causes page A's hero to fade out independently while the root slides. If you want a hero-title morph, apply `view-transition-name` dynamically only during transitions where both source AND destination have the matching name; never set it statically on page headers.
- **Shared-element hero morphs don't work well when destination title ≠ source title.** The browser animates the source element's content into the destination position, so users see `"Question A"` sliding into where `"Group A"` will be, then flashing to the correct text. For pages with conceptually different titles (question → group), skip the morph entirely and let the whole page slide as a single root snapshot.

### Navigation Performance Benchmark (`scripts/bench-navigation.mjs`)

- **`npm run bench:nav` drives a real Chromium via Playwright against any URL.** Set `BENCH_URL=https://<origin>`; optional `BENCH_RUNS` (default 8), `BENCH_HEADLESS=0` to watch, `BENCH_CPU_THROTTLE=4` for 4× slowdown via CDP, `BENCH_JSON=path.json` for machine-readable output, `BENCH_VERBOSE=1` for browser console + pageerrors.
- **Core metric is `click → data-page-ready`.** All timing happens inside the browser via `performance.now()` to avoid Playwright CDP round-trip overhead. For `home → group (warm)` the bench also reports `click → url flip`, `ready after url`, and `click → transition done` (when the `data-nav-direction` attribute clears, i.e. `ViewTransition.finished` resolved).
- **Scenarios:** cold home load, home→group (warm + cold), group→home via back button, rapid home⇄group. Each scenario is wrapped in `try/catch` so dev-server flakiness (502s under memory pressure, HMR races) yields partial results rather than aborting the run.
- **Warm-up pass is built in.** On dev servers the first hit of `/group/[id]` triggers Next.js on-demand compile (can exceed 30s), so the bench hits the group route once before Scenario 2 to pay the compile cost outside measurement.
- **Structural DOM fallback covers dev HMR races.** If `data-page-ready` doesn't land in time but the page's canonical fingerprint (`[data-group-root-id]` on home, `body[data-group-latest-question-id]` on group) is present, treat as ready. Only matters in dev; in prod the attribute always wins.
- **Reference numbers** (prod-mode build on a dev droplet, 10 runs, for the main "home→group (warm)" scenario): click→url p50 ~200-500ms, ready-after-url p50 ~0-320ms, click→ready p50 ~450-600ms, click→transition-done p50 ~1100-1200ms (final ~500ms is the CSS slide animation). Heavy run-to-run variance on the 1 GB droplet — repeat 2-3 times before drawing conclusions.
- **Dev numbers are inflated 3-6× vs prod** (on-demand compile + React dev mode). For apples-to-apples comparisons build prod mode per `### Production build testing on dev droplet`.

### In-memory data cache for navigation

- **`lib/questionCache.ts` caches question/results/votes/participants data** so destination pages render instantly from cache on navigation. 60s TTL for questions, 15s for results/votes (which change more often). All maps capped at 100 entries with LRU eviction to bound memory for long-lived PWA sessions.
- **Mutations must invalidate the cache.** `invalidateQuestion(id)` clears all per-question caches AND the `accessibleQuestionsCache`. Call after every successful vote, close, reopen, and cutoff.
- **`getMyGroups` must invalidate the accessible questions cache when it adds new IDs.** Otherwise subsequent `getAccessiblePolls()` calls return a stale list missing the newly-discovered questions. The current implementation in `lib/simpleQuestionQueries.ts` already does this (`invalidateAccessibleQuestions()` when `discovered > 0`).
- **Forgotten questions must stay forgotten across discovery.** `forgetQuestion` removes a question from `accessible_question_ids` AND adds it to `forgotten_question_ids` in localStorage. `getMyGroups` filters server-discovered ids against `getForgottenQuestionIds()` before calling `addAccessibleQuestionId` — otherwise the server's `polls.group_id` aggregation would re-add forgotten questions on the next navigation, unforgetting them. `addAccessibleQuestionId` clears the forgotten marker, so visiting the URL directly still re-grants access (consistent with the "URLs grant access" model). Reserve `addAccessibleQuestionId` for *explicit* access grants (question/group page visit, creator flow) — automatic discovery callers must gate on `getForgottenQuestionIds()` before calling it.
- **`getAccessiblePolls`'s cache-freshness check is asymmetric.** It re-fetches when any accessible ID is *missing* from the cache (a new question was discovered) but does NOT detect *stale extras* (a question the user removed). So every removal mutation — forget, revoke, etc. — MUST call `invalidateQuestion()` / `invalidateAccessibleQuestions()` itself; the next `getAccessiblePolls()` call will happily return a stale cache containing the removed question.
- **Coalesce concurrent API calls** with `coalesced()` in `lib/api.ts`. React StrictMode double-mounts effects in dev, causing two simultaneous calls to the same endpoint. Same idiom for `getMyGroups` and `getAccessiblePolls` — both use an in-flight promise to dedupe.

### Production build testing on dev droplet

- To test with a real production bundle instead of `next dev` on the dev server:
  ```bash
  bash scripts/remote.sh "fuser -k 3001/tcp; cd /root/dev-servers/<slug> && rm -rf .next && PYTHON_API_URL='http://localhost:8001' npm run build && nohup npx next start -p 3001 > nextjs-prod.log 2>&1 &"
  ```
- **Patch `next.config.ts` first** — as mentioned above, production mode ignores `PYTHON_API_URL`. Add an early return at the top of `getApiRewriteDestination()`: `if (process.env.PYTHON_API_URL) return process.env.PYTHON_API_URL;`
- **The next git push will clobber the build** — the webhook calls `dev-server-manager.sh upsert` which runs `git pull` (resetting `next.config.ts` patch) and starts `next dev` again. For extended testing, be prepared to re-apply the patch and rebuild after each push.

### Client-side rendering from cache pattern

- **Destination pages that are navigated to frequently should initialize state synchronously from `questionCache`.** Example (`app/g/[groupShortId]/page.tsx`, `app/group/[groupId]/page.tsx`): the `useState` initializer reads `getCachedQuestionById` / `getCachedQuestionByShortId` and uses the result directly. No loading spinner if cache hit.
- **Call `loadVotedQuestions()` exactly once** for both `votedQuestionIds` and `abstainedQuestionIds` state init. It parses localStorage each call — easy to accidentally call twice in adjacent `useState` initializers.
- **`usePageTitle` dispatches a `pageTitleChange` event** that the template listens for. On first render the template's `questionPageTitle` state is empty; if the page is the target of a view transition, the `<h1>` is missing from the initial snapshot. Fix: in `template.tsx`, initialize `questionPageTitle` synchronously by parsing the pathname and looking up the cached question's title.
