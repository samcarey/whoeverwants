# Infrastructure Improvement Plan

## Phase 7: Move Production Frontend to Vercel

**Goal**: Use Vercel's free tier to host the Next.js frontend. Vercel handles builds, CDN edge serving, TLS, and zero-downtime deploys. The droplet becomes API-only (Python + Postgres), freeing RAM and simplifying ops.

**Why**: Vercel is Next.js's native platform — free tier includes builds, edge CDN, preview deploys, and auto-TLS. This was previously configured for this project before the Supabase migration moved everything to the droplet.

### Architecture After Migration

```
Browser ──► Vercel (Next.js frontend, CDN, TLS)
              │
              ├── Static pages / SSR served from Vercel edge
              └── /api/polls* ──► (Vercel rewrite) ──► droplet:8000 (FastAPI)

Droplet (142.93.60.29):
  ├── Caddy (TLS for API subdomain)
  ├── FastAPI (Docker, port 8000)
  ├── PostgreSQL (Docker, port 5432)
  └── cmd-api (port 9090, management)
```

### Steps

1. ~~**Expose API on a public subdomain**~~ ✅ DONE
   - Caddy on droplet configured for `api.whoeverwants.com` with CORS headers and OPTIONS handling
   - Old `whoeverwants.com` Caddy block removed

2. ~~**Update frontend API client**~~ ✅ DONE
   - `lib/api.ts` calls `https://api.whoeverwants.com/api/polls` directly in production
   - Dev mode still uses relative path (proxied by Next.js rewrites)
   - `vercel.json` added for Vercel build config

3. ~~**Remove Next.js from droplet**~~ ✅ DONE
   - `whoeverwants-web.service` stopped and disabled
   - Caddy now only serves `api.whoeverwants.com` (no more localhost:3000 proxy)
   - Health check script updated (removed Next.js check)

4. ~~**Update CORS**~~ ✅ DONE
   - FastAPI CORS tightened to `https://whoeverwants.com` + `http://localhost:3000`
   - Configurable via `CORS_ORIGINS` env var

5. ~~**Update docs**~~ ✅ DONE
   - CLAUDE.md updated (development workflow, droplet purpose, env vars including `VERCEL_API_TOKEN`)
   - `docs/droplet-setup.md` rewritten for API-only architecture
   - `scripts/provision-droplet.sh` updated (removed Node.js/Next.js steps, now 11 steps)
   - `scripts/health-check.sh` updated (removed Next.js check)

6. ~~**Set up Vercel project**~~ ✅ DONE
   - Project `whoeverwants` exists (`prj_07PAXGI2wG74cGRKREB0BiIDUWSn`)
   - Domains configured: `whoeverwants.com`, `www.whoeverwants.com` (redirect), `whoeverwants.vercel.app` (redirect)
   - Environment vars set: `NEXT_PUBLIC_SUPABASE_URL_PRODUCTION`, `NEXT_PUBLIC_SUPABASE_ANON_KEY_PRODUCTION`
   - Next.js updated from 15.3.3 → 15.5.14 to fix security CVEs blocking builds
   - Preview builds now succeed (branch `claude/continue-plan-Stbwu` deployed successfully)

7. ~~**Update DNS**~~ ✅ DONE
   - `api.whoeverwants.com` → A record → `142.93.60.29` (droplet)
   - `whoeverwants.com` → A record → `76.76.21.21` (Vercel)
   - DNS managed via AWS Route 53

8. ~~**Verify end-to-end**~~ ✅ DONE
   - Merged to `main`, production Vercel deploy succeeded (READY)
   - `whoeverwants.com` served by Vercel (`server: Vercel`, HTTP 200)
   - `api.whoeverwants.com/health` returns OK (droplet FastAPI + Postgres)
   - CORS preflight passes (origin: `https://whoeverwants.com`)
   - API accessible polls endpoint returns data correctly

### Phase 7 Complete ✅

### Session Notes (2026-03-19)

**What was done this session:**
1. Diagnosed Vercel deployment failures — all builds were ERROR due to "Vulnerable version of Next.js detected"
2. Updated Next.js from 15.3.3 → 15.5.14 (latest 15.x patch) to fix multiple CVEs
3. Verified Vercel preview build succeeded from feature branch
4. User merged to `main` — production Vercel deploy now READY
5. User updated DNS in AWS Route 53: `whoeverwants.com` A record → `76.76.21.21` (Vercel)
6. Verified end-to-end: Vercel serving frontend, droplet serving API, CORS working

**Current production architecture:**
- `whoeverwants.com` → Vercel (76.76.21.21) — Next.js frontend, CDN, auto-TLS
- `api.whoeverwants.com` → Droplet (142.93.60.29) — Caddy → FastAPI → PostgreSQL
- Auto-deploy: push to `main` triggers Vercel production build
- Vercel project ID: `prj_07PAXGI2wG74cGRKREB0BiIDUWSn`

**Known issues / things to watch:**
- Vercel preview deployments are behind SSO protection (can't test previews without auth)
- `CORS allow-origin` is currently `*` (broad) — should be tightened to specific origins if needed
- Next.js 16.x is available but would be a major version upgrade — staying on 15.x for stability

**Next up:** Phase 8 — Preview Environments for Development

### Vercel CLI Access for Claude

To let Claude Code sessions trigger deploys or check status:
- Generate a Vercel API token at https://vercel.com/account/tokens
- Store as `VERCEL_TOKEN` environment variable (same pattern as `DROPLET_API_TOKEN`)
- Use `npx vercel --token $VERCEL_TOKEN` or the Vercel REST API for deploy management
- Vercel also auto-deploys on push to `main` (no manual trigger needed for production)

### Benefits

| Before (droplet-only) | After (Vercel + droplet) |
|----------------------|------------------------|
| Next.js builds on 1GB droplet (needs 2GB swap) | Vercel builds for free |
| Self-managed TLS via Caddy | Vercel auto-TLS + CDN edge |
| Single-server SPOF for frontend | Vercel global CDN, highly available |
| Manual deploy: git pull + build + restart | Auto-deploy on push to main |
| ~400MB RAM for full stack | ~200MB RAM (API + DB only) |

---

## Phase 8: Preview Environments for Development

**Goal**: On-demand per-branch preview environments. Claude Code web sessions push to a branch, trigger a build, and get a public URL to test.

**Prerequisite**: Phase 7 complete (Vercel handles production frontend). The droplet has more headroom for preview API instances.

### Architecture

- **Production frontend**: Vercel auto-deploys from `main` → `whoeverwants.com`
- **Preview frontends**: Vercel auto-deploys from any branch → `*.vercel.app` preview URLs (free!)
- **Preview APIs**: Droplet runs per-branch FastAPI + separate Postgres databases
- **Preview API routing**: `<slug>.api.whoeverwants.com` → Caddy → per-branch FastAPI container

### Key Insight: Vercel Already Does Preview Deploys

Vercel automatically creates preview deployments for every push to a non-main branch. Each gets a unique URL like `whoeverwants-<hash>.vercel.app`. The missing piece is the **backend** — each preview frontend needs its own API instance with its own database.

### Per-Preview Stack (API-only on droplet)

| Component | Implementation | Resource Cost |
|-----------|---------------|---------------|
| Frontend | **Vercel preview deploy** (free, automatic) | $0, no droplet RAM |
| Database | Separate Postgres database in shared container | ~5-10MB |
| FastAPI | Separate Docker container, unique port | ~50-80MB RAM |

This is much lighter than the original plan since there's no Next.js process per preview on the droplet.

### Preview Manager

`scripts/preview-manager.sh` on the droplet:

#### `preview create <branch-name>`

1. `git fetch origin <branch>`
2. `git worktree add /root/previews/<slug> origin/<branch>`
3. `createdb preview_<slug>` in shared Postgres
4. `pg_dump whoeverwants | psql preview_<slug>` (copy prod data)
5. Apply new migrations from the branch
6. Build & start FastAPI container on unique port
7. Add `<slug>.api.whoeverwants.com` to Caddy, reload
8. Write `.preview-meta.json` with metadata

#### `preview list`

```
SLUG                    BRANCH                           CREATED              FRONTEND                                              API
fix-voting-abc123       claude/fix-voting-bug-abc123     2026-03-19 14:00     (Vercel preview URL)                                  https://fix-voting-abc123.api.whoeverwants.com
```

#### `preview destroy <slug>` / `preview destroy-all`

Stop container, drop database, remove Caddy block, clean up worktree.

### Developer Attribution via `GIT_AUTHOR_EMAIL`

Each developer sets `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` as environment variables in their Claude Code session config. These are standard git env vars that override `git config` per-session.

- Commits show the developer as **author** and Claude as **committer** — proper attribution for who directed vs. executed the work
- If `GIT_AUTHOR_EMAIL` is unset or is `noreply@anthropic.com` (Claude's default), skip dev site deployment — there's no developer to associate it with
- The dev preview URL is derived from the email: replace `@` with `-` → e.g. `sam-example.com.whoeverwants.com`

### Connecting Vercel Preview to Branch API

The frontend needs to know which API to call. Options:

**Option A: Environment variable per Vercel preview**
- Set `NEXT_PUBLIC_API_URL` in Vercel's preview environment settings
- Problem: different per branch, hard to automate

**Option B: Convention-based URL derivation**
- Frontend derives API URL from the branch name: if branch is `claude/foo-bar-abc123`, API is at `https://foo-bar-abc123.api.whoeverwants.com`
- `lib/api.ts` checks `process.env.VERCEL_GIT_COMMIT_REF` (available in Vercel builds) to derive the API URL
- Falls back to `api.whoeverwants.com` for production

**Option C: Query parameter override**
- Allow `?api=foo-bar-abc123` in the URL to override the API endpoint
- Most flexible, no build-time coupling

**Recommended**: Option B (convention-based). Clean, automatic, no manual config per branch.

### DNS Setup

- `*.api.whoeverwants.com` → wildcard A record → droplet IP
- Caddy auto-provisions per-subdomain TLS certs

### Claude Code Web Session Workflow

Developers must set these env vars in their Claude Code session config:
- `GIT_AUTHOR_NAME` — e.g. `Sam Carey`
- `GIT_AUTHOR_EMAIL` — e.g. `sam@example.com`

```bash
# 1. Push branch
git push -u origin claude/my-feature-xyz

# 2. Create preview API on droplet (only if GIT_AUTHOR_EMAIL is set and not Claude's default)
#    Skip if GIT_AUTHOR_EMAIL is unset or "noreply@anthropic.com"
bash scripts/remote.sh "bash /root/whoeverwants/scripts/preview-manager.sh create claude/my-feature-xyz" /root 300

# 3. Vercel auto-deploys frontend preview (triggered by push)
#    Dev site URL derived from GIT_AUTHOR_EMAIL: sam-example.com.whoeverwants.com
# Output:
#   API ready: https://my-feature-xyz.api.whoeverwants.com
#   Frontend: https://sam-example.com.whoeverwants.com (or Vercel preview URL)
```

### Auto-Cleanup

- Cron job: destroy API previews older than 7 days
- Vercel auto-cleans preview deploys (configurable retention)

### Droplet Sizing

With Vercel handling all frontends, the droplet only needs RAM for:
- Production: Postgres (~100MB) + FastAPI (~60MB) + Caddy + cmd-api ≈ ~200MB
- Each preview: FastAPI container (~60MB) + DB overhead (~10MB) ≈ ~70MB

**On current 1GB**: production + 4-5 previews easily. No upgrade needed.

---

## Implementation Order

### ~~Phase 7~~ ✅ COMPLETE

### ~~Phase 8~~ ✅ COMPLETE

### ~~Phase 9~~ ✅ COMPLETE (CI Fixes — PR #7)
1. ~~Add `*.api.whoeverwants.com` wildcard DNS~~ ✅ DONE
   - Wildcard A record added in AWS Route 53: `*.api.whoeverwants.com` → `142.93.60.29`
   - Verified: `test-preview.api.whoeverwants.com` resolves correctly
2. ~~Write `preview-manager.sh` (create/list/destroy)~~ ✅ DONE
   - `scripts/preview-manager.sh` with create/list/destroy/destroy-all/cleanup commands
   - Tested on droplet: full create → list → destroy round-trip working
3. ~~Update `lib/api.ts` to derive API URL from branch name in Vercel previews~~ ✅ DONE
   - Uses `VERCEL_GIT_COMMIT_REF` (exposed via `next.config.ts`) to derive slug
   - Convention: `claude/foo-bar-xyz` → `https://foo-bar-xyz.api.whoeverwants.com/api/polls`
4. ~~Write `deploy-preview.sh` convenience wrapper~~ ✅ DONE
   - Pushes branch + creates preview API on droplet in one command
5. ~~Test E2E: create preview from test branch~~ ✅ DONE
   - Created preview for `claude/continue-plan-D3M5v`
   - Preview API healthy on port 8001, isolated database created
   - Public URL verified: `https://continue-plan-d3m5v.api.whoeverwants.com/health` → OK
   - Destroy verified: container removed, database dropped, Caddy cleaned
6. ~~Add auto-cleanup cron~~ ✅ DONE
   - Daily at 4 AM: destroys previews older than 7 days
   - Cron installed on droplet
7. ~~Update CLAUDE.md and provision script~~ ✅ DONE
   - CLAUDE.md: added preview environments section to development workflow
   - `docs/droplet-setup.md`: updated architecture diagram, DNS, cron jobs, preview docs
   - `scripts/provision-droplet.sh`: added preview directory setup, Caddy import, cleanup cron

---

## Phase 9: Fix GitHub PR CI Checks ✅ COMPLETE

**Goal**: Get all GitHub Actions CI checks passing so PRs can be merged with confidence.

### Issues Found & Fixed (PR #7)

1. **Vitest coverage provider (`c8` → `v8`)**
   - `npm run test:coverage` failed with `Failed to load custom CoverageProviderModule from undefined`
   - Root cause: vitest 3.x deprecated the `c8` provider
   - Fix: Changed `vitest.config.js` provider to `v8`, added `@vitest/coverage-v8` as devDependency

2. **GitHub Pages static export (`"use client"` + `generateStaticParams` conflict)**
   - `deploy-dev.yml` appended `generateStaticParams()` to `app/p/[shortId]/page.tsx`, but that file has `"use client"` — Next.js doesn't allow both
   - Attempted fixes: re-exporting client component from server wrapper (Next.js still couldn't find the export), `printf` replacement (file was written correctly but Next.js still didn't pick it up — possibly a Next.js static analysis quirk)
   - Final fix: delete the dynamic `[shortId]` route entirely during static export — GitHub Pages SPA fallback (404.html) handles client-side routing anyway

3. **PR comment permissions**
   - `pr-checks.yml` quality-gate job failed on "Comment PR with test results" with `Resource not accessible by integration`
   - Fix: Added `permissions: pull-requests: write` to the workflow

4. **GitHub Pages deploy restricted to `main` branch**
   - The `deploy` step always failed on feature branches because the `github-pages` environment only allows deployments from `main`
   - Fix: Changed `deploy-dev.yml` trigger from `branches: ['**']` to `branches: [main]`

### Lessons Learned

- **Vitest 3.x requires `@vitest/coverage-v8`** — the old `c8` provider is gone. Always match the coverage package version to the vitest major version.
- **Next.js static export (`output: 'export'`) and `"use client"` pages**: Even if you write a correct server component wrapper that re-exports from a client module, Next.js static analysis may not find `generateStaticParams`. The simplest fix for dynamic routes in static export is to delete them and rely on SPA fallback routing.
- **GitHub Actions workflow permissions**: PR comment workflows need explicit `permissions: pull-requests: write`. Without it, the `GITHUB_TOKEN` lacks write access to PR comments.
- **GitHub Pages environments**: Only allow deploys from the configured branch (usually `main`). Feature branch pushes will always fail the deploy step. Restrict the workflow trigger to `main` to avoid noisy failures.
- **YAML heredocs in GitHub Actions `run: |` blocks**: Heredoc content with less indentation than the surrounding YAML breaks the literal block scalar. Use `printf` instead for inline file generation.

---

### Session Notes (2026-03-20)

**What was done this session:**
1. Added `GITHUB_API_TOKEN` to CLAUDE.md as a required environment variable
2. Token is a GitHub fine-grained PAT scoped to `samcarey/whoeverwants` with permissions: Pull Requests (R/W), Issues (Read), Contents (R/W), Commit Statuses (Read), Actions (Read)
3. Fixed all GitHub Actions CI checks (PR #7, merged to main):
   - Vitest coverage provider: `c8` → `v8` + `@vitest/coverage-v8`
   - Static export: remove dynamic route instead of patching it
   - PR checks: added `pull-requests: write` permission
   - Deploy workflow: restricted to `main` branch only

**Current status:**
- Phases 7, 8, and 9 are complete
- All CI checks passing on PRs (quality-gate, test, test-matrix 18/20, Vercel preview)
- GitHub API access working for PR workflow automation

**For next session:**
- `GITHUB_API_TOKEN` will be available as an environment variable
- Use it with `curl -H "Authorization: token $GITHUB_API_TOKEN"` for GitHub REST API calls
- All CI checks should be green on new PRs — if not, check the lessons learned above

---

## Phase 10: Per-User Dev Servers (Replacing Vercel Previews)

**Goal**: Replace Vercel preview deployments with per-user Next.js dev servers on the droplet. Each developer gets a stable, bookmarkable URL based on their email address that automatically updates when they push code.

**Why**: Vercel previews are slow to build, require sign-in to view, and generate a different URL for every push. Per-user dev servers on the droplet provide instant-ish updates, no auth required, and a permanent URL per developer.

### Architecture

```
Developer pushes code
  │
  ├── GitHub webhook ──► hooks.api.whoeverwants.com
  │                        │
  │                        ├── Extract author email from commits
  │                        ├── Ignore Claude/bot emails (*@anthropic.com)
  │                        └── Trigger dev-server-manager.sh upsert
  │
  └── dev-server-manager.sh
        │
        ├── New author: git clone + npm ci + next build + start
        └── Existing author: git fetch + checkout + rebuild + restart

URL: https://<email-slug>.dev.whoeverwants.com
  sam@example.com → sam-at-example-com.dev.whoeverwants.com
  (same URL regardless of branch)
```

### Steps

1. **Write `dev-server-manager.sh`** — per-user dev server lifecycle management
   - `upsert <email> <branch>`: create or update dev server
   - `list`: show all active dev servers with status
   - `destroy <slug>`: tear down a dev server
   - `cleanup [days]`: destroy idle dev servers
   - `revive`: restart stopped servers (e.g., after reboot)

2. **Write `dev-webhook.py`** — GitHub webhook handler
   - Listens on port 9091 (proxied by Caddy via `hooks.api.whoeverwants.com`)
   - Verifies GitHub HMAC-SHA256 signatures
   - Extracts author emails from push event commits
   - Triggers `dev-server-manager.sh upsert` in background threads

3. **Install Node.js on droplet** — required for Next.js builds
   - Node.js 20 LTS via NodeSource

4. **Update Caddy config** — add routes for dev servers and webhook
   - `hooks.api.whoeverwants.com` → webhook handler (port 9091)
   - `*.dev.whoeverwants.com` → per-user Next.js servers (ports 3001-3010)
   - Import `/etc/caddy/dev-servers/*.caddy` for per-user configs

5. **Add DNS record** — `*.dev.whoeverwants.com` A record → droplet IP
   - In AWS Route 53 (user action)

6. **Set up GitHub webhook** — register webhook via GitHub API
   - Payload URL: `https://hooks.api.whoeverwants.com/github`
   - Events: `push` only
   - Secret: from `/etc/dev-webhook-secret`

7. **Add systemd services** — reliability
   - `dev-webhook.service`: webhook handler (auto-restart)
   - `dev-servers-revive.service`: restart dev servers on boot

8. **Update docs** — CLAUDE.md, droplet-setup.md, provision-droplet.sh

### Key Design Decisions

- **Standalone builds** (not `next dev`): ~100MB RAM at runtime vs ~400MB for dev mode
- **Production API**: Dev servers use `api.whoeverwants.com` — frontend-only testing
- **Per-user locking**: Only one build runs per user at a time (flock)
- **Email-based identity**: `GIT_AUTHOR_EMAIL` determines which dev server to update
- **Shallow clones**: `--depth 50` to save disk space

---

## Cost Summary

| Item | Cost |
|------|------|
| Vercel free tier | $0 (100GB bandwidth, unlimited preview deploys) |
| Droplet (stays at 1GB) | $6/mo (no upgrade needed!) |
| DNS records | Free |
| TLS certs | Free (Vercel + Caddy/Let's Encrypt) |
