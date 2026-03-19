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

### Phase 7 (do first)
1. Connect GitHub repo to Vercel, configure build
2. Add `api.whoeverwants.com` DNS + Caddy config
3. Add `vercel.json` rewrites or update `lib/api.ts` to call API subdomain
4. Update DNS: `whoeverwants.com` → Vercel
5. Remove Next.js from droplet, update health checks and docs
6. Verify all poll types work E2E

### Phase 8 (do second)
1. Add `*.api.whoeverwants.com` wildcard DNS
2. Write `preview-manager.sh` (create/list/destroy)
3. Update `lib/api.ts` to derive API URL from branch name in Vercel previews
4. Write `deploy-preview.sh` convenience wrapper
5. Test E2E: create preview from test branch
6. Add auto-cleanup cron
7. Update CLAUDE.md and provision script

---

## Cost Summary

| Item | Cost |
|------|------|
| Vercel free tier | $0 (100GB bandwidth, unlimited preview deploys) |
| Droplet (stays at 1GB) | $6/mo (no upgrade needed!) |
| DNS records | Free |
| TLS certs | Free (Vercel + Caddy/Let's Encrypt) |
