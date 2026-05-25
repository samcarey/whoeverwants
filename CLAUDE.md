# WhoeverWants Development Environment

## Project Overview

**WhoeverWants** is an anonymous questioning application for group decision-making. Users create and vote on questions without accounts or sign-ups, sharing via link.

- **Live site**: https://whoeverwants.com
- **Repository**: https://github.com/samcarey/whoeverwants
- **License**: Dual MIT / Apache 2.0

## Active Plan

The Supabase-to-Python migration and infrastructure improvements (Phases 1-10) are complete. The current architecture is: Vercel (frontend) + DigitalOcean droplet (FastAPI API + PostgreSQL).

**Next major change: poll redesign.** Every question becomes a poll wrapping one or more questions. A category bubble bar (one bubble per `BUILT_IN_TYPES` entry plus "Other" — `BUBBLE_ENTRIES` in `app/create-poll/page.tsx`) replaces the single new group button on groups. Tapping a bubble seeds a fresh draft with that category preselected and opens the new-question modal.

> **Historical note on What/When/Where:** Earlier iterations of the redesign shipped a 3-bubble bar (What/When/Where) that preselected via `?mode=time` / `?category=restaurant`. That trichotomy was eliminated; references to "What/When/Where" in Phase 2.3 / Navigation Layout / Always-On Draft Poll Card sections below are historical context, NOT the current UI. The current bar is per-category.

## DigitalOcean Droplets — Two-Tier Deploy

WhoeverWants runs on **two** DigitalOcean droplets that are software-identical (same `scripts/provision-droplet.sh`, same Docker stack, same migrations). Only the public hostnames and deploy trigger differ — see "Development Workflow" below for the gating.

- **`whoeverwants` (prod)** — `142.93.60.29`, fronts `api.whoeverwants.com` + `hooks.api.whoeverwants.com`. Deploys when a GitHub Release is published, pinned to the release's tag.
- **`latest` (pre-prod canary)** — `67.207.94.93`, fronts `api.latest.whoeverwants.com` + `hooks.api.latest.whoeverwants.com`. Deploys on every push to `main` so the latest code is exercised in its final configuration (release-mode build, droplet, Caddy, Postgres) before a production release.

Behavior is driven by `/etc/droplet-label` on each droplet (`""` = prod, `"latest"` = canary). `scripts/dev-webhook.py` reads it at startup. `scripts/provision-droplet.sh` accepts `DROPLET_LABEL=latest` to provision a canary; default behavior is prod.

### Server Specs (both droplets — match exactly)
| Property | Value |
|----------|-------|
| Image | Ubuntu 24.04 LTS |
| Size | s-1vcpu-1gb (1 GB RAM, 24 GB SSD) |
| Region | nyc1 |
| User | `root` |

| Hostname | IP | Tier | Public hosts |
|----------|----|----|--------------|
| `whoeverwants` | `142.93.60.29` | prod | `api.whoeverwants.com`, `hooks.api.whoeverwants.com` |
| `latest` | `67.207.94.93` | canary | `api.latest.whoeverwants.com`, `hooks.api.latest.whoeverwants.com` |

### Remote Command Execution

Both droplets are reachable over their own sslip.io URL via a sibling pair of helpers:

```bash
# Prod droplet
bash scripts/remote.sh "command" [working_dir] [timeout_seconds]

# Latest (canary) droplet
bash scripts/remote-latest.sh "command" [working_dir] [timeout_seconds]
```

Both honor the same JSON protocol; only the env vars differ. Examples:

```bash
bash scripts/remote.sh "hostname && uptime"                  # prod
bash scripts/remote-latest.sh "hostname && uptime"           # latest
bash scripts/remote.sh "docker compose logs --tail 50" /root/whoeverwants
bash scripts/remote-latest.sh "cat /etc/droplet-label"       # should print "latest"
```

### Required Environment Variables

The following environment variables must be available. In the Claude Code web environment, these are pre-set as environment variables (not in a `.env` file).

```
DROPLET_API_URL=https://142-93-60-29.sslip.io
DROPLET_API_TOKEN=<bearer token>
LATEST_DROPLET_API_URL=https://67-207-94-93.sslip.io
LATEST_DROPLET_API_TOKEN=<bearer token for latest droplet>
DIGITAL_OCEAN_TOKEN=<DO API v2 token>
VERCEL_API_TOKEN=<vercel api token>
GITHUB_API_TOKEN=<github fine-grained PAT>
```

- `DROPLET_API_URL` / `DROPLET_API_TOKEN` — Prod droplet cmd-api. Used by `scripts/remote.sh`.
- `LATEST_DROPLET_API_URL` / `LATEST_DROPLET_API_TOKEN` — Latest (canary) droplet cmd-api. Used by `scripts/remote-latest.sh`.
- `DIGITAL_OCEAN_TOKEN` — DigitalOcean API token. Used when creating / managing droplets (e.g. spinning up a fresh latest droplet via cloud-init).
- `VERCEL_API_TOKEN` — Authenticate requests to the [Vercel REST API](https://vercel.com/docs/rest-api) for managing frontend deployments.
- `GITHUB_API_TOKEN` — GitHub fine-grained Personal Access Token scoped to `samcarey/whoeverwants`. Permissions: Pull Requests (R/W), Issues (Read), Contents (R/W), Commit Statuses (Read), Actions (Read). Used for creating PRs, reading issues, and checking CI status via the GitHub REST API. Note: webhook admin is NOT in the scope, so adding/editing GitHub webhooks must be done manually in the GitHub UI.

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

**Frontend** (Vercel):
- Single Vercel project (`prj_07PAXGI2wG74cGRKREB0BiIDUWSn`); same build artifact serves both tiers.
- Push to `main` → Vercel builds + aliases the deployment to `latest.whoeverwants.com`.
- Publishing a GitHub Release → Vercel alias for `whoeverwants.com` is moved to that build (release deployment promoted to prod).
- API destination is selected at request time via `host`-conditional rewrites in `next.config.ts`: `latest.whoeverwants.com` → `api.latest.whoeverwants.com`; everything else → `api.whoeverwants.com` (or branch preview for non-main builds). **As of May 2026 the browser BYPASSES these rewrites** (see next bullet); the rewrites remain wired up for dev mode and as the SSR fallback.
- **Browser-to-API calls bypass Vercel's edge proxy in production builds (May 2026 onward).** `lib/api/_internal.ts: computeApiOrigin` returns an absolute URL in production browser builds (host-conditional: `whoeverwants.com` → `https://api.whoeverwants.com`, `latest.whoeverwants.com` → `https://api.latest.whoeverwants.com`, branch preview → `https://<slug>.api.whoeverwants.com`) and an empty string ("relative") in dev so the per-branch Mac dev server's Next.js rewrite to the in-container FastAPI keeps working. SSR keeps its existing absolute-URL branch (unchanged). The bypass is forced by a Vercel-side regression: starting May 13 2026, Let's Encrypt rolled out new "Generation Y" intermediates (E5–E9 ECDSA, R10–R14 RSA — including the now-default E8 and R12) following a halt-and-reissue incident on May 8 caused by missing `id-kp-serverAuth` EKU fields per new CA/B Forum rules. Vercel's edge proxy then fails the TLS handshake to upstream targets signed by the new intermediates on roughly 5–10% of US POPs, returning `ROUTER_EXTERNAL_TARGET_HANDSHAKE_ERROR` 502s on every `/api/*` rewrite (the certs themselves are universally trusted by every standard TLS client — curl, browsers, mobile WebViews; the bug is specifically in Vercel's edge trust store). Multiple Vercel Pro customers reported it on community.vercel.com, no fix as of the original switch. Going direct via CORS sidesteps the broken hop entirely. The FastAPI's CORS config (`allow_origins=["*"]`, `allow_credentials=False`) handles cross-origin POSTs cleanly; `X-Browser-Id` is the identity header (not a cookie), so the no-credentials preflight is the simple one. **Three image / direct-fetch URL builders also use `API_ORIGIN`** (`buildGroupImageUrl` in `lib/groupUtils.ts`, `buildUserImageUrl` in `lib/api/users.ts`, the log-forwarder POST target in `lib/clientLogForwarder.ts`) — `<img src>` and the forwarder's `fetch keepalive` call don't go through `fetchWithBase`, so they need the prefix explicitly. Next.js rewrites in `next.config.ts` are kept intact for dev; in prod the browser just never matches them. **Reversible**: when Vercel ships the trust-store fix, revert this change to restore same-origin proxy. Anchor symptom for "is the Vercel proxy broken again?": every `/api/*` POST to `https://whoeverwants.com/api/*` returns 502 with body `An error occurred with this application. ROUTER_EXTERNAL_TARGET_HANDSHAKE_ERROR <region>::<request-id>`, while the same call to `https://api.whoeverwants.com/api/*` directly returns 200/201 from the same network. Don't reintroduce relative `/api/*` URLs in code paths the browser uses in prod (inline `fetch('/api/...')`, `<img src="/api/...">`) without first checking whether the Vercel-edge regression has actually been fixed. Diagnostic: compare cert intermediate (`echo | openssl s_client -connect api.whoeverwants.com:443 | openssl x509 -noout -issuer`) against the canary's working cert — anything not E7 or older is a regression candidate. **The `/api/git-info` route is the exception**: it's a Next.js route handler (`app/api/git-info/route.ts`) served by the same Vercel deployment, no external proxy — keep that fetch relative.
- **`/api/(.*)` MUST NOT carry a blanket `Cache-Control: public, max-age=N`.** Most API endpoints are identity-dependent — `/api/groups/by-route-id/{id}`, `/api/groups/mine`, `/api/users/me/*` all partition by the `X-Browser-Id` request header. Without `Vary: X-Browser-Id`, any cache (Vercel edge, iOS WKWebView's HTTP cache, intermediate proxies) keys on URL alone and serves one user's response to every other user. Symptom found in `claude/fix-ios-poll-visibility-nmSFA`: iOS TestFlight user creates a poll in a previously-empty group, navigates home → group, sees the empty-group placeholder for up to 2 hours because the WebView cached the pre-creation `[]` response from `/api/groups/by-route-id/~6`. The home page was correct (POST responses aren't normally cached), the group page wasn't (GET on a URL that returned `[]` was cached). Fixed by removing the `/api/(.*)` headers block in `next.config.ts` — the upstream FastAPI sets `Cache-Control: public, max-age=31536000, immutable` only on image bytes endpoints (groups + users image GETs); everything else passes through with no Cache-Control header, which means no caching at the CDN/WebView layer. If a future API endpoint genuinely benefits from caching, set the header on the FastAPI response directly with appropriate `Vary` — don't reintroduce the blanket Next.js rule. **`Vary: X-Browser-Id` alone isn't a clean solution either**: cache partitions per browser_id explode to millions of entries on the CDN and provide no actual reuse. Identity-dependent endpoints want `no-store` semantics, which is what they get with no header set.
- **Deployment Protection / Vercel SSO is OFF (`ssoProtection: null`).** Because `productionBranch=production` and `latest.whoeverwants.com` tracks `main`, Vercel classifies the `latest` alias as a preview deployment — so any SSO setting that protects previews (including the default `prod_deployment_urls_and_all_previews`) gates `latest` with an "Authenticating..." splash on first load. We accept that PR preview URLs (`<branch>-<hash>.vercel.app`) are publicly reachable as the cost of keeping `latest` open. To toggle: `curl -X PATCH -H "Authorization: Bearer $VERCEL_API_TOKEN" -H "Content-Type: application/json" https://api.vercel.com/v9/projects/prj_07PAXGI2wG74cGRKREB0BiIDUWSn -d '{"ssoProtection": null}'` (off) / `-d '{"ssoProtection": {"deploymentType": "prod_deployment_urls_and_all_previews"}}'` (on). No Vercel setting splits PR previews from the `latest` alias — they're both "previews" to Vercel.

**Latest tier — canary backend** (Python API on `latest` droplet, auto-deployed on push to `main`):
- Push to `main` fires the GitHub webhook → `hooks.api.latest.whoeverwants.com` → `scripts/dev-webhook.py` (reads `/etc/droplet-label=latest`) → `git pull origin main` → `docker compose up -d --build` → apply pending migrations → `/health` verify.
- Deploy logs: `bash scripts/remote-latest.sh "tail -50 /var/log/dev-webhook.log" /root`
- Manual rebuild: `bash scripts/remote-latest.sh "docker compose up -d --build" /root/whoeverwants`
- API logs: `bash scripts/remote-latest.sh "docker compose logs --tail 100" /root/whoeverwants`

**Production backend** (Python API on `whoeverwants` droplet, auto-deployed only on GitHub Release):
- Publishing a non-draft / non-prerelease GitHub Release fires the webhook → `hooks.api.whoeverwants.com` → `scripts/dev-webhook.py` (reads `/etc/droplet-label=""`) → `git fetch --tags && git checkout tags/<release-tag>` → `docker compose up -d --build` → apply pending migrations → `/health` verify. Push events to `main` are explicitly ignored on this tier.
- Deploy logs: `bash scripts/remote.sh "tail -50 /var/log/dev-webhook.log" /root`
- Manual rebuild: `bash scripts/remote.sh "docker compose up -d --build" /root/whoeverwants`
- API logs: `bash scripts/remote.sh "docker compose logs --tail 100" /root/whoeverwants`
- **To ship**: cut a GitHub Release. The release's tag must exist on `main` (or any branch — but the convention is to publish from a `main` commit that's already running cleanly on `latest.whoeverwants.com`).
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
- Each droplet has its own clone of this repo at `/root/whoeverwants`. Never transfer files manually — commit here, pull there. Different deploy triggers per tier (push to main vs release published).
- The remote execution API has a configurable timeout (default 120s, max via 3rd arg)
- The API returns stdout, stderr, and exit code for every command

### Latest-Tier Rollout — Status

The two-tier deploy is wired end-to-end. Status of each piece:

| Step | What | Status |
|------|------|--------|
| 1 | DNS for `api.latest.whoeverwants.com`, `hooks.api.latest.whoeverwants.com`, `latest.whoeverwants.com` | ✅ done (Route 53) |
| 2 | Vercel project: `productionBranch=production`, `latest.whoeverwants.com` domain with `gitBranch=main` | ✅ done (via undocumented `PATCH /v9/projects/<id>/branch` + `POST /v10/projects/<id>/domains`) |
| 3 | `production` branch on origin (created from current main HEAD) | ✅ done |
| 4 | `.github/workflows/release-to-production.yml` (on `release: published` → force-push tag commit to `production`) | ✅ done |
| 5a | GitHub webhook for the latest droplet (`hooks.api.latest.whoeverwants.com`, push + release events) | ✅ done (user added in GitHub UI) |
| 5b | Existing prod-droplet GitHub webhook (`hooks.api.whoeverwants.com`) — confirm subscribed to **Releases** in addition to **Pushes** | ⚠️ manual check — the PAT lacks `admin:repo_hook`, so verify in the GitHub UI |
| 6 | Prod droplet cutover (restart `dev-webhook` to pick up label-aware code) | ⚠️ manual — after PR merges; see below |

**6. Prod droplet cutover** — the prod droplet's `dev-webhook.service` is still running the OLD code (pre-this-PR) which deploys on every push to main. After this branch merges:
1. The prod webhook will deploy main one last time using its old behavior — this lands the new `dev-webhook.py` (label-aware) on disk at `/root/whoeverwants/scripts/dev-webhook.py`, but the systemd service is still running the old code in memory.
2. From the dev env: `bash scripts/remote.sh "touch /etc/droplet-label && chmod 644 /etc/droplet-label && systemctl restart dev-webhook"` — creates the empty label marker (prod tier = empty string) and restarts the service. From here on, push to main is ignored on prod; only `release: published` events deploy.

### How a release will flow once the cutover is complete

1. Tag a commit on `main` (or wherever) and publish a non-draft / non-prerelease GitHub Release.
2. The `release-to-production.yml` workflow fires → force-pushes the tag's commit to the `production` branch.
3. Vercel sees a push to `production` → builds a production deployment → moves the `whoeverwants.com` alias to it (since `productionBranch=production`, that's the prod alias target).
4. In parallel, the prod droplet's `dev-webhook` receives the `release.published` event from GitHub → `git fetch --tags && git checkout tags/<tag>` → `docker compose up -d --build` → applies pending migrations → `/health` check.
5. The `latest` droplet ignores the release event (its label is `latest`). It only redeploys on push to `main`; this push, the next push, every push.

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
- **Mac webhook redeploy is split across two surfaces: live-mounted script vs baked-into-image.** `dev-server-manager.sh` is bind-mounted into both cmd-api + webhook via `./scripts:/opt/scripts:ro`, so `bash scripts/mac-deploy.sh scripts/mac-mini/dev-server-manager.sh /Users/sccarey/devbox/scripts/dev-server-manager.sh 755` takes effect immediately — no rebuild. `webhook.py` and `devserver-entrypoint.sh`, however, are `COPY`'d at image build time (`Dockerfile.webhook`, `Dockerfile.devserver`); changing them requires deploying to `~/devbox/webhook/webhook.py` / `~/devbox/devserver/devserver-entrypoint.sh` AND rebuilding the image. **Cutover ordering matters when the manager's CLI signature changes** (e.g. per-author → per-branch dropped the `<email>` arg): in the window between deploying the new manager script and rebuilding the webhook image, the still-running webhook calls `upsert <email> <branch>` against a manager that now expects `upsert <branch>` — the first positional silently becomes the "branch", spinning up a wrong dev server. Safe sequence: (1) `destroy-all` first (works against the old subcommand), (2) deploy ALL three files (manager + webhook.py + entrypoint), (3) rebuild + recreate the webhook image from a detached sidecar in the same step.
- **One-shot rebuild + recreate of a single compose service from a detached sidecar:** the documented pattern for "recreate cmd-api kills the in-flight request" generalizes to webhook too — anytime you need to rebuild + recreate from inside the VM, launch a sibling. The exact recipe (`<service>` = webhook or any other compose service):
  ```
  bash scripts/remote-mac.sh "docker run -d --rm \
    -v /Users:/Users -v /var/run/docker.sock:/var/run/docker.sock \
    -w /Users/sccarey/devbox --name rebuild-sidecar-<n> docker:cli \
    sh -c 'docker compose build <service> && docker compose up -d --force-recreate <service> && echo SIDECAR_OK'" / 60
  bash scripts/remote-mac.sh "until ! docker inspect rebuild-sidecar-<n> >/dev/null 2>&1; do sleep 3; done; echo DONE"
  ```
  The sidecar name must be unique per rebuild attempt (e.g. `webhook-rebuild-sidecar`, `-2`, ...) — `docker run --name` rejects duplicates even with `--rm`. Don't skip the `-w /Users/sccarey/devbox` working dir; compose interprets `./` paths relative to the CLI's CWD, and the daemon then needs the path to be Mac-visible via the `/Users` bind mount (per the existing "Bind paths in docker-compose.yml are interpreted by the daemon" pitfall).
- **`sed -E 's/[^a-z0-9-]+/-/g'` does NOT collapse runs of already-allowed `-` characters.** A naive "simplification" of the 3-step slugify (replace non-allowed → collapse hyphen runs → trim) into a single `s/[^a-z0-9-]+/-/g; s/^-+|-+$//g` looks equivalent but isn't: `weird///slash---name` collapses the slashes to one `-` BUT leaves the literal `---` run untouched, producing `weird-slash---name` instead of `weird-slash-name`. The correct one-invocation form is three substitutions on one `sed -E` call: `'s/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+|-+$//g'`. The second pass is load-bearing because `-` is in the allowed set of the first character class. Same trap applies to any other "allowed-chars-include-the-collapse-target" slugify.

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
- **Group URLs split path + query.** Canonical form is `/g/<groupShortId>?p=<pollShortId>`: path is the group root's short_id (or root question id when no short_id), query names the poll to auto-expand and scroll to. Empty placeholder is bare `/g/`. Sub-routes `/g/<groupShortId>/info` and `/g/<groupShortId>/edit-title`. Legacy `/p/<id>` URLs (and `/p/<id>/info`, `/p/<id>/edit-title`) live as redirect stubs that resolve the ambiguous id (poll short_id / poll uuid / question uuid) once and `router.replace` into the canonical `/g/...` form — see `app/p/[shortId]/_legacyRedirect.tsx`. Three URL-builder helpers in `lib/groupUtils.ts`: `getGroupHref(group)` for the home list (bare `/g/<root>` — no auto-expand), `getGroupHrefForPoll(poll)` for "navigate to this poll's group with this poll expanded" (used by FollowUpHeader, GroupCardItem copy-link, /g/ ?id= handler, and the legacy /p/ redirects), and `resolveGroupRootRouteId(poll)` for just the group-root part. The `POLL_QUERY_PARAM` constant in `lib/groupUtils.ts` names the `?p` key.
- **Auto-expand is encoded by the URL itself, not heuristics.** `?p=<id>` present → expand that poll; absent → no expand, page scrolls to bottom (the draft-form area). The old `?group=1` flag and the `suppressExpand` "user has responded to every question" heuristic are gone — the URL is the source of truth. URL sync on expand swaps `?p=` via shallow `history.replaceState`, never touching the path; sharing the URL reopens the same expanded card.
- **Home → group lands on the awaiting card (or bottom if all done).** `getGroupHref(group)` returns bare `/g/<root>` and `GroupList`'s tap handler calls `slideToGroup({ href, groupId })`. The group page's initial-scroll layout effect picks the anchor (oldest awaiting question, or bottom for groups with no awaiting work). Tapping a CARD slides to its detail page at `/g/<root>/p/<pollShort>` via `slideToPollDetail` — cards no longer expand in place. `isPollOpen(poll, now?)` (not closed AND deadline-not-passed) remains the canonical helper for that rule — don't re-inline the `is_closed`/`response_deadline` math.
- **Floating bubble bar auto-follows-up** when on a group page via `document.body.getAttribute('data-group-latest-question-id')` — the group page sets this attribute on mount. The home page does NOT render the bubble bar; it has the single new group button instead, which navigates to `/g/` (the empty placeholder). `/g/` shows the bubble bar (since `isGroupRootView` matches it); the user picks a category from there. If the user dismisses the modal without submitting, the empty placeholder remains visible with the bubble bar; tapping back returns to home. On submit from the empty placeholder, the new question has no `follow_up_to` so it becomes its own group root.
- **Shared utilities**: `lib/questionListUtils.ts` (relativeTime, getCategoryIcon, badges), `lib/votedQuestionsStorage.ts` (loadVotedQuestions), `lib/timeUtils.ts:formatCreationTimestamp` (absolute "@ h:mm AM M/D/YY" timestamp used in the tooltip + the expanded card). QuestionList keeps its own full-featured `getResultBadge` with user-specific participation messages.
- **Group list row layout** (`components/GroupListItem.tsx`): NO hairline dividers between rows; the visual structure is avatar-driven, not chrome-driven. Each row is a flex with `[selection checkbox?] [avatar] [text block (flex-1)] [right rail]` (drafts and empty groups pass `hideRespondents={true}`, skipping both the avatar and the right rail). The right rail is a `flex flex-col items-end justify-start self-stretch -ml-[4.224px] gap-0.5` containing two stacked elements that are ALWAYS in fixed positions: the age stamp at top, the countdown / dot indicator below. Either element can be absent independently — `createdAt` null hides the age, `unvotedDeadlineKind` undefined hides the indicator — but their slot positions are stable so adjacent rows align vertically. Row vertical padding is `py-[9.6px]` (20% reduction from a previous `py-3` baseline; kept as an arbitrary value rather than `py-2.5` to honor the exact spec). Three render states for the indicator slot, driven by `Group.unvotedDeadlineKind`:
  - `'response'` → green compact `<SimpleCountdown compact blankOnExpire>` (voting cutoff ticking).
  - `'prephase'` → blue compact `<SimpleCountdown compact blankOnExpire>` (suggestion / availability timer ticking).
  - `'response-pending'` → solid green dot. Viewer has unvoted polls but NO deadline is set anywhere on the poll. Without this state the right edge would render blank, breaking the "unvoted → always something" rule. (Migration 118 retired the `'prephase-pending'` blue dot — prephase timers now always have a concrete deadline at creation, so the prephase branch always renders the ticking countdown.)
  - `undefined` → empty slot.
  The dot is table-driven via a module-level `PENDING_DOT: Partial<Record<DeadlineKind, {label, bg}>>` lookup at the top of `GroupListItem.tsx`; the rendered span pulls its aria-label + Tailwind bg class from the table. Adding a future "*-pending" variant = one row in the table plus an entry in the union. Dot dimensions: `w-4 h-4` (16px) with `mr-1` (4px right offset from the rail's right edge) and `mt-0.5` for vertical breathing room from the age stamp above. Within one poll an active prephase deadline always beats `response_deadline` (we don't surface a voting cutoff while suggestions are still open); across polls the soonest deadline wins regardless of kind. `response-pending` only fires when no concrete deadline won. `blankOnExpire` clears countdown text to empty on cross-zero so no stray "Expired" word flashes before the parent's `isOpen` filter unmounts the row. `compact` mode formats via `formatCompactCountdown(diffMs)` in `lib/timeUtils.ts` — promotes to the next larger unit at the unit boundary itself (0s–59s as seconds, 1m–59m as minutes, 1h–23h as hours, 1d–6d as days, 1w–3w as weeks, 1mo–11mo as months, then `y`). Differs from `compactDurationSince` which uses a ≥ 2 threshold to preserve more precision in "X ago"-style labels; countdowns prefer the larger unit so the on-screen glyph matches the duration the creator typed (e.g. "Suggestions cutoff in 1h" reads as `1h`, not `60m`). Font size on the countdown wrapper is `text-[15.84px]` with `numberClass="font-bold tracking-tighter"` (overrides `SimpleCountdown`'s default `font-mono font-semibold`); fixed-width digits aren't needed for the single-unit `Ns`/`Nm`/etc. format. Gap tuning: the rail's `-ml-[4.224px]` collapses the flex `gap-3` (12px) → 7.776px effective text-block↔rail gap, mirroring the convention used elsewhere in the row; the avatar↔text gap uses `-ml-[3px]` on the text block (→ 9px effective). Outer `mr-1.5` (right-only) and inner `pl-[8.064px]` keep the left edge tight against the viewport safe-area padding while preserving asymmetric right-side breathing room; both gated on `!draftMode` so draft poll cards keep their symmetric `mx-1.5` + `pl-2` chrome for the dashed border. (Historical: an earlier layout placed the countdown column LEFT of the avatar as `w-7` reserved slot and put the age stamp inline at the right end of the title row; both moved into the unified right rail when the countdown placement was flipped to the right edge — keeping the prior left-column code paths alongside would have meant two competing visual sources of "soonest deadline" + redundant horizontal real estate.)
- **Text block structure** (same component): row 1 is `flex items-baseline` with the title (`truncate flex-1`) + optional draft pill. The relative-time stamp lives in the right rail (NOT in this row) and visually-aligns with the title via a `mt-[5px]` offset on the age div — pure line-box alignment via `items-baseline` is unavailable across the flex-row boundary, so empirical pixel offset stabilizes the title↔age baselines. Below the title row, an empty-group status row renders only when `createdAt` is null. The latest-poll body is a `text-sm leading-tight` div with `maxHeight: 2.55em` + `overflow: hidden` to cap at 2 lines — `-webkit-line-clamp` is NOT used (its `-webkit-box` display breaks downstream float interactions, and the maxHeight approach is robust to that history even though no float consumers remain). The text block intentionally has NO `pr-*` right buffer — the right rail next to it owns the right-edge breathing room, so adding right padding would double-budget the gap.
- **Long-press a group on home → bulk-forget selection mode.** `components/GroupList.tsx` arms a 500ms `setTimeout` from `onTouchStart` (manual setTimeout, NOT `useLongPress` — the existing handlers need touch events for scroll detection + synthetic-click suppression, and `useLongPress` is pointer-event-based). Firing the timer enters selection mode with the long-pressed group pre-selected; haptic via `navigator.vibrate(50)`. While in selection mode every `GroupListItem` renders a circular checkbox (left of `RespondentCircles`); taps toggle selection instead of navigating. Cancel (X) + red trashcan are rendered via `<HeaderPortal>` (target `#header-portal` in `app/layout.tsx`, outside `ResponsiveScaling`) — same target the settings-page back arrow uses. The X button visually replaces the home page's gear icon by sitting at the same coords with `z-50`; in addition GroupList dispatches `HOME_SELECTION_MODE_CHANGE_EVENT` (in `lib/eventChannels.ts`, typed detail `{active: boolean}`) on selectionMode flips and on unmount-via-cleanup so `app/template.tsx` can conditionally drop the gear's JSX — the bare `z-50` overlap is unreliable on devices where the responsive-scaling transform displaces the gear (template sits inside `.responsive-scaling-container`, the portalled X is outside). Trashcan opens a `<ConfirmationModal>`; on confirm `forgetGroup(group)` (in `lib/forgetQuestion.ts`) loops the group's questions through `forgetQuestion` then fires `apiLeaveGroup(groupId ?? rootPollId)` to drop server-side membership. Selection mode does NOT auto-exit when `selectedGroupIds` empties — only the cancel button or Escape exits (matches the user spec: "Unchecking all items should not cancel edit mode"). Pitfalls when extending: (a) `onGroupsForgotten` carries every poll-id in every forgotten group, NOT just root ids — a group is multiple polls sharing `group_id`, so filtering the parent's `polls` by root id alone leaves follow-ups behind and `buildGroups` rebuilds a ghost group; (b) the home page applies an optimistic `setPolls(prev => prev.filter(...))` instead of awaiting `getMyGroups()` — `forgetGroup` already invalidates the per-question + accessible-polls caches via `invalidateQuestion`, so the next natural refresh re-syncs without an extra round-trip; (c) don't add a `portalReady` mount-flag pattern around `<HeaderPortal>` — the portal already encapsulates that via its own `mounted` state.
- **Backend**: `voter_names` field on accessible questions response — extracted from already-fetched votes when possible, DB query only for remaining open questions.
- **Group page uses document scroll with a fixed header.** The header is `position: fixed; top: 0` and the content below reserves a matching `padding-top` via a `ResizeObserver` that measures the header. Nothing flex-col wraps the content — the body is the scroller. When adding new fixed page chrome, put it in the template or portal it out; don't introduce inner scroll containers.
- **`useGroup(groupId)` is the canonical group loader** (`lib/useGroup.ts`). Returns `{group, loading, error}`. Initializes synchronously from the in-memory cache via `buildGroupSyncFromCache` (from `lib/groupUtils.ts`) and only falls through to the async fetch path on cache miss — so cache hits don't trigger redundant `apiGetGroupByRouteId` / `getAccessiblePolls` round-trips. Also writes `data-page-ready` on `<html>` so view transitions capture a fully-rendered snapshot. Use this hook for any new page that needs the group for a route id; don't re-implement the cache-first + fallback pattern inline.
- **Group sub-routes:** `/g/<id>/info` (participant list + total count, with Back/Edit buttons) and `/g/<id>/edit-title` (input to set/clear the `group_title` override). These render their own fixed headers and read `params.groupShortId`. `isGroupRootView(pathname)` in `lib/questionId.ts` distinguishes the root view (`/g` or `/g/<id>`, gets the group-like layout treatment + bottom padding) from sub-routes (plain layout) via the regex `^\/t(\/[^/]+)?\/?$`. Update that helper when adding more group sub-routes. The legacy `/p/<id>/info` and `/p/<id>/edit-title` routes are thin redirect stubs (`LegacyRedirectPage` from `app/p/[shortId]/_legacyRedirect.tsx`).
- **Empty placeholder route:** `/g/` (no groupShortId) is the empty-group route surfaced by tapping the home page's new group button. Implemented as `app/g/page.tsx` with two roles: with `?id=<question-uuid>` (legacy deep-link form) it resolves the question → its poll → its group root and `router.replace`s to `/g/<root>?p=<pollShort>` via `getGroupHrefForPoll`; with no params it renders `EmptyPlaceholder` (shared `GroupHeader` with `title="New Group"`, instructional message, `<div id="draft-poll-portal" />` for `CreateQuestionContent`). The placeholder matches `isGroupRootView`, so the category bubble bar is portaled into it — the user picks a specific category bubble from there to open the new-question modal. The group "materializes" only when the user actually creates a question.
  - **Pitfall: `text-center` on the wrapper around `DRAFT_POLL_PORTAL_ID` cascades into the portaled bubble bar.** The placeholder copy ("Create a question and then share the link!") is centered, but the portal target div lives in the same wrapper, and CSS `text-align` inherits — bubble buttons get centered text alignment too. Scope `text-center` to the placeholder `<p>` itself, not the enclosing div. Same caution applies any time a portal target sits next to deliberately-centered placeholder content.
- **`GroupPageInner` is the resolution wrapper** at the bottom of `app/g/[groupShortId]/page.tsx`. The path id is unambiguously a poll short_id / poll uuid (the group root) — no question-uuid cascade. Synchronously resolves to a Poll from `questionCache` via `useMemo([groupShortId])`; falls back to async `apiGetPoll{ById,ByShortId}` (404 → `setError`) on cache miss. Reads `?p=<pollShortId>` via `useSearchParams` and resolves it to `initialExpandedQuestionId` (the poll's first question id) via the same cache lookup. Legacy `/p/<id>` URLs with arbitrary ids (poll short_id, poll uuid, OR question uuid) resolve via `app/p/[shortId]/_legacyRedirect.tsx` → 302 to canonical `/g/<root>?p=<pollShort>` before this component mounts. Don't reintroduce question-uuid resolution into `GroupPageInner` — handle it in the redirect stub if a new legacy form needs supporting.
- **Helpers for cache-walk + URL-build patterns:** `lib/groupUtils.ts: resolveGroupRootRouteId(poll)` walks `poll.follow_up_to` via `getCachedAccessiblePolls()` to find the group root and returns its route id (short-circuits when `poll.follow_up_to` is null). `lib/groupUtils.ts: getGroupHrefForPoll(poll)` returns `/g/<root>?p=<pollShort>` — the canonical "navigate to this poll's group with this poll expanded" URL. `lib/questionCache.ts: getCachedPollForShortId(id)` resolves an ambiguous id (poll uuid / poll short_id / question uuid) to a cached Poll. Use these whenever you need either pattern — don't re-inline the `getCachedAccessiblePolls + buildPollMap + findGroupRootRouteId` triplet or hand-roll the `?p=` URL.
- **(Historical) `addAccessibleQuestionId` is REMOVED.** It used to persist question ids to a localStorage accessible-question list; that list (and the function) are gone now that `group_members` is the single source of truth. There is no longer any "register access by question id" step on visit/create — membership is written server-side. (The old pitfall was that passing a poll uuid instead of a question id silently corrupted the list; moot now.)
- **Shared `GroupHeader` component** lives at `components/GroupHeader.tsx`. Props: `headerRef`, optional `title`, optional `participantNames` + `anonymousCount` (renders `RespondentCircles` when provided), optional `subtitle`, optional `onTitleClick` (makes the participant-graphic + title block ONE button covering the full middle hitbox when provided AND `title` is set — earlier this wrapped only the title text; the button is gated on `onTitleClick && titleBlock` so a caller can supply `onTitleClick` without a title and the click just no-ops via the div branch; ALSO renders a small right-chevron inline after the title text as a visual affordance, gated on the same prop — `text-gray-400 dark:text-gray-500`, `w-4 h-4`, `shrink-0` so it stays visible when the title truncates; the existing `min-w-0 flex-1` middle div takes on `flex items-center gap-1` and the h1 carries an explicit `min-w-0` so `truncate` still works inside the flex parent — don't reintroduce a separate flex wrapper div around the h1+svg pair, the existing parent does the job; chevron path is `M9 5l7 7-7 7`, inlined per codebase convention — same path appears in DaysSelector, CompactRankedChoiceResults, create-poll/page.tsx, and GroupCardItem (the per-poll-row nav glyph in the group view)), optional `onBack` (defaults to navigating to `/`), optional `backIconVariant: 'arrow' | 'menu'` (default `'arrow'` — chevron-left glyph; `'menu'` swaps in a hamburger-style three-line glyph with the third line shorter; used on the group root, poll detail page + its loading frame, and the empty `/g/` placeholder. Behavior is identical regardless of variant — the button still calls `handleBack`; only the icon glyph differs. Both variants share the bare `w-10 h-10 flex items-center justify-center` slot wrapper — no background, no border, no bubble chrome. An earlier iteration wrapped the menu variant in a `rounded-full bg-white ... border` bubble that mirrored the floating-bubble buttons used on /info and /edit-title; that was retired so GroupHeader stays visually distinct from the floating-bubble pattern), optional `rightSlot` (renders an action node on the right; when provided, the middle's right padding tightens from `pr-4` to `pr-2`). The bar is split into three adjacent full-height hitboxes (back / middle / rightSlot) with no untappable padding strip — each child folds its surrounding gap into its own padding, and back + middle all use `self-stretch` so their tap targets span the full bar height. Vertical centering is preserved by `items-center` on the row (NOT `items-stretch`) so any caller whose `rightSlot` has an explicit `h-10` keeps its centering for free. The title is always left-justified within its `flex-1` container. **Omitting `title` renders the header bar with just back + rightSlot** — the `flex-1` spacer div is still present (empty) so rightSlot stays pinned to the right. Used by `GroupContent` (real-group props) and `EmptyPlaceholder` in `app/g/page.tsx` (just `title`). The `/info` and `/edit-title` sub-routes do NOT use `GroupHeader` — they ship a transparent-top-bar layout with two floating opaque-bubble buttons each (back arrow on the left, action on the right: Edit on /info, Save on /edit-title) portaled via `<HeaderPortal>` so `position: fixed` is viewport-relative on desktop (the `.responsive-scaling-container` transform would otherwise trap the buttons in the scaled container — see the "Viewport-relative position: fixed" pitfall in the Document Scroll Architecture section). On /info the avatar is reduced to `w-[8.4rem]` and the share button is anchored absolutely to its right edge (`left-full top-1/2 -translate-y-1/2`) so the avatar stays visually centered. **Floating-bubble-button site count is now 2** (/info + /edit-title), 4 button instances total sharing the same `fixed left-3/right-3 z-30 ... rounded-full bg-white dark:bg-gray-800 border ...` class stack. **If you add a third site, extract `<FloatingBubbleButton side="left|right" />`** rather than copying the class stack a third time. Don't re-implement the fixed `top:0 + padding-top:env(safe-area-inset-top) + headerRef + back button` markup in another route — extend `GroupHeader` or import it. **Pitfall when sizing an icon-style child of a flex row that uses `flex items-center justify-center` on the button**: an inner explicit-size wrapper (`<span className="w-10 h-10 flex items-center justify-center">`) around the SVG is load-bearing for both the visual icon size AND the parent button's intended width. Without the `w-10` wrapper, the button content area collapses to the SVG's intrinsic width (~24px) + padding, shrinking the back / share hitbox AND shifting every flex sibling left/right by the lost width. The wrapper reserves the original 40px slot so absorbing surrounding gaps into the button's padding doesn't relocate any pixel. Only one call site uses this pattern today (the GroupHeader back button); when adding a future `rightSlot` text-only button, mirror the back button's `self-stretch py-2 px-2` + inner `<span className="w-10 h-10 ...">` structure so the text gets the same 8px breathing room from the viewport's right edge.
- **Don't `autoFocus` text inputs on pages with `position: fixed` chrome.** On iOS the focus event re-expands the Safari URL bar (and on Capacitor iOS opens the soft keyboard); both shift the visual viewport in ways that cover or displace any `position: fixed; top: 0` header until the user manually scrolls and the URL bar collapses again. The symptom looks like "the top bar isn't floating" — but the bar is fine; the URL bar is sitting on top of it. Even with the `<HeaderPortal>` floating-bubble pattern (which is portaled outside `.responsive-scaling-container` and is otherwise URL-bar-resilient), autoFocus still pops the keyboard on first paint, which most users don't expect for a "navigate to edit a field" flow. Let the user tap the field deliberately.
- **Deliberately-opened modal inputs are the EXCEPTION — and raising the iOS soft keyboard for them needs a keyboard primer.** When the user taps something specifically to type (e.g. the Yes/No bubble opens the create-poll sheet whose title IS the question prompt), auto-focusing the input is expected, not surprising. Two gotchas make naive autofocus fail there, both seen in `app/create-poll/page.tsx`: (1) **`<ModalPortal>` defers its children to a post-mount commit** — it returns `null` until its own `useEffect` flips a `mounted` flag, so the input mounts on a *later* commit than the modal-open. A `focus()` in a `useEffect`/rAF fired right after open finds `titleInputRef.current === null` and never re-runs (the open-state deps don't change again). Fix: focus from a **callback ref** (`ref={setTitleInputRef}`) gated by a flag set at open time — it fires exactly when the node attaches, whenever that commit lands. (2) **iOS WebKit only raises the soft keyboard when `focus()` runs synchronously inside the tap's user-activation window.** Because the input mounts asynchronously, the callback-ref focus lands the caret but the keyboard stays down. Fix: a **keyboard primer** — synchronously create + `focus()` a throwaway off-screen `<input>` (appended to `document.body`, `position:fixed;width:1px;height:1px;opacity:0;font-size:16px` to dodge focus-zoom) *during the tap handler*, claiming the keyboard; when the real input mounts the callback ref focuses it and removes the primer, and iOS keeps the keyboard up across the transfer. `font-size:16px` is load-bearing (avoids iOS zoom-on-focus); `opacity:0`+1px keeps it invisible and still focusable. Verified on a real iPhone — headless Chromium can confirm the caret/transfer/cleanup mechanics but NOT the keyboard, so on-device testing is mandatory for this class of change. Both helpers (`primeKeyboard`, `removeKeyboardPrimer`, `setTitleInputRef`) are scoped to yes/no (the only category whose title is user-typed) and consume their flag once so StrictMode's double-invoke can't double-fire. Don't reach for the `autoFocus` attribute here — it has the same async-mount + activation problems and gives no control over the primer.
- **`RespondentCircles.sizeClassName` (default `w-16`) overrides the avatar's outer width.** The SVG inside scales to fill the wrapper, so passing `w-28` produces a larger circle-packing layout with no layout math changes. The info page uses `w-28` for the Signal-style hero avatar; the small inline uses (header strip, group list rows) keep the default. Tailwind JIT picks the class up from the literal string at the call site; don't construct it dynamically (e.g. `w-${n}`) or the class gets purged.
- **Group page back button always navigates to `/`**, regardless of in-app history. Earlier the button used `hasAppHistory() ? navigateBackWithTransition() : navigateWithTransition('/')`, but after creating a question on `/g/`, the prior history entry was the now-empty placeholder — back popped the user back to it instead of home. Hard-coding `'/'` is the cleanest fix and matches the user's mental model ("back from a group → main list"). The `/info` sub-route still uses the conditional-back pattern because its natural back target is the group root. **`/edit-title`'s back button always navigates to `/info`** (`slideToGroupInfo({ groupId, direction: 'back' })`, no `useHistoryBack`) — same rule, different target. The earlier conditional-back form here meant /edit-title could pop back to /info OR the group root depending on how the user reached it (e.g. direct URL vs in-app nav); hard-coding /info as the parent keeps the destination predictable. Apply this pattern to any future sub-route whose conceptual parent is a single specific page rather than "whatever was behind us".
- **`useEffect(..., [])` + conditional early return = ref never attaches.** When a page renders a loading placeholder on first paint and then swaps to the real content after an async load, an effect with empty deps runs once on the first render — when the real refs don't exist yet — and never re-fires, so observers like `ResizeObserver` silently fail to attach. Fix: gate the real content behind an inner component that only mounts when data is ready (`if (loading) return <Loading/>; return <Inner {...}/>`). Effects inside `Inner` then run against refs that definitely exist. Used in `app/g/[groupShortId]/info/page.tsx` (Info gated behind GroupInfoView's loading branch); the same outer-component pattern is used in `.../edit-title/page.tsx` (Editor behind GroupEditTitleView) for blob-URL lifecycle effects, even though edit-title no longer uses ResizeObserver since the floating-bubble refactor.
- **`useMeasuredHeight(deps?, initialValue?)` (`lib/useMeasuredHeight.ts`) is the canonical hook for the fixed-header padding-top compensation pattern.** Returns `[ref, height]`. Pass `[loaded]` as deps when the element is gated behind a loading early return inside the same component (e.g. `GroupContent` passes `[group]`); use the default `[]` when the element mounts once with the component (e.g. `EmptyPlaceholder` — gates the placeholder at the parent level so the inner component only mounts post-load). `/info` and `/edit-title` don't use this hook at all — they use floating `<HeaderPortal>` buttons over pure-CSS `paddingTop: calc(env(safe-area-inset-top, 0px) + 1.05rem)` instead, which sidesteps the "first-paint at 0, second-paint at measured" iOS flicker entirely. Don't re-inline `useLayoutEffect + ResizeObserver + offsetHeight` in new group chrome. **The `initialValue` second arg (default 0) seeds the height state for the first render — pass an estimate of the eventual height for any dependent layout that's user-visible.** On iOS Firefox (and probably iOS Safari in some conditions), `useLayoutEffect`'s `setHeight(actual)` does NOT batch with the initial commit before the browser paints — the user sees one frame with the polls' `paddingTop` at 0 (the initial state) and the next frame at the measured value. Even though `useLayoutEffect` is supposed to run before paint, a `useEffect` sample at T=0 (post-paint) shows `computedPaddingTop: "0px"` for one frame on every refresh on iOS Firefox. Seeding with the eventual value (80 for the canonical group header on iOS browser) makes the first paint already correct; ResizeObserver corrects any drift on the next tick. The estimate doesn't have to be exact — on iOS PWA the actual height is bigger (notch), so there's still a small adjustment, but the magnitude is the notch height (~47px), not the full header height (~80px). The `GroupContent` callsite is the only one passing a non-default initialValue today; reach for it whenever you're chaining `useMeasuredHeight` into a layout that paints early.
- **Bottom-pin needs a bounded window + user-interaction gate to be safe.** A naive bottom-pin (continuously re-applying `scrollTo(0, scrollHeight - innerHeight)` on every layout tick — `useLayoutEffect` after each render + `ResizeObserver` on every group card + the document) oscillates wildly during the first ~50ms of a page load, because the polls list resizes constantly (placeholders → real cards, async results/votes). The pin reapplies with each new max, scrollY swings by hundreds of pixels, and on iOS this transiently spikes `visualViewport.offsetTop` to the URL-bar-expanded value (~200px), which (via `position: fixed`) reports the fixed group header's `getBoundingClientRect().top` as **-200** for one frame. Symptom: "top bar scrolled off the top of the screen just a little" + "polls visibly slide up/down to a stable position." Earlier we retired the bottom-pin entirely in favor of a card-anchor pin (track the oldest awaiting card's `offsetTop` and re-align), but the card-anchor approach produced its own visible jump on load when the chosen anchor and the bubble-bar end of the page differed. The current `GroupContent.applyScrollAdjustmentRef` re-introduces the bottom-pin as the sole default, bounded by `BOTTOM_PIN_DURATION_MS = 800` (set as a `Date.now() > deadline` ref check) AND gated on `userInteractedRef.current` (flipped on the first wheel/touchstart/keydown event). The bounded window caps the iOS feedback loop; the interaction gate avoids fighting the browser's silent scrollY clamp when the doc shrinks (the clamp fires a `scroll` event indistinguishable from a user gesture, but no wheel/touch/keydown happens). If you ever drop one of these safeguards, expect the iOS oscillation back. Don't reach for `scrollHeight`-stability gating (e.g. a 200ms idle period after the last ResizeObserver fire) — equivalent in spirit but harder to reason about than a flat duration window.
- **Diagnostic harness for iOS layout glitches** that don't reproduce in headless WebKit: temporarily add a `useEffect` that samples `window.scrollY`, `innerHeight`, `document.scrollHeight`, `visualViewport.offsetTop/height`, the target element's `getBoundingClientRect()` / `offsetHeight` / inline style / `getComputedStyle` over the first ~1500ms after mount (every rAF + every 50ms + on every `visualViewport` and `window` scroll event). Each `console.log` is forwarded to the client log buffer on dev hosts (see "Client Log Forwarding" section). The user reproduces the bug once on their real device; you read the trace via `curl https://<slug>.dev.whoeverwants.com/api/client-logs?search=<TAG>&limit=500` and correlate the visible motion with the per-frame numbers. This branch's investigation pinned down two distinct bugs via this method (scrollY oscillation from the bottom-pin, then `pollsPad: 0 → 80` first-paint flicker from `useMeasuredHeight`'s state seed). Both fixes followed directly from the trace; neither would have been visible without it.

### Poll Cards + Detail Page (Group View)

**Tapping a row slides to its detail page** at `/g/<groupShortId>/p/<pollShortId>`. The group page renders each poll as an **edge-to-edge rectangle** with a full-bleed 2px bottom divider (and a matching sentinel top divider above the first row). The rectangles butt against the body's safe-area content edge with no horizontal margin or rounded corners. The slide uses the same overlay-slide mechanism as home→group (`lib/slideOverlay.tsx → slideToPollDetail`), so the first frame moves on the next rAF rather than waiting for the destination route to commit. Back arrow slides back to the group root via `slideToGroupRoot`. The full poll content (notes + every sub-question's ballot + voter list) lives on the detail page; the group rows show only compact status.

- **`GroupContent` (exported from `app/g/[groupShortId]/GroupPage.tsx`)** renders the group list. `GroupPageInner` (in the same file) resolves the URL params and mounts `GroupContent`. Legacy `?p=<pollShort>` URLs are redirected to `/g/<group>/p/<pollShort>` so existing share links keep working.
- **`PollDetailView` (exported from `app/g/[groupShortId]/p/[pollShortId]/page.tsx`)** is the prop-driven detail page view. The slide overlay mounts this directly during the slide-in animation; the default export below it wraps with `useParams` for direct URL navigation. Both paths use a synchronous cache-first init (`getCachedPollForShortId`) so cache hits render instantly.
- **Template treatment of group-family pages.** `isGroupFamilyPage` (any `/g/*` OR `/p/*`) suppresses the template's fallback header so neither group root nor detail page nor legacy redirect gets the template's centered title bar. `isGroupLikePage = isGroupRootView(pathname)` matches only `/g`, `/g/`, `/g/<id>`, `/g/<id>/` — NOT `/g/<id>/info`, `/g/<id>/edit-title`, or `/g/<id>/p/<short>`. The bubble bar lives only on `isGroupLikePage` routes; the detail page is plain layout (same as `/info`).
- **Row layout (top→bottom):** four-zone grid inside each rectangle's `pl-[0.9rem] pr-[0.65rem] pt-3 pb-1` padding (asymmetric: -10% left / -35% right from `px-4`, so the respondents row hugs the right edge). Row 1: title prefixed by `getCategoryIcon(question, isClosed)` (left, `flex-1 min-w-0`) + status countdown + right-chevron nav glyph (right, `shrink-0`, `flex items-center gap-1`, `text-sm`). The chevron mirrors `GroupHeader`'s tappable-title chevron (same `M9 5l7 7-7 7` path, `text-gray-400 dark:text-gray-500`, `w-4 h-4 shrink-0`) as the "tap to slide to detail page" affordance; rendered for every non-placeholder row regardless of whether a status label is present, so the wrapper div gates on `!isPlaceholder` alone (not the old `!isPlaceholder && statusEl` form). Row 2 (centered across the FULL rectangle width, NOT the right column): the type-specific compact pill scaled `transform: scale(1.4)` on an inner div, with `py-2` on the flex wrapper to absorb the ~20% visual overflow. Skipped when no pill is renderable. Row 3: author + relative-time (`text-xs text-gray-400` left, `shrink-0`) + respondent bubble row (right, `flex-1 min-w-0 flex justify-end`, `items-end` alignment so the baselines match). The retired creator-initials avatar lives on the poll detail page only — never on the row.
- **Edge-to-edge: how it really sits flush.** The template's inner wrapper TRIES to escape its outer-wrapper safe-area padding with `-mx-4`, but Tailwind v4's CSS source order makes the adjacent `mx-auto` win — DOM probe shows the inner wrapper resolves to `margin: 0`. The cards-wrapper in `GroupPage.tsx` compensates inline via `marginLeft/Right: 'calc(-1 * max(0.35rem, env(safe-area-inset-*, 0px)))'`, which exactly cancels the outer padding and pulls the rectangles flush to the body's safe-area content edge. The 0.35rem overhang on desktop lands well inside the inner template's `sm:px-4` (1rem) padding so it doesn't escape the max-w-4xl bounds — don't reach for an `sm:` reset.
- **`ROW_DIVIDER_CLASS = "border-gray-300 dark:border-gray-600"`** (exported from `GroupCardItem.tsx`) is the canonical divider color. Used by: each row's `border-b-2` (in `GroupCardItem`), the placeholder height-reservation div, and the sentinel `border-t-2` div before the `.map` in `GroupPage` (only renders when `groupedGroupQuestions.length > 0` so empty groups don't show a stray line above the bubble bar). Keep all three callsites pinned to the constant — drift breaks the symmetry between top + between + bottom dividers.
- **Awaiting state is a left-edge amber bar** (`absolute inset-y-0 left-0 w-1 bg-amber-400 dark:bg-amber-500`), NOT the old rounded-card amber border. Mounted only when `isAwaiting && !isPlaceholder`. The previous full-perimeter border doesn't translate to a row layout — a bezel on a borderless rectangle reads as "this row is selected" rather than "this row wants you".
- **Per-card share button is gone.** Sharing now happens from the poll's `/g/<group>/p/<short>/info` route (the long-press / tappable-title path). The row chrome is intentionally minimal — title + status + author + pill + respondents.
- **Card tap handler** (`navigateToDetail` in `GroupCardItem.tsx`) calls `slideToPollDetail({ groupId, pollShortId })` with the wrapper's `short_id` (falling back to the anchor question id for placeholder polls). The tap is gated by `touchJustHandledRef` to swallow the synthesized click after touch-end.
- **Long-press still opens the FollowUpModal.** Both the group row AND the detail page render `FollowUpModal` + the shared `ConfirmationModal` driven by `pendingAction: { kind: PendingActionKind; question: Question }`. Per-kind copy lives in `app/g/[groupShortId]/groupActionCopy.ts: PENDING_ACTION_COPY`. The two pages have parallel `onConfirm` handlers (forget / reopen / close / cutoff-availability / cutoff-suggestions) — when extending the union, update BOTH files or the new kind will only fire from one surface. There's an `if/else if` chain per kind in each handler; always use explicit `else if (action.kind === '...')` rather than a bare trailing `else` so future additions surface as no-op branches.
- **Swipe-to-abstain on rows was retired** with the card chrome. The supporting state in `useGroupVoting` (`submitSwipeAbstain`), the `swipeRef` / `swipeJustHandled` / `swipeThresholdQuestionId` plumbing in `GroupPage.tsx`, the `SwipeState` type, the swipe props on `GroupCardItem`, and `cardFrameRefs` are all gone (`cardFrameRefs` existed only so the gesture could write per-frame `transform: translateX(...)` to each row's inner frame). If "quick abstain" comes back as a feature, design it from scratch — the row layout has no equivalent affordance.
- **Synthetic-click-vs-long-press race.** A long-press that opens the modal fires touch-release → browser synthesizes a click → would land on the modal backdrop and close it. Fix: `FollowUpModal` timestamps `isOpen` and ignores backdrop clicks for 400ms after opening.
- **`pillForQuestion(sp)`** returns the type-specific compact pill (`QuestionResultsDisplay hideLoser={true}`, `CompactRankedChoicePreview`, `CompactSuggestionPreview`, `CompactTimePreview`) or null when there's nothing to show. Single-question polls render one pill; multi-question polls stack one pill per sub-question in a `flex flex-col items-stretch gap-1 w-full min-w-0` column inside the same `transform: scale(1.4)` wrapper, so they all scale together. **The compact previews no longer take a `categoryIcon` prop** — the row's title already shows the icon and duplicating it inside the pill reads as visual noise. Same applies to any future compact pill: don't reintroduce the icon there.
- **Status countdowns in the top-right corner use `SimpleCountdown wide`** which formats via `formatCompactCountdownWide(diffMs)` in `lib/timeUtils.ts` — same single-unit shape as `formatCompactCountdown` but with a ≥ 2 threshold (0–119s show seconds, 2m–119m minutes, 2h–47h hours, 2d–13d days, 2w–8w weeks, 2mo–23mo months, then years). Preserves more precision near the unit boundary so a viewer never sees a "1h" label that actually meant "60m left" — useful when the countdown is the sole timing signal visible. The default `compact` (no `wide`) keeps the 1-threshold behavior for surfaces like the home-page group rows that prefer the larger glyph. Don't use `wide` everywhere — pick based on whether the surface trades precision for shorter glyph width.
- **`transform: scale(1.4)` is the universally-supported way to grow the pill.** We tried CSS `zoom: 1.4` first (renders correctly in Chromium/Playwright screenshots but didn't take effect in WebKit even on a fresh load). `transform: scale` works everywhere with no quirks; the trade-off is that the bounding box doesn't reflow — sibling rows see the unscaled box. Compensate with explicit padding on the outer flex container (we use `py-2` on the pill row to absorb the ~20% visual overflow on each side). For any future scaled element, do NOT reach for `zoom`; use `transform: scale` + matching padding compensation.
- **Below-row respondent slot uses `VoterList singleLine`** as the right-hand flex child of a `flex items-end justify-between` row. The wrapping `<div className="flex-1 min-w-0 flex justify-end">` is load-bearing — it gives VoterList a constrained width so its internal `overflow-hidden whitespace-nowrap` + trailing `+N` badge actually truncate. Dropping the wrapper makes VoterList content-sized, the constraint disappears, and long respondent lists overflow into the bottom row instead of collapsing. The mode hides the count/icon prefix, renders one horizontal row, and collapses overflow into a `+N` badge. Measuring a React-hidden `+N` badge with `offsetWidth` returns 0 — temporarily force `plusEl.style.display = ''` before measuring, save and restore the previous value.
- **`inSuggestionPhase` is hoisted per render** in `GroupCardItem.tsx` (above `respondentRow`) since the status label, respondent filter, respondent empty-text, and `includeSelf` gate all read it. Don't re-inline the `isInSuggestionPhase(question, wrapperPrephaseDeadline)` call at multiple sites — they would all reduce to the same boolean and the function call overhead, while microscopic, was four-redundant before the cleanup pass.
- **Detail page renders sub-questions stacked, no card chrome.** Single-question polls drop the section header entirely (the page header IS the question). Multi-question polls render a section header per sub-question (`InlineCategoryIcon` + `getQuestionSectionTitle(sp)`). The `HangingCategoryIcon` (negative-left positioning into the group-card's creator-bubble column) does NOT apply here — there's no such column on the detail page; use `InlineCategoryIcon` (positioned in normal flow, not absolute) instead. Symptom of forgetting: the icon clips off the left viewport edge.
- **Early-voting ranked-choice polls split the suggestion entry and the ranking ballot into two separate cards.** A ranked_choice question with an open suggestion phase AND `allow_pre_ranking !== false` is "early voting": the voter can rank the tentative options while suggestions are still open. On the detail page (`PollDetail`), `isEarlyVoting = sp.question_type === 'ranked_choice' && poll.allow_pre_ranking !== false && isInSuggestionPhase(sp, poll.prephase_deadline ?? null)`. When true, the page **drops its own outer `POLL_SUBCARD_CLASS` card** and passes `splitEarlyVotingCards` to `QuestionBallot`; the multi-poll section header (if any) renders outside/above the cards. `QuestionBallot` then wraps `SuggestionVotingInterface` in one `POLL_SUBCARD_CLASS` card and passes `cardClass={POLL_SUBCARD_CLASS + ' mt-3'}` to `RankingSection`, which wraps the ballot body in its own card while keeping the "Early Voting" header/countdown/"options may change" warning **outside** (between) the cards. Key invariants:
  - **`POLL_SUBCARD_CLASS` (exported from `QuestionBallot.tsx`) is the single source of truth** for the detail-page card chrome — the page's normal per-question card, the suggestion card, and the ballot card all use it so they stay visually identical. Don't re-inline the `rounded-2xl border ... bg-gray-100 ... px-3 py-3` literal.
  - **`RankingSection.cardClass` is gated on `splitEarlyVotingCards`, NOT on `canSubmitSuggestions`.** Load-bearing for the deadline-crossing transient: if the page still thinks it's early voting (so it dropped its card) but `QuestionBallot`'s ticking `canSubmitSuggestions` has flipped false, RankingSection still gets a `cardClass`, so the ballot stays carded instead of floating chrome-less. The `card()` helper in RankingSection (`cardClass ? <div className={cardClass}>{content}</div> : <>{content}</>`) wraps BOTH the main ballot return and the "Ranking will open after cutoff" message branch; the `return null` paths never call it, so an empty card never renders.
  - **The ballot card only appears after the voter's first submission.** RankingSection returns null while `canSubmitSuggestions && !hasVoted`, so a fresh voter sees ONLY the suggestion card; the two-card layout (+ "Early Voting" header) appears once `hasVoted` is true. Pre-existing flow, unchanged by the split.
  - **The non-split path (`cardClass` undefined / `splitEarlyVotingCards` false) is render-equivalent to before** — `card()` returns `<>{content}</>`, a no-op fragment. Don't "optimize" it into always-wrapping a `<div>`; that changes the DOM for every non-early-voting ranked-choice question.
- **Detail page header title uses `subQuestions[0]?.title || poll.title`, NOT `poll.title` first.** Server-side `_compute_display_title` (in `routers/polls.py`) prefers `group_title` over the auto-generated/typed poll title — so `poll.title` returns the group name override when one is set. Each sub-question carries the wrapper-level question_title (the actual poll title, set at create time and identical across every question of the same poll), so reading `subQuestions[0]?.title` gives the poll's own title without the group conflation. The group root page header IS allowed to use `poll.title` (or rather the same `_compute_display_title` flow via `GroupHeader.title`) because there the group name is what the user wants to see. The PollShareButton needs the same per-question title for the same reason. Rule: any FE surface that conceptually displays "this poll's name" (detail page header, poll-link previews, anything that lives at `/g/<id>/p/<short>`) should prefer `subQuestions[0]?.title` over `poll.title`.
- **Detail page owns its own vote state via `useGroupVoting`**, fed a synthetic one-poll Group built from the loaded `Poll`. The hook only reads `group.questions` to resolve `poll_id` per vote write; voted/abstained sets pass through setters, so the synthetic Group's deps can be `[poll]` only (omitting voted/abstained avoids identity churn on every vote). All the vote-flow state (`pendingVoteChange`, `pendingPollChoices`, `pollVoterNames`, `wrapperSubmitState`, `confirmPollSubmit`, etc.) and its UI (yes/no card pair, QuestionBallot per sub-question, wrapper-level Submit, voter-name field, confirmation modals) live on the detail page now. The group page no longer renders any vote UI — only the compact pill on each card.
- **`useGroupVoting` exposed by the group page is read-only.** The hook is still called on `GroupPage` but only `userVoteMap` (for the compact yes/no pill badge) and `setUserVoteMap` (to update it after vote-events) are consumed. All vote-write flows route through the detail page.
- **Pitfall: `useMeasuredHeight`'s ref must attach in the same component that calls the hook.** First implementation called the hook in `PollDetailView` (parent) and passed `headerRef` + `headerHeight` as props to `PollDetail` (child) that rendered the `GroupHeader`. Result: the rendered `paddingTop` resolved to 24px (`calc(0px + 1.5rem)`) instead of the expected `calc(56px + 1.5rem)` — `headerHeight` was 0 in the child's render even though the seed was 80. The hook's `setHeight(offsetHeight)` ran but didn't propagate cleanly through the prop boundary. Symptom: first content (e.g. the first section header) renders at y=32 BEHIND the 56px-tall fixed page header. Fix: move the hook into the component that actually renders the measured element. Same applies to any hook that returns a `[ref, derivedState]` pair — keep the ref attachment and the state read in one component.
- **Loading/error frames don't need to measure.** They have a fixed `<GroupHeader>` + a `min-h-[40vh] flex` body — nothing flows under the header. Pass a plain `useRef(null)` instead of `useMeasuredHeight` to avoid unnecessary state + ResizeObserver setup.
- **Pre-mount results data on viewport entry (group page).** A shared `IntersectionObserver` adds card ids to `visibleQuestionIds` when they enter the viewport (200px rootMargin). `maybeFetch` fetches `apiGetQuestionResults` + (for yes_no) `apiGetVotes` for each visible question, populating `questionResultsMap` / `userVoteMap`. This still drives the compact pill content even though cards no longer expand. Observer effect depends on `[!!group]`, not `[group]` — otherwise every forget/reopen mutation would tear the observer down and re-observe every card.
- **`QUESTION_VOTES_CHANGED_EVENT` is the vote-list refresh channel.** Fired by `QuestionBallot` and `useGroupVoting` after every vote write. The group page listens to refresh `questionResultsMap` / `userVoteMap` for the changed question and re-derive `voter_names` / `prephase_deadline` on the wrapper. The detail page listens to refresh the SAME question's results+votes AND refetch the full wrapper (`apiGetPollById`) so the bottom-of-page respondent list reflects the new vote. The detail page's listener registers with empty deps + reads the latest `poll` via a `pollRef` — registering on `[poll]` would tear down and re-fan-out the per-question fetch loop on every vote.
- **Don't dispatch `question:updated` from a component that already called `setGroup`/`setPoll` for the same question.** The handler re-applies the update, forcing a redundant array allocation + re-render. Dispatch only when the mutation originates elsewhere.
- **Write localStorage BEFORE dispatching `QUESTION_VOTES_CHANGED_EVENT`.** Listeners read `loadVotedQuestions()` synchronously; if the dispatch fires before the write, they see the pre-vote state and the golden border / awaiting flag doesn't clear until a refresh.
- **`loadVotedQuestions()` always allocates fresh Sets.** Compare contents before committing (`setsEqual(prev, fresh)`) to avoid re-rendering every downstream memo on identity churn.
- **Pin list sort to a group snapshot.** The group page sorts awaiting questions to the bottom AND draws a golden border. If both read live state, voting in one card reshuffles the list. `useMemo` the sorted array keyed on group identity only (disable-next-line exhaustive-deps for voted/abstained sets).
- **Compact pill icons use `getBuiltInCategoryIcon`** (no generic fallback). `CompactRankedChoicePreview` and `CompactTimePreview` accept an optional `categoryIcon?` prop; pass `getBuiltInCategoryIcon(sp.category)` at the call site (returns `undefined` for `'custom'` / null categories). For the per-question category emoji on the detail page, use the local `InlineCategoryIcon` helper which calls `getCategoryIcon` (returns the question type symbol as a fallback for custom categories).
- **Single pending-action confirmation modal.** Forget / Reopen / Close / Cutoff-Availability / Cutoff-Suggestions share one `ConfirmationModal` driven by `pendingAction: { kind: PendingActionKind; question: Question }`. Per-kind copy lives in `PENDING_ACTION_COPY` (`app/g/[groupShortId]/groupActionCopy.ts`). To add a new kind: extend the union + the table; don't rewrite the ternaries. The `onConfirm` body keeps one `if/else if` branch per kind. `cutoff-suggestions` and `cutoff-availability` share a single branch (`else if (kind === 'cutoff-suggestions' || kind === 'cutoff-availability')`) — identical optimistic-state shape, only the API helper differs.
- **Per-poll info page (`/g/<groupShortId>/p/<pollShortId>/info`)** hosts the poll-level actions (Copy / Forget / Reopen / Close / End Availability / Cutoff Suggestions) that used to live in `FollowUpModal` on the detail page, plus the full named respondent list (named voters in rows, anonymous count tallied in a final italicized row). `slideToPollInfo` (in `lib/slideOverlay.tsx`) is the canonical entry point; the poll detail page's `GroupHeader` calls it from `onTitleClick`. The `pollInfo` slide kind mounts the prop-driven `PollInfoView` exported from the route file. The four poll-mutating actions route through `POLL_ACTION_APIS` (a `Record<Exclude<PendingActionKind, 'forget'>, (id, secret) => Promise<Poll>>` lookup table inside the page) so adding a new poll-level action = one row in the table + one bullet in `PENDING_ACTION_COPY` + a gating boolean. The corresponding `onConfirm` in `GroupPage.tsx` (still wired for long-press on group cards) hasn't been migrated to the lookup table yet — they share the same `PENDING_ACTION_COPY` constants and ought to share the API dispatch too, but the two callsites' state-update shapes differ (group page uses `patchGroupPolls` across multi-poll group state; info page uses single-poll `setPoll`). When the third site appears, extract a shared `executePollAction(kind, poll, secret) → Promise<Poll>` and pass the state-update strategy in via callback. **Forget on the info page drops every sub-question of the poll** (anchor-only would strand siblings in localStorage on multi-question polls); the long-press flow on the group card still forgets only the tapped question.
- **`<PollActionButton variant icon label onClick disabled>`** (`components/PollActionButton.tsx`) is the shared colored-button primitive for the info page's action stack. Variants: `blue | yellow | green | red | amber` map to the Copy / Forget / Reopen / Close / Cutoff color tokens. Shared `BASE_CLASS` carries the icon-spaced flex + `active:scale-95` + `disabled:opacity-50` chrome; per-variant `VARIANT_CLASSES` carries only the `bg-*/hover/active` triplet. `<CutoffIcon />` is the shared clock SVG used by both "End Availability Phase" and "Cutoff Suggestions" (the two amber buttons). `FollowUpModal` still ships its own near-identical button stack (it's the second consumer); migrating it to `<PollActionButton>` is the next step and would let `AmberCutoffButton` in `FollowUpModal.tsx` retire too. Don't reach for `<GradientBorderButton>` — different visual register, no overlap.
- **`GroupHeader.titleAriaLabel` defaults to "Group details"** but the poll detail page overrides it to "Poll details" since its `onTitleClick` opens the per-poll info page (not the group info page). When wiring a new tappable-title route, pass an `aria-label` that describes what the click actually opens.
- **`slideToPollDetail` accepts `direction` + `useHistoryBack`** (added when the poll info page needed to slide back). Same signature shape as `slideToGroupInfo` / `slideToGroupEditTitle`; defaults to `direction: 'forward'` + `useHistoryBack: false` so existing forward-push callers don't have to change. The info page's back arrow calls `slideToPollDetail({ direction: 'back', useHistoryBack: hasAppHistory() })`.
- **`isCreatorOrDev` gate appears 4× per FollowUpModal callsite** — hoist `const isCreatorOrDev = !!getCreatorSecret(modalQuestion.id) || process.env.NODE_ENV === "development"` once per render (inside an IIFE if needed) rather than inlining at each prop. Same for `wrapperOwnsSubmit = useWrapperSubmit || (usePollSubmit && !isYesNo)` on the detail page — hoist once per sub-question map iteration.
- **`getGroupHrefForPoll(poll)` is the canonical poll-detail URL builder.** Returns `/g/<group_short_id>/p/<poll_short_id>` with placeholder fallbacks. Use it for the per-card share button URL, the share button in the detail page header, and anywhere else that constructs a "navigate to this poll" link. Don't inline the URL form — the helper handles placeholder polls and the group-root fallback.
- **localStorage helpers live in `lib/votedQuestionsStorage.ts`.** `loadVotedQuestions()` (sets), `hasVotedOnQuestion(questionId)` (boolean), `setVotedQuestionFlag(questionId, true | 'abstained' | null)`, `getStoredVoteId(questionId)`, `setStoredVoteId(questionId, voteId)`, and `parseYesNoChoice({ is_abstain, yes_no_choice })`. Don't write inline `JSON.parse(localStorage.getItem(...))` for the `votedQuestions` / `questionVoteIds` keys.
- **Yes/No tap on a single-question poll auto-submits on first vote** via `dispatchYesNoTap`. Checks `!isMultiPoll && !userVoteMap.get(questionId)` and routes to `submitYesNoChoice(questionId, newChoice)`; vote-edits (existing entry in `userVoteMap`) and multi-question polls still go through the confirmation modal.
- **Post-vote ranked choice summary is a single "Your Ballot" amber link — EXCEPT for binary 2-option polls without a suggestion phase, which keep the cards visible.** For `questionOptions.length > 2` (or any ranked-choice with a suggestion phase): when `hasVoted && !isEditingVote && hasCompletedRanking`, `QuestionBallot` renders one centered `<button>Your Ballot</button>` using the shared Abstain-link class stack (`text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70`) that calls `setIsEditingVote(true)` on click. For `questionOptions.length === 2 && !canSubmitSuggestions`, the gate at QuestionBallot.tsx:1383 explicitly excludes that case (`&& questionOptions.length !== 2`) and falls through to `RankingSection` → `BinaryRankedChoiceBallot` — the cards stay visible with the user's choice highlighted (the existing `setRankedChoices(voteData.ranked_choices)` restore at QuestionBallot.tsx:495 populates `rankedChoices[0]`). Tapping a card after voting fires `handleBinaryChoiceTap`, which flips `isEditingRanking=true` so the wrapper Submit (`wrapperShouldShowSubmit`) surfaces. `ReadOnlyTierCards` is still used elsewhere but is no longer imported in `QuestionBallot`. **Below-ballot preliminary results render only while editing a non-ranked-choice vote** — `showPreliminaryBelowBallot = isEditingVote && !inSuggestionPhase && !hasSuggestionPhase && question.question_type !== 'ranked_choice'` (defined alongside the other suppress flags above `preliminaryResultsBlock`). Pre-vote viewers see no preliminary results in the expanded card; the above-ballot block (gated on `hasVoted && !isEditingVote`) is the sole display once the viewer has submitted. Ranked-choice edits stay focused on the re-rank list — the edit-pass display is intentionally suppressed for that shape too.
- **Yes/No results have a compact view and an expanded view driven by `hideLoser`.** `hideLoser=true` (group card collapsed): single-line winner pill + `N%` + `(count)`, right-justified. `hideLoser=false`: the two option cards sit side-by-side (`w-24` each, right-justified in a flex with `items-center`), the chosen card gets a blue checkmark badge (`w-[1.625rem]`, white SVG check, `strokeWidth={4}`) in its *outer* corner (`-top-2 -left-2` on the left/Yes card, `-top-2 -right-2` on the right/No card — mirroring keeps it from overlapping the neighbor), and percent + parenthesized count render on a row below the cards. Abstain / "You abstained" sits in the left column of the same flex, vertically centered with the cards via `items-center`. Don't add a "PRELIMINARY" label — user removed it. The Yes-card always occupies the left grid slot and No the right (regardless of winner) so the checkmark's corner choice is stable.
- **localStorage helpers live in `lib/votedQuestionsStorage.ts`.** `loadVotedQuestions()` (sets), `hasVotedOnQuestion(questionId)` (boolean — true for both voted and abstained), `setVotedQuestionFlag(questionId, true | 'abstained' | null)`, `getStoredVoteId(questionId)`, `setStoredVoteId(questionId, voteId)`, and `parseYesNoChoice({ is_abstain, yes_no_choice })`. Use these — don't write inline `JSON.parse(localStorage.getItem(...))` for the `votedQuestions` / `questionVoteIds` keys. The group page, `QuestionBallot`, and `forgetQuestion.ts` all consume these.
- **Post-vote ranked choice summary is a single "Your Ballot" amber link — EXCEPT for binary 2-option polls without a suggestion phase, which keep the cards visible.** For `questionOptions.length > 2` (or any ranked-choice with a suggestion phase): when `hasVoted && !isEditingVote && hasCompletedRanking`, `QuestionBallot` renders one centered `<button>Your Ballot</button>` using the shared Abstain-link class stack (`text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70`) that calls `setIsEditingVote(true)` on click. For `questionOptions.length === 2 && !canSubmitSuggestions`, the gate at QuestionBallot.tsx:1383 explicitly excludes that case (`&& questionOptions.length !== 2`) and falls through to `RankingSection` → `BinaryRankedChoiceBallot` — the cards stay visible with the user's choice highlighted (the existing `setRankedChoices(voteData.ranked_choices)` restore at QuestionBallot.tsx:495 populates `rankedChoices[0]`). Tapping a card after voting fires `handleBinaryChoiceTap`, which flips `isEditingRanking=true` so the wrapper Submit (`wrapperShouldShowSubmit`) surfaces. `ReadOnlyTierCards` is still used elsewhere but is no longer imported in `QuestionBallot`. **Below-ballot preliminary results render only while editing a non-ranked-choice vote** — `showPreliminaryBelowBallot = isEditingVote && !inSuggestionPhase && !hasSuggestionPhase && question.question_type !== 'ranked_choice'` (defined alongside the other suppress flags above `preliminaryResultsBlock`). Pre-vote viewers see no preliminary results in the expanded card; the above-ballot block (gated on `hasVoted && !isEditingVote`) is the sole display once the viewer has submitted. Ranked-choice edits stay focused on the re-rank list — the edit-pass display is intentionally suppressed for that shape too.
- **Binary 2-option ranked-choice ballot is rendered like the yes/no card pair (when no suggestion phase is in flight).** `RankingSection`'s `questionOptions.length === 2 && !canSubmitSuggestions` branch delegates to `components/QuestionBallot/BinaryRankedChoiceBallot.tsx`, which mirrors `YesNoResults`'s expanded view: two cards side-by-side, winner card colored from the live first-round IRV count (`results.ranked_choice_rounds`, `round_number === 1`), blue checkmark badge in the outer corner of the user's chosen card, % + count row beneath the cards, and an "Abstain" / "You abstained" text link to the LEFT (replacing `AbstainButton` for THIS branch only). The drag-to-reorder branch keeps `AbstainButton` below the rank list — when restructuring, move the abstain control inside its branch so each branch owns its own abstain affordance. Visual divergence from yes/no: green/gray instead of green/red (a losing option isn't a negation), and `flex-1 min-w-0` cards instead of `w-24` so rich `OptionLabel` content (restaurants/locations) fits.
  - **Suppress the rounds-list preliminary results when binary cards are visible.** `QuestionBallot.preliminaryResultsBlock` gates on `!suppressBinaryRcHere`, where `suppressBinaryRcHere = ranked_choice && questionOptions.length === 2 && !canSubmitSuggestions`. Cards now stay visible post-vote (tap to edit), so the suppression is unconditional for this shape — adding a `hasVoted` carve-out would re-introduce the duplicate-winner problem (rounds list + cards both showing the same first-round counts).
  - **Plumb `questionResults` into `RankingSection`.** The 2-option branch needs first-round counts + winner; the existing component prop list didn't have them. Added a `questionResults?: QuestionResults | null` prop and forwarded from `QuestionBallot`'s state. Other branches don't read it, so it's optional.
  - **Gate is the existing `!canSubmitSuggestions` clause, unchanged.** A 2-option ranked-choice with an open suggestion phase still renders the drag-to-reorder UI — the user might still grow the option list past two via suggestions, so a binary card pair would mis-promise.
  - **`Math.find()` over `ranked_choice_rounds` is fine for 2-option case.** With 2 options IRV runs at most one round, so the rounds array has 2 rows. Don't pre-emptively memoize into a Map — the cost is genuinely negligible.
  - **Binary RC tap-to-submit mirrors yes/no's tap UX, gated by `hasVoted`.** First-time tap → auto-submit, no confirmation modal. Edit tap (hasVoted=true) → only stages the choice + flips into `isEditingRanking` so the wrapper Submit button surfaces — the user must press Submit to actually change their vote. Implementation: `handleBinaryChoiceTap` in `QuestionBallot.tsx` sets `rankedChoices` + (for first-time) arms a `pendingBinarySubmit` flag; a `useEffect([pendingBinarySubmit, rankedChoices, isEditingRanking])` picks up the flag on the next render — once React commits the state — and fires `submitVoteRef.current()`. Reading through the ref ensures `submitVote`'s closure sees the freshly-committed `rankedChoices`/`rankedChoiceTiers` instead of the stale empty array from the tap-event closure. `RankingSection` exposes `onBinaryRankedChoiceTap` so non-QuestionBallot callers fall back to the legacy stage-only behavior. **The drag-to-rank multi-option ballot is unchanged** — tap-to-submit doesn't fit while reordering; the user submits via the wrapper Submit button.
  - **`AbstainButton` (the big yellow button) is replaced by a small gold-text link in both binary RC and the multi-option drag-to-rank ballot.** The active state is a `<button>` whose label flips between `Abstain` (not selected) and `Abstaining` (currently selected, pre-Submit) — tapping `Abstaining` toggles back through `handleAbstain`. Earlier the toggled-on label read `You abstained`, which implied a completed action even though the user still had to press Submit; the present-tense form describes the staged state honestly. Earlier still the active state was a `<span>` and the user couldn't revert without also tapping a card. Class stack matches the yes/no `abstainContent` in `QuestionResults.tsx`: `text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline active:opacity-70`. The `disabled` (read-only) state still uses a `<span>` and keeps `You abstained` (past tense, since at that point the vote is committed / submission is in flight). Ranking-section `AbstainButton` import is gone; the component is still imported by `TimeBallotSection`.
  - **Yes/No abstain label distinguishes staged vs committed via `isStagedChoice`.** `QuestionResultsDisplay` (and `YesNoResults`) take an optional `isStagedChoice?: boolean`. When true AND `userVoteChoice === 'abstain'`, the inline abstain text reads `Abstaining`; otherwise `You abstained`. The expanded yes/no card in `GroupCardItem.tsx` passes `isStagedChoice={stagedChoice !== null}` so multi-question polls (where taps queue into `pendingPollChoices` before the wrapper Submit fires) surface the staged form. The compact `hideLoser=true` path doesn't render abstain text so the prop has no effect there; the legacy `userVoteData`-driven path leaves `isStagedChoice` unset (always-committed semantics). If you add another caller that drives `userVoteChoice` from a pending/staged source, set `isStagedChoice` accordingly — otherwise the label will lie about the commit state.
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

## Slider Switches (Boolean Toggles)

- **`components/SliderSwitch.tsx`** is the canonical replacement for `<input type="checkbox">` on every boolean settings toggle in the app. It's a `role="switch"` button with an animated knob — blue track + knob translated right when on (`bg-blue-600` + `translate-x-5`), gray track + knob left when off (`bg-gray-300 dark:bg-gray-600`). 24px tall × 44px wide, knob 20px, 200ms `transition-colors` + `transition-transform`. Use this for any new ON/OFF setting; don't bring `<input type="checkbox">` back unless you're rendering a true multi-select list-row affordance (the `MinMaxCounter` Duration enabled-toggles are the lone exception — they intentionally use checkboxes, see below).
- **The wrapper `<label htmlFor={id}>` → `<input id={id} type="checkbox">` row-toggle pattern doesn't work for switches.** `<label htmlFor>` only delegates clicks to a labelable form control (input/select/textarea/button-with-an-associated-label-handler); a `<button role="switch">` is labelable but `htmlFor` won't fire its onClick in WebKit consistently. The canonical row layout is now:
  ```tsx
  <div
    className={`flex items-center justify-between gap-3 h-12 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
    onClick={() => { if (!disabled) setX(!x); }}
  >
    <span>Label</span>
    <SliderSwitch checked={x} onChange={setX} disabled={disabled} aria-label="..." />
  </div>
  ```
  The `SliderSwitch`'s own onClick calls `e.stopPropagation()` so direct switch taps don't bubble to the wrapper and re-toggle. Always-`cursor-pointer` is a regression — gate it on `!disabled` so the cursor reflects whether the click does anything (see `CompactMinResponsesField.tsx`, `NotificationSettingsCard.tsx`).
- **When a toggle has compound side effects (e.g. `VotingCutoffConditionsModal`'s `setDeadlineEnabled` + `setDeadlineOption`), extract a single `toggleX(next: boolean)` helper** and pass it as both the wrapper's onClick body AND the SliderSwitch's onChange. Duplicating the two-statement body between the wrapper and the switch is a maintenance hazard — the bodies silently drift the next time someone tweaks one path. The simplify pass on the rollout PR found this pattern at two sites and consolidated; mirror it for any future compound toggle.
- **`MinMaxCounter` is the exception.** The Duration field's min/max enabled-toggles flank a counter pair (`☑  ⌃ 1 ⌄ — ⌃ 2 ⌄  ☑`) where the visual is intentionally compact and the box-shaped toggle reads as "this counter is on" rather than "this option is on/off" — the user explicitly kept checkboxes here. Don't migrate `MinMaxCounter` to `SliderSwitch` without an explicit follow-up ask; the box-shape semantics matter for that compound widget.
- **The voter-form time-slot toggle in `DayTimeWindowsInput` is also an exception.** Each time-window pill carries a small enabled checkbox to its left when the voter is filling out availability; the user explicitly kept those as checkboxes during the slider rollout. The "include this slot" affordance reads as a multi-select list-row, not a settings ON/OFF toggle.

---

## Name-Required Policy

The user's saved display name (`lib/userProfile.ts: getUserName/saveUserName`, localStorage key `whoeverwants_user_name`) is required for creating a poll, voting on a ballot, and creating a new group. Settings is the single edit surface.

- **Shared validation lives in two mirrored files: `lib/nameValidation.ts` + `server/services/validation.py`.** Common-sense rules only: 1–50 chars after trim, no control chars (`\x00-\x1F\x7F`). Mirror constants in both files when changing.
- **`<NameRequiredModal>` (`components/NameRequiredModal.tsx`) is the canonical "we need a name" surface.** Input + Save button; on save, calls `saveUserName(name)` then `onSubmit(name)`. Three callsites: `CreateGroupButtonHost` (home new group button), `CreateQuestionContent` (category bubble tap), `PollDetail` (every vote Submit path). Modal is z-`[70]` so it stacks above the create-poll bottom sheet (z-`[60]`) and the ConfirmationModal.
- **No inline `<CompactNameField>` in ballots or the create-poll form.** Earlier iterations rendered "Your Name" inputs in the wrapper Submit sections of `app/g/[groupShortId]/p/[pollShortId]/page.tsx`, the create-poll modal bottom card, and each ballot's internal Submit (`QuestionBallot.tsx`, `RankingSection.tsx`, `QuestionBallot/TimeBallotSection.tsx`, `SuggestionVotingInterface.tsx`). They're all gone. Per-poll name overrides are not supported — your name is your name.
- **Modal gates fire at the moment of the user-action click, not earlier.** Bubble tap → `handleBubbleClick(cat)` checks `isValidUserName(getUserName())`; if missing, stash `pendingBubbleCategory` + open modal; on save, `openModalFor(cat)`. Vote Submit click → `gateOnName(retry)` helper in `PollDetail`; if missing, stash a `pendingNameRetry: (() => void) | null` thunk + open modal; on save, replay the thunk. The thunk pattern keeps the union types from sprawling — each Submit site passes its own retry closure inline. Don't reach for a multi-variant `PendingAction` union; the thunk is cleaner.
- **Server enforcement is the backstop, not the primary gate.** `validate_user_name` raises 400 in `POST /api/polls` (creator_name) and `POST /api/polls/{id}/votes` (voter_name). The FE's bubble/Submit modals are what produce a good UX; the server returns "is required" / "contains invalid characters" if the FE is bypassed. Mirror this pattern for any future "required identity field": always-on FE gate at action-click + server validator with matching rules.
- **`CompactNameField.tsx`** still exists; it's only used on the settings page now. **Selects all on focus** so tapping into a pre-filled right-aligned field doesn't leave the caret at position 0 (where backspace is a no-op against the user's expectation — see the earlier bug). Tailwind's `text-right` + a pre-filled value is the trigger; any future right-aligned input wrapping a saved value should mirror the `.select()` on focus.
- **Settings Save's disabled gate compares against `initialName`**, not against `name` truthiness. Tracking `initialName` (snapshot from `getUserName()` at mount; refreshed after each successful save) lets the rule "name changed → dirty → save enabled" cover the "user cleared a previously-saved name" case. Without this, the only-name-changed-to-empty case looked like "nothing dirty" and Save stayed disabled. Pattern applies to any other settings field whose meaningful state includes "cleared": track the initial value, compare on dirty-detection.
- **API tests `conftest.py: create_poll` includes `"creator_name": "Test User"` by default** so existing tests don't have to know about the name-required rule. Anonymous-vote tests (passing `voter_name: null` or omitting it) were flipped to assert the server's 400 instead of the old 201. Future tests posting to `/api/polls` or `/api/polls/{id}/votes` need a non-empty name in the body.

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
- **Demo after every change — no exceptions, even for "simple" fixes**: Whenever the user asks for a bug fix or new feature (regardless of how trivial it looks), assume they want a live demo link. After pushing, wait for the dev server to finish rebuilding (question the dev API health endpoint until it returns 200), then use the API to create a realistic demonstration that showcases the new behavior. Create questions, cast votes with realistic names, set up whatever scenario best highlights the change. Think creatively — make names, options, and question titles feel like real people making real decisions. Use a generous expiration buffer (e.g., 7 days) unless the demo specifically requires an imminent deadline. **Always share the dev server link to the demo with the user as part of reporting the work complete** — don't make them ask for it. If the change is genuinely impossible to demo (pure infra/tooling, no user-visible surface), explicitly say so rather than skipping the link silently.
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

## Client Log Forwarding

The browser forwards `console.*` output and unhandled errors/rejections to the API server via `POST /api/client-logs`. The endpoint is an in-memory ring buffer (last 10000 entries on the API server) — no disk writes, no persistence across restarts. **The ring buffer is per-uvicorn-worker**, and the canary/prod containers run with `--workers 2`. A POST landing on worker B's buffer is invisible to a GET that hits worker A's buffer — both endpoints route through the same Caddy → uvicorn socket but the kernel dispatches connections across workers via accept-balancing, so the worker for each request is non-deterministic from the caller's POV. To work around this, `receive_client_logs` ALSO mirrors every received entry to stdout via `logger.warning("[client-log] ...")`; tail `docker compose logs api | grep '\[client-log\]'` for the cross-worker source of truth when the `/api/client-logs` GET returns suspiciously-empty. (The buffer is still useful for the FE itself when running in-process polls, and as a fallback when log volume is high enough that grepping the docker stdout becomes painful.)

**Activation rules (`lib/clientLogForwarder.ts: isLogForwardingEnabled`):**
- **Dev hosts** (`*.dev.whoeverwants.com`, `localhost`, `127.0.0.1`) — forward EVERYTHING (`log/warn/error/info/debug` + unhandled events). Low traffic; devs want full context.
- **Canary + prod** (`latest.whoeverwants.com`, `whoeverwants.com`) — forward `warn/error` only + unhandled events. Verbose `log/info/debug` from a busy session would otherwise churn the ring buffer faster than diagnostic entries can be read (the level filter lives in `isHighVolumeHost()`). The primary reason this is enabled on prod is to capture WKWebView-specific JS errors from the iOS TestFlight app, which loads `whoeverwants.com` directly and has no other diagnostic channel (Safari Web Inspector requires a wired Mac).

### When the user reports an issue

**IMMEDIATELY check client logs** in addition to server-side logs. The host you query matches the tier the user was on:

```bash
# Dev (branch's per-branch dev server, Mac-hosted)
curl -s "https://<slug>.dev.whoeverwants.com/api/client-logs?level=error&limit=50" | python3 -m json.tool

# Canary (auto-deployed on push to main)
curl -s "https://latest.whoeverwants.com/api/client-logs?level=error&limit=50" | python3 -m json.tool

# Prod (deployed only on GitHub Release)
curl -s "https://whoeverwants.com/api/client-logs?level=error&limit=50" | python3 -m json.tool

# Other useful queries (same per-tier hosts):
#   ?search=<text>            substring filter in messages
#   ?since=<unix-timestamp>   only entries received after this time
#   ?limit=N                  cap (default 200, most-recent-first)
# DELETE clears the buffer (handy before reproducing)
```

### Diagnostic checklist when user reports a bug

1. **Client logs** on the matching tier (see above).
2. **Server logs**:
   - Dev: `bash scripts/remote-mac.sh "docker exec whoeverwants-dev-<slug> tail -50 /repo/api.log"`
   - Canary: `bash scripts/remote-latest.sh "docker compose logs --tail 100" /root/whoeverwants`
   - Prod: `bash scripts/remote.sh "docker compose logs --tail 100" /root/whoeverwants`
3. **Full client log dump** (`?limit=200`) on dev for info/debug-level context (canary/prod return warn/error only).

### How it works

- `lib/clientLogForwarder.ts` patches `console.*` methods at module load via `installClientLogForwarder()` (called once from `app/template.tsx`).
- Levels patched are gated by `isHighVolumeHost()`: dev = all 5 methods; canary/prod = `warn` + `error` only.
- Unhandled `error` and `unhandledrejection` are captured on every tier where forwarding is enabled (their `level` is hard-coded to `'error'`, so the prod filter doesn't drop them).
- Logs are batched every 2s and sent via `fetch` with `keepalive: true`. **`navigator.sendBeacon` was retired** — on iOS WKWebView (Capacitor + iOS Safari + iOS PWA), cross-origin `sendBeacon` calls with `application/json` Blobs silently drop the POST: the CORS preflight succeeds (OPTIONS lands on the server), `sendBeacon` returns true (queued), but the actual POST never fires. Symptom was a permanently-empty log buffer on `latest.whoeverwants.com` despite the forwarder being installed. `fetch keepalive` works on every platform and is the cross-platform reliable path. The tradeoff: fetch keepalive caps the body at 64 KB (per spec) and is less aggressive about surviving page-unload — both fine for our 2s-batched, sub-KB-per-message workload.
- Each entry includes: level, message, timestamp, page URL, user agent, session ID.
- Ring buffer is 10000 entries (raised from 2000 when prod activation landed).

---

## Participation Questions (Removed)

The `question_type='participation'` type, its FE components (`ParticipationConditions`, `QuestionField`, `ParticipationConditionsCard`), the `algorithms/participation.py` priority algorithm, the `auto_close.py` capacity-watcher, and every supporting column/constraint were dropped in **migration 094** (schema) plus the matching code removal. There is no longer a "participation" question type or codepath. (`MinMaxCounter` survives — it's used by `TimeQuestionFields` for the time-question Duration counter.)

If a future feature needs RSVP-style headcount semantics, it should be designed from scratch as a question category inside the poll system rather than reviving the old standalone-question architecture. The historical inclusion-priority algorithm (greedy selection respecting per-voter min/max constraints) is preserved in git history if anyone wants to mine it.

---

## Auth & Access Model

> **Phases A + B + C + D + E + F + G + I shipped.** A+B = identity
> foundation + magic-link email sign-in (migration 112). C = "Sign in
> with Apple" + "Sign in with Google" on web, plus native Apple AND
> native Google Sign In on Capacitor iOS via
> `@capgo/capacitor-social-login`. D = passkey
> (WebAuthn) registration + sign-in (migration 113), with anonymous
> registration supported so a user can create an account directly
> from a passkey. E = group privacy (migration 114) — new groups
> default private; visibility filter gates `/by-route-id` 404s for
> non-members; creator-only privacy toggle on /info. F = group join
> requests (migration 115) — signed-in non-members request access
> via the /info-not-found page, creators approve/deny from a /info
> "Pending requests" section, push notification fans out to every
> browser the creator's signed in on. G = invite links (migration
> 116) — creators mint shareable URLs (`/invite/<token>`); raw token
> + URL surfaced once at create time and persisted as sha256 hash;
> signed-in viewers auto-redeem on landing, anonymous viewers get a
> sign-in CTA. Phase H (per-vote anonymity) is **retired** — anonymous
> voting is "leave the voter name blank"; no per-vote on/off toggle is
> planned. I = account management (migration 118) — Settings shows
> linked sign-in methods, passkey-only / OAuth-only accounts can attach
> a recovery email, and any account can be deleted. Full plan +
> rationale in `docs/auth-access-model.md`.

**Cross-browser visibility for signed-in users.** Every read that
asks "is the caller a member of this group?" must walk
`user_browsers` to expand membership across every browser the user
is signed in on — not just the current `browser_id`. The
`group_members` table is keyed on `(group_id, browser_id)` but a
signed-in user has N browser_ids, each potentially with its own row
(or none). Visibility = "the current browser OR any browser linked
to user_id has a row." Per-group `joined_at` uses `MIN` across
linked rows so the closed-before-join filter is most permissive
(the user "joined" when their earliest browser did). Canonical
pattern in `services/groups.py: load_user_visibility` (signature
`(conn, browser_id, *, user_id)`); mirror it
verbatim in any new endpoint that reads membership. **Three places
in production today** — `/api/groups/mine`, `/api/groups/by-route-id/{id}`,
`/api/groups/empty`. Phase E (private groups, visibility filter)
and Phase F (join requests, "who requested?") will need the same
expansion; if the SQL doesn't `OR browser_id IN (SELECT browser_id
FROM user_browsers WHERE user_id = ...)`, the second browser bug
recurs. Symmetric for writes: `leave_group` deletes across every
linked browser when user_id is set — otherwise tapping "leave" on
one device just leaves on that device, and the group reappears on
the next visit from another linked browser.

**The `accessible_question_ids` "forget bridge" has been REMOVED.**
`group_members` is the single source of truth for visibility on
every tier (anonymous and signed-in alike). "Forget a group" is
now "leave the group" — `forgetGroup` (in `lib/forgetQuestion.ts`)
fires `apiLeaveGroup(routeId)` (DELETE /api/groups/{routeId}/membership),
which drops the membership row so the group disappears from home.
The per-browser localStorage lists (`accessible_question_ids`,
`forgotten_question_ids`) and their helper functions are gone;
`lib/browserQuestionAccess.ts` keeps only the creator-secret +
seen-options helpers (and a one-time module-load cleanup that
removes the two orphaned keys from existing installs). The
`accessible_question_ids` field is still accepted on the
`POST /api/groups/mine` body (older client bundles still send it)
but the server ignores it entirely.

**`getMyGroups()` is membership-only — it fires `apiGetMyGroups()`
(no args) + `apiGetMyEmptyGroups()` in parallel.** There's no
localStorage list to read, no discovery-persist step, and no
accessible-polls cache freshness gate keyed on the list. The
server returns the caller's member groups from the request's
browser_id + bearer token (the `user_browsers` union covers every
linked browser for signed-in users), so the previous
"short-circuit when the local list is empty" optimization — which
had to carve out signed-in users to avoid hiding server-side
membership — is simply gone. In-flight coalescing
(`myGroupsInFlight`) still prevents per-render fetch piling.

**Pitfall: `cachedToken` in `lib/session.ts` is module-cached.**
The first call to `getSessionToken()` reads localStorage and stores
the result; subsequent calls return the cached value without
re-reading. When writing FE tests that pre-seed localStorage, the
seed must run BEFORE the page's JS imports `lib/session.ts` —
Playwright's `context.addInitScript(...)` is the correct hook,
NOT `page.evaluate(...)` after `page.goto(...)`. The latter sets
localStorage AFTER `cachedToken = null` is already memoized, and
the page sees "signed out" even with a valid token in storage.

**Passkey ceremony lessons learned the hard way (Phase D security pass).**
- **Anonymous /verify with a stashed signed-in user_id is a takeover
  vector.** `complete_registration` reads `stash.user_id` from
  `passkey_challenges` and uses it as the binding identity. If the
  router accepts the verify call without an Authorization header
  AND the stash was created by a signed-in /options call, the
  credential gets bound to the original user AND a session is issued.
  Sign-out can be reversed by completing an in-flight ceremony. Fix:
  in the anonymous branch, require `stash.user_id` to belong to a
  user with NO existing `user_identities` rows (i.e. the fresh mint
  from the anonymous options branch). The two anonymous-create vs
  signed-in-add code paths converge on the same `complete_registration`,
  so the gate has to discriminate by stash state, not by request shape.
- **Existing credentials must be rejected at /registration/verify.**
  The OS prompt at the anonymous "Create account with a passkey" path
  doesn't filter out credentials already known to the RP — the
  `exclude_credentials` list is empty for a fresh user_id. A user can
  pick their existing passkey and the server's `ON CONFLICT (credential_id)
  DO UPDATE` would silently rebind it to the freshly-minted (orphan)
  user_id while `user_identities` (ON CONFLICT DO NOTHING) keeps the
  original. Result: tables desync; sign-in resolves to the original
  user via `user_identities`, but `passkey_credentials.user_id` points
  at the orphan; the original user can't manage their own credential.
  Fix: SELECT `passkey_credentials` by credential_id BEFORE the INSERT;
  if it exists, raise PasskeyError("already registered, sign in
  instead"). Drop the ON CONFLICT DO UPDATE — the unique constraint
  becomes the concurrency guard.
- **Don't `_consume_challenge` before verifying.** The original code
  DELETE...RETURNINGed the challenge atomically up front, then ran
  parse + verify. A failing verify (garbage credential, signature
  mismatch, replay attempt) consumed the challenge along with the
  legitimate user's chance to retry. Combined with X-Browser-Id being
  exposed in every response header (intentional for cross-tab
  adoption), an attacker can DoS sign-in by spamming /verify with
  garbage under the victim's browser_id. Fix: split into
  `_peek_challenge` (read only) + `_delete_challenge` (called after
  verify succeeds). Failing verify leaves the challenge for the
  user's retry within the 5-minute TTL. The challenge predicate on
  the delete (`AND challenge = %(c)s`) handles the rare two-ceremony
  race where the user restarted /options between peek and delete.
- **Catch `WebAuthnException`, not just `Invalid*Response`.** The
  webauthn library raises `InvalidJSONStructure` / `InvalidCBORData`
  / `InvalidAuthenticatorDataStructure` etc. as siblings of
  `InvalidRegistrationResponse`. Catching only the latter lets
  malformed input produce a 500 instead of a clean 400. The base
  class `WebAuthnException` is the right catch surface for both
  registration and authentication verify call sites.
- **clearSession must invalidate `accessiblePollsCache`.** Sign-out
  drops the session token but leaves the in-memory polls cache from
  the signed-in fetch. Combined with `[].every(x=>set.has(x)) === true`
  making an empty `accessibleQuestionIds` list satisfy the cache
  freshness check, the anonymous post-sign-out path serves the
  signed-in-fetched groups for up to the 60s TTL — a privacy leak.
  `saveSession` and `clearSession` in `lib/session.ts` both call
  `invalidateAccessibleCacheLazy()` (lazy `require()` to dodge any
  circular-import surface).
- **Last-identity safeguard on passkey delete.** A user who created
  an account via anonymous passkey registration (no email, no OAuth)
  can otherwise delete their only credential via Settings and lock
  themselves out — the user row stays but no path back in exists.
  `delete_user_passkey` checks `SELECT 1 FROM user_identities WHERE
  user_id = ... AND NOT (provider = 'passkey' AND provider_user_id
  = the-one-being-deleted)` and 400s when nothing else remains.
- **`PASSKEYS_DISABLED=1` must gate ALL passkey endpoints, not just
  registration/auth.** The kill switch model mirrors OAuth's
  `google_configured()` / `apple_configured()` 503 pattern — but only
  if every endpoint calls `_require_passkey_configured()`. The
  management trio (list / delete / rename) is easy to forget; doing
  so means an operator's kill switch leaves the dangerous
  delete/rename surface alive.
- **Delete the paired `user_identities` row when deleting a
  passkey.** `delete_passkey` removes the `passkey_credentials` row;
  `delete_user_passkey` (the route handler) additionally deletes the
  matching `('passkey', credential_id)` `user_identities` row. Leaving
  it orphans an identity record that would (silently) participate in
  future `resolve_or_merge_user` lookups if the same credential_id is
  ever re-registered (cryptographically improbable, but the orphan
  shows up in `GET /api/auth/me`'s `providers` array if anything ever
  joined to it).

**Passkey FE/integration test — `tests/e2e/specs/passkey-ceremony.spec.ts`.**
`server/tests/test_passkeys.py` stops short of a real attestation/assertion
(needs a fake authenticator); the E2E spec closes that gap by driving a
genuine register + usernameless sign-in through the live FE + API with
Chromium's CDP virtual authenticator, so the actual `py_webauthn` verifier
runs against real bytes. Hard-won setup details:
  - **Virtual authenticator via CDP**: `client = await context.newCDPSession(page); await client.send('WebAuthn.enable'); await client.send('WebAuthn.addVirtualAuthenticator', { options: { protocol:'ctap2', transport:'internal', hasResidentKey:true, hasUserVerification:true, isUserVerified:true, automaticPresenceSimulation:true }})`. `transport:'internal'` is load-bearing — it's what makes `isUserVerifyingPlatformAuthenticatorAvailable()` return true, which the FE requires before surfacing the "Create an account with a passkey" affordance (`platformPasskeySupported()` in `lib/passkeys.ts`). `hasResidentKey:true` makes the credential discoverable, required for the usernameless sign-in (no `allowCredentials`). Install it BEFORE `page.goto` so the capability probe on mount sees it. Chromium-only (`test.skip(browserName !== 'chromium', ...)` — also covers the "Mobile Chrome"/Pixel project, which is still the chromium engine).
  - **Pre-hydration click drop**: the settings page is a client component; a `.click()` on "Sign in" that lands before React attaches the onClick is silently swallowed (React doesn't replay it), so the modal never opens and a single click can no-op forever. Fix is a retry-open helper that re-clicks until a modal-only element (the `you@example.com` placeholder) is visible, guarded by an `isVisible()` check so it never re-clicks the now-backdrop-covered button. This bites ANY E2E flow whose first interaction is a click on a freshly-loaded client-component page — not just passkeys.
  - **rp_id comes from the request `Origin`** via `services/fe_origin.py`'s allowlist (`localhost:<port>`, `127.0.0.1:<port>`, `*.dev.whoeverwants.com`, prod/canary). The browser requires rp_id to be a registrable suffix of the page origin, so the test only works against an allowlisted host; an unlisted host falls back to `whoeverwants.com` and the ceremony fails the rp_id check. Both localhost and any branch dev URL work.
  - **Assert sign-in via `localStorage.getItem('session_token')`** (written synchronously by `saveSession` when the verify response lands) rather than UI state — it's race-free vs React re-render. `WebAuthn.getCredentials` confirms a credential was actually minted. `getByText('Sign-in methods', { exact: true })` (non-exact also matches the delete-account copy → strict-mode error).
  - **NOT in CI** (CI runs only vitest + lint). Run manually against a live stack: `BASE_URL=https://<slug>.dev.whoeverwants.com npx playwright test --config=tests/e2e/config/playwright.config.ts passkey-ceremony --project=chromium`.
  - **Validating an E2E spec from the sandbox** (no local browser): mirror the spec into a core-`playwright` (not `@playwright/test`) script and run it on the prod droplet, which has `playwright` + Chromium installed (same as `scripts/screenshot.sh`), pointed at the branch dev URL. Place the script INSIDE `/root/whoeverwants` (not `/tmp`) so `require('playwright')` resolves the repo's `node_modules`; ship it via base64 (`echo '<b64>' | base64 -d > …`) to dodge quote-escaping. Core playwright has no bundled `expect`, so replace `expect.poll`/`toPass` with manual poll loops — the selectors, CDP calls, and ceremony are otherwise identical.

**Identity tables (migration 112):**
- `users(id)` — one row per real person.
- `user_identities(provider, provider_user_id, user_id, email)` — one row
  per provider account. `provider ∈ {email, apple, google, passkey}`.
  `provider_user_id` = normalized email for `email`, OAuth sub for
  Apple/Google, credential id for passkey. PK is `(provider,
  provider_user_id)`.
- `user_browsers(browser_id PK, user_id)` — bridges a browser_id to a
  user_id. PK on browser_id means one browser ↔ one user at a time;
  re-sign-in as a different user `ON CONFLICT (browser_id) DO UPDATE`s.
- `sessions(token_hash PK, user_id, browser_id, expires_at)` — opaque
  bearer tokens, sha256-hash-only storage; raw token returned to the
  FE exactly once at issue time. 90 day expiry, no sliding refresh.
- `magic_link_tokens(token_hash PK, email, expires_at, used_at)` —
  15-minute single-use email verification tokens. Same sha256-only
  storage as sessions. Consumed atomically via
  `UPDATE … SET used_at = NOW() WHERE used_at IS NULL AND expires_at > NOW() RETURNING email` —
  two simultaneous clicks both run the UPDATE; only one row gets
  returned.

**`IdentityMiddleware` (`server/middleware.py`)** resolves
`Authorization: Bearer <token>` into `request.state.user_id`.
Anonymous requests (no header) skip the DB entirely — adds zero cost
for the not-signed-in path. Three accessors expose intent at the
callsite: `session_token_from_request`, `user_id_from_request`,
`actor_id_from_request` ("user_id when present, else browser_id" — the
canonical identity going forward).

**`services/auth.py` is the single home for identity logic.** Routers
import `resolve_or_merge_user` / `issue_session` /
`link_browser_to_user` / `consume_magic_link` etc. and never
re-implement them. When Phase C/D adds Apple/Google/passkey, those
routers will do provider-specific token verification and then hand off
to the same helpers — keeping the account-merge + session-issuance
rules in one place. Account merge happens via the email lookup in
`resolve_or_merge_user`: same verified email arriving from a second
provider links to the existing user_id rather than minting a new one.
No user-facing consent prompt — proof of email control on both ends is
the merge authority.

**Magic-link URL is host-derived from the request Origin** with
allowlist validation in `routers/auth.py: _ALLOWED_ORIGIN_PATTERNS`.
Prod → `https://whoeverwants.com`, canary → `https://latest...`, dev
branch → `https://<slug>.dev.whoeverwants.com`. Origin missing /
unmatched falls back to `FE_DEFAULT_ORIGIN` (defaults to
`whoeverwants.com`). When adding a new tier or external embed, extend
the allowlist.

**Email provider: Resend.** `services/email.py` POSTs to
`api.resend.com/emails` via httpx (no SDK dep). `RESEND_API_KEY` env
var on each tier's `.env.api`; without it, `send_email` logs the
message to stdout and returns success so dev tiers work zero-config
(magic links surface in `/repo/api.log`). `RESEND_FROM_EMAIL` (default
`noreply@whoeverwants.com`) must be on a Resend-verified domain.

**FE session storage: `lib/session.ts`.** localStorage-backed (works on
iOS Capacitor WebView and survives app updates; Keychain via
`@capacitor/preferences` is a Phase I upgrade). Cached profile +
session token; `SESSION_CHANGED_EVENT` for cross-component
reactivity. `lib/api/_internal.ts: fetchWithBase` attaches
`Authorization: Bearer <token>` on every request and auto-clears local
session state on 401 (so a server-side revoke propagates without a
manual sign-out tap).

**`apiVerifyMagicLink(token)` writes the session on success** via
`saveSession(token, user)`. Callers don't need to handle the storage
side. `apiGetMe()` returns null + clears local state on 401 to keep
the UI honest when the server says the session is gone.

**Account-tied display name (migration 118).** The per-browser local
display name (`lib/userProfile.ts`, localStorage `whoeverwants_user_name`)
is mirrored to an account-level `users.display_name` once signed in, so
it follows the user across devices. Wiring:
- Server: `users.display_name` (nullable); `name` on `UserSummary` (so it
  rides every sign-in response + `/api/auth/me`); `POST /api/auth/me/name`
  (`{name: str|null}`, signed-in-only, validated by the shared
  `validate_user_name`; null/empty/whitespace clears it).
  `services.auth.update_user_display_name` is the writer.
- `SessionUser.name` (`lib/session.ts`, optional so pre-118 cached
  profiles deserialize).
- **`saveUserName` is the single FE chokepoint**: after writing localStorage
  it lazily imports `lib/api/auth` and calls `pushLocalNameToAccount` (no-op
  when signed out / when the account already has that value). So every
  name-entry surface (settings Save, `NameRequiredModal`, vote/create name
  saves) propagates to the account without each callsite knowing about
  accounts. `saveUserNameLocalOnly` is the no-account-sync variant the auth
  layer uses to mirror account→local without echoing back.
- **`persistSignIn` (`lib/api/auth.ts`)** is the shared reconcile funnel for
  EVERY sign-in path (magic link, OAuth, both passkey paths — replaced the 4
  bare `saveSession` calls): account has a name → mirror it to local BEFORE
  `saveSession` (so SESSION_CHANGED listeners read it); account has none →
  seed it from the local name.
- **Settings page reflects sign-in live.** On a `user_id` transition
  (`prevUserIdRef`), the account name authoritatively overwrites the name
  field (even over an unsaved edit); if the account has no name but the field
  does, the field value is tied to the account. Incidental same-user
  SESSION_CHANGED events use the gentle, edit-preserving path. Without the
  transition gate the field only updated when "clean", so signing into a
  named account required a manual refresh.
- **Pitfall: the settings name field only persists to localStorage on
  *Save*.** So "type a name, then create a passkey account" left the account
  nameless — `persistSignIn`'s seed read `getUserName()` = null. The
  settings-page tie (field value → account on a sign-in transition) is the
  backstop for that flow; the seed alone isn't enough for typed-but-unsaved
  names. The auth layer can't see the React field state, so this MUST live in
  the settings component.
- **Don't reconcile on `apiGetMe`.** It's a passive refresh, not a sign-in;
  overwriting local on every `/me` would surprise and isn't required.
  Cross-device name changes surface on the next real sign-in instead.

**Cross-device sign-in.** Magic link clicked on Device B issues a
session for Device B (uses the verify request's browser_id, NOT the
one stored on the magic_link_tokens row from the request). The stored
browser_id is for fraud detection only. Document the limitation that
dev-branch URLs aren't covered by `apple-app-site-association` — links
sent from a dev API land in Safari, not the app.

**Pitfall: `%`-formatting a SQL string with literal `%(name)s`
placeholders.** Python's `%` operator tries to substitute EVERY
`%(...)s` it sees. Inlining an interval via `sql % {"s": 60}` fails
with KeyError on `%(e)s` (still meant for psycopg's binding). Use
`%(window)s::interval` with the value passed through the bind params
dict (`{"window": "60 seconds"}`) — see
`services/auth.py: email_throttled`.

**Pitfall: bootstrap-marker race + migration apply on dev upserts.**
The dev container's per-branch volume persists `/repo/.dev-server-ready`
across container recreations, so the next `apply_dev_migrations` step
in `dev-server-manager.sh: cmd_upsert` runs immediately after launch.
This is normally fine, but the webhook-driven upsert ran fast (~900ms)
and migration 112 didn't apply — manually re-running
`bash /opt/scripts/dev-server-manager.sh upsert <branch>` did apply
it. When testing a new migration on dev, verify `_migrations` table
contents directly; don't trust upsert completion alone. If migration
doesn't appear, fire the upsert manually before debugging the
migration content.

**Phase C (Apple + Google OAuth on web) is wired through three layers:**

1. **Server verifier (`server/services/oauth.py`).** `verify_google_id_token(id_token)` and `verify_apple_id_token(id_token)` validate the JWT against the provider's JWKS (signature + iss + aud + exp + required claims) and return an `OAuthIdentity{provider, provider_user_id, email, email_verified}`. Uses `PyJWKClient` (from the existing `pyjwt[crypto]` dep) — keys are fetched and cached per process; rotation is transparent. Algorithm is pinned to `RS256` for both providers so a hostile token can't switch families. (Apple's Sign In with Apple docs reference ES256 but the live JWKS at `https://appleid.apple.com/auth/keys` publishes ONLY RS256 keys — Apple issues RS256-signed ID tokens in practice. The original `ES256` pin produced `400 "The specified alg value is not allowed"` on every real Apple sign-in attempt; verified empirically with `curl https://appleid.apple.com/auth/keys`. If you ever need to widen the algorithm list for a new provider, run this curl-and-grep against their JWKS first rather than trusting their docs.) Email is only surfaced as the merge key when `email_verified` is true (Google sends boolean, Apple sends string "true" — both branches accepted; anything else → `email=None`, but the sub-based identity still resolves).
2. **Server endpoints (`server/routers/auth.py`).** `POST /api/auth/oauth/google` and `POST /api/auth/oauth/apple` accept `{id_token}`, verify, then route through the shared `_sign_in_via_oauth` helper which calls `resolve_or_merge_user` → `link_browser_to_user` → `issue_session` (same three-step rhythm as magic-link verify). Returns the same `SessionResponse` shape so the FE doesn't branch by provider. `GET /api/auth/providers` reports `{email, google, apple}` capability booleans driven by `google_configured()` / `apple_configured()` — both gate the verify endpoints with 503 when the corresponding `*_AUDIENCES` env var is unset.
3. **FE (`lib/oauth.ts` + `lib/api/auth.ts` + `components/SignInModal.tsx`).** SDK loaders for Google Identity Services + Apple JS are module-level memoized promises (concurrent modal opens share one fetch). Google renders its own branded button into a `ref`'d container via `google.accounts.id.renderButton` — required by their branding guidelines and the only way to get reliable popup-based credential delivery. Apple uses a custom-styled button that calls `AppleID.auth.signIn()`. `SignInModal` queries `apiGetAuthProviders()` on every open and hides each OAuth button when EITHER the client bundle (NEXT_PUBLIC_*_CLIENT_ID env var) OR the server tier (`*_AUDIENCES`) isn't configured — both must agree before the button surfaces.

**Configuration: each provider needs matching env vars on BOTH sides.** Drop these into the API droplet's `.env.api` AND the Vercel project's environment variables to enable each button. Without them, the buttons hide silently:

  * Google: `GOOGLE_OAUTH_CLIENT_IDS` (server, comma-separated to accept web + iOS audiences) + `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (FE web client ID).
  * Apple: `APPLE_OAUTH_AUDIENCES` (server, comma-separated for web Service ID + iOS bundle ID) + `NEXT_PUBLIC_APPLE_OAUTH_SERVICE_ID` (FE Service ID) + `NEXT_PUBLIC_APPLE_OAUTH_REDIRECT_URI` (optional; defaults to the current origin).

**Cross-provider account merge "just works" via the shared verified-email lookup in `resolve_or_merge_user`.** A user who signed in with magic link first (email identity) and later signs in with Google using the same verified email lands on the SAME `user_id` — the second sign-in adds a `user_identities` row for `provider='google'` pointing at the existing user. `/api/auth/me` then reports `providers: ['email', 'google']`. Apple "Hide my email" relay addresses (`<token>@privaterelay.appleid.com`) are stable per (user, RP) and are treated identically to real emails for the merge — same address every time, so repeat sign-ins resolve.

**Capacitor iOS gets native Apple Sign In via `@capgo/capacitor-social-login`; Google stays web-only for now.** `lib/oauth.ts: appleSignIn()` dispatches at runtime: native iOS calls `SocialLogin.login({provider: 'apple', ...})` (dynamic-imported, matches the `lib/pushNotifications.ts` / `lib/geolocation.ts` chunk-keeps-out-of-web-bundle pattern); web/PWA loads Apple's `appleid.auth.js` SDK and runs the popup flow. Both surfaces return an `id_token` (Apple calls it `identityToken` on native; capgo surfaces it as `result.idToken`) which the FE POSTs to the same `/api/auth/oauth/apple` endpoint — the server's JWKS verifier doesn't care which surface produced it. **Apple `aud` claim differs by surface**: web flow's audience is the Service ID, native iOS's audience is the bundle id (`com.whoeverwants.app` for prod, `com.whoeverwants.app.latest` for canary). The server's `APPLE_OAUTH_AUDIENCES` env var must therefore include the Service ID AND both bundle ids comma-separated. The native bundle id is read at runtime via `App.getInfo().id` from `@capacitor/app` and passed to `SocialLogin.initialize({apple:{clientId, redirectUrl}})` so prod + canary IPAs each send their own value; missing lookup falls back to `com.whoeverwants.app`. **`redirectUrl` IS used by the capgo plugin** — even though the plugin authenticates via `ASAuthorizationController` (the native Apple ID sheet), it ALSO GETs the URL during `initialize()` AND POSTs to it AFTER the user authenticates, expecting specific response shapes: **GET → 2xx, POST → 302 redirect (300–399) with a Location whose query string includes `success=true` AND one of `ios_no_code=1` / `code`+`client_secret` / `access_token`+`refresh_token`+`id_token`**. Any other response triggers `Error: Invalid response code: NNN.` (wrong status) or `Error: Path components not found.` (302 with no/wrong query params) and rejects the whole sign-in. Our flow uses `ios_no_code=1` since the id_token already came via Apple's native delegate — no server-side code exchange needed; the plugin then resolves with that JWT and the FE POSTs it to `/api/auth/oauth/apple` for real verification. The dedicated Next.js route handler is at `/auth/apple/callback` (`app/auth/apple/callback/route.ts`): `GET` returns 200 JSON, `POST` returns 302 to itself with `?success=true&ios_no_code=1`. `lib/oauth.ts` passes `${window.location.origin}/auth/apple/callback` as `redirectUrl`. The handler is a stub — actual id_token verification happens at `/api/auth/oauth/apple` after the plugin hands the token to our JS. Falls back to `https://whoeverwants.com/auth/apple/callback` when window is absent (defensive — this code path only runs in the iOS WebView). **History of failed attempts before finding the GET 2xx / POST 302 contract:** (1) hardcoded `https://whoeverwants.com/auth/verify` → 404 (route doesn't exist on prod tier); (2) bare `window.location.origin` → 405 (Vercel's static root only accepts GET); (3) `/auth/apple/callback` returning 200 on both → "Invalid response code: 200" (plugin's POST handler insists on a redirect); (4) `/auth/apple/callback` POSTing 302 with empty query → "Path components not found" (plugin's URL-parsing branch requires `success=true` + a completion path flag). All failures only surfaced after three preceding PRs cleared every layer of obscurity in the client log forwarder (#436 diagnostic logs, #437 fetch keepalive replacing broken sendBeacon, #438 stdout mirror for cross-worker visibility). The init promise is module-memoized so concurrent modal opens share one round-trip; the failing branch clears the memo so the next call can retry. **Native Google Sign In on iOS uses the same `@capgo/capacitor-social-login` plugin as Apple.** `googleConfigured()` returns true on native (trust-the-pipeline pattern matching Apple); the SignInModal branches on `isNativeIOS()` to render a custom-styled button (Google's web SDK can't load — `accounts.google.com/gsi` 403s with `disallowed_useragent` in WebViews) that calls `googleSignIn()` → `googleNativeSignIn()` → `SocialLogin.login({provider: 'google', ...})`. Per-bundle iOS client IDs live in `lib/oauth.ts: GOOGLE_IOS_CLIENT_IDS` (committed — they're public values baked into `Info.plist` anyway); the bundle id from `App.getInfo()` picks the right one at init time. The reversed-URL scheme (`com.googleusercontent.apps.<num>-<hash>`) is stamped into `Info.plist: CFBundleURLTypes` by `ios-build.yml` from `GOOGLE_IOS_CLIENT_ID_{PROD,LATEST}` GitHub secrets — derived via `awk -F. '{...}'` reversal, not stored separately. Server's `GOOGLE_OAUTH_CLIENT_IDS` must include the web client AND both iOS clients comma-separated. Magic link remains available on every surface as fallback. **Apple Developer manual prereq (one-time per bundle id):** enable "Sign In with Apple" capability on `com.whoeverwants.app` AND `com.whoeverwants.app.latest` in the Apple Developer portal → Identifiers → <bundle> → Capabilities. The entitlement (`com.apple.developer.applesignin`) in `App.entitlements` compiles without the portal toggle, but iOS silently rejects the authorize call. **Plugin choice rationale:** `@capacitor-community/apple-sign-in` is the more obvious pick from the name, but its 7.1.0 release pins `capacitor-swift-pm` to v7.x while `@capacitor/push-notifications@8` pins it to v8.x — SPM rejects the dependency graph at archive time with `Failed to resolve dependencies ... 'apple-sign-in' depends on 'capacitor-swift-pm' 7.0.0..<8.0.0 and 'push-notifications' depends on 'capacitor-swift-pm' 8.0.0..<9.0.0`. `@capgo/capacitor-social-login` is the only mainstream Apple+Google plugin with a Capacitor-8-compatible major release line; the swap costs a slightly different result shape (`res.result.idToken` vs `res.response.identityToken`) which is contained to `lib/oauth.ts: appleNativeSignIn`. If a future PR lands that needs to swap back, the diff would be ~40 lines in one file.

**Pitfall: PyJWT's `audience` accepts a list but `issuer` does NOT.** `jwt.decode(..., issuer='x')` only matches a single string; Google publishes tokens with both `'https://accounts.google.com'` AND `'accounts.google.com'` as the issuer over time. `services/oauth.py: _verify` therefore decodes WITHOUT an `issuer` arg and checks `claims['iss'] in tuple_of_acceptable_issuers` manually afterward. Mirror this pattern if a third OIDC provider arrives with multiple valid issuers.

**Pitfall: testing OAuth without calling real providers.** `server/tests/test_oauth.py` monkey-patches `services.oauth._google_jwks_client` / `_apple_jwks_client` to return a fake `PyJWKClient` whose `get_signing_key_from_jwt` returns a locally-generated RSA (Google) / EC (Apple) public key. Tests then mint JWTs signed by the matching private key and drive every branch of the verifier (valid token, expired, wrong audience, wrong issuer, unverified email, repeat sign-in without email, cross-provider merge). The pattern is reusable for adding a third OIDC provider — generate the keypair once per module, patch the JWKS lookup, mint signed tokens locally.

**Pitfall: stale OAuth env vars after .env.api edit require `docker compose up -d --force-recreate api`.** The `env_file:` in `docker-compose.yml` is read only on container creation. `restart` reuses the existing container's env. Symptom: `GET /api/auth/providers` keeps reporting `google: false` even though `GOOGLE_OAUTH_CLIENT_IDS` is in `.env.api` because the running process's `os.environ` doesn't see the new value. Same idiom as the APNS env-var rule (see Push Notifications section).

**Phase E (group privacy) shipped in migration 114.** Adds
`groups.privacy` (`'public' | 'private'`, default `'private'`,
existing rows backfilled to `'public'`) + `groups.creator_user_id`
(nullable FK to `users(id)`). Signed-in creators get
`privacy='private'` + `creator_user_id=user_id` at create time;
anonymous creators always get `privacy='public'` + null
`creator_user_id`. Three reads gate on privacy:
`/api/groups/by-route-id/{id}` (full polls list),
`/api/groups/by-route-id/{id}/summary` (chrome metadata), and
`/api/groups/by-route-id/{id}/image` (avatar bytes) — all 404 to
non-members of private groups. The `/preview` endpoint stays
public (link-preview crawlers need it). `services/groups.py:
filter_visible_polls` is unchanged in shape; the privacy
enforcement happens upstream: the routers call
`is_caller_member_of_group` + return 404 directly for private +
non-member. (The legacy `accessible_question_ids` bridge that this
used to filter to public-only is gone — `group_members` is the
sole visibility authority now.) `grant_group_membership_inline`
gained an optional `privacy=` kwarg — passing `'private'` makes it
a no-op so the read endpoint doesn't auto-join non-members onto a
private group.

`POST /api/groups/{route_id}/privacy` (signed-in, creator-only)
flips a group's privacy. Authorization is strict: must be signed
in (`401`), `creator_user_id` must match the session's `user_id`
(`403`), and groups without a recorded creator (anonymous-created
or grandfathered) can't be flipped (`403`). The toggle is the
escape hatch for signed-in users during the Phase F/G gap — a
brand-new signed-in user creates a private group, realizes they
can't share it yet, and flips public via /info. Phase I will add
"claim an anonymous-created group" so legacy groups can also be
flipped.

FE wiring:
- `Group.privacy` + `Group.creatorUserId` on the canonical `Group`
  type (`lib/groupUtils.ts`); built from `latestPoll.group_privacy`
  + `latestPoll.group_creator_user_id` for populated groups, or
  from `GroupSummary` for empty groups.
- `Poll.group_privacy` + `Poll.group_creator_user_id` on every
  `Poll` (`lib/types.ts`); sourced from `_SELECT_POLLS_WITH_GROUP`'s
  JOIN. Tolerates absence on synthesized placeholder polls.
- `GroupSummary.privacy` + `GroupSummary.creator_user_id` on the
  summary type (used by /summary, /empty, and POST /api/groups).
- `apiUpdateGroupPrivacy(routeId, 'public' | 'private')` in
  `lib/api/groups.ts`. Invalidates every cached poll in the group
  (each carries `group_privacy`) via the existing
  `invalidateGroupPolls` helper.
- `components/GroupPrivacySection.tsx` renders on /info above the
  notification settings card: shows the current privacy state,
  exposes the toggle to the creator (and only when signed in), and
  shows a passive "Sign in to create private groups" CTA to
  anonymous viewers on public groups. Subscribes to
  `SESSION_CHANGED_EVENT` so the toggle's visibility tracks
  sign-in / sign-out without a remount.

**Pitfall: privacy state is per-group, not per-poll, but surfaces on
every PollResponse via JOIN.** When adding a new field to the
`groups` table, extend `_SELECT_POLLS_WITH_GROUP` AND
`_attach_group_fields` (the latter is the RETURNING* fallback for
INSERT/UPDATE paths that don't go through the JOIN). Forgetting
the second results in newly-created polls returning the new field
as null until a fresh SELECT runs.

**Pitfall: the auto-join in `grant_group_membership_inline` must
not write a row for private groups.** Without the gate, a stranger
hitting `/by-route-id/<privateGroup>` would silently join — making
"private" no more restrictive than "public". The router gates on
privacy BEFORE calling the helper, so the read returns 404 cleanly
without a write; the helper's own `privacy='private'` short-circuit
is belt-and-suspenders in case any future caller invokes it
without doing the upstream check.

**Pitfall: `is_caller_member_of_group` must walk `user_browsers` to
union memberships across linked browsers** — same pattern as
`load_user_visibility`. Without it, a user who signed in on
Device B sees private groups they joined on Device A as 404
because their B-browser doesn't have a `group_members` row. The
helper mirrors the visibility query's `OR browser_id IN (SELECT
... FROM user_browsers WHERE user_id = ...)` clause.

**Open phases (see `docs/auth-access-model.md`):**
- D: Passkey (WebAuthn). **Shipped.**
- E: `groups.privacy` column, new groups default private. **Shipped.**
- F: `group_join_requests` + push notification to creator. **Shipped.**
- G: `group_invites` with single + multi-use modes and optional
  target_poll_id. **Shipped.**
- H: ~~per-vote anonymity~~ **NOT PLANNED.** Voters can already submit
  without a name (existing `voter_name` nullability); no per-vote on/off
  toggle is on the roadmap.
- I (account settings — **shipped**): linked-identities display +
  add-recovery-email + delete-account (migration 118). See "Phase I"
  below. Still deferred within I: "claim an anonymous-created group" so
  legacy `creator_user_id` can be set after-the-fact, enabling
  privacy-flip on grandfathered groups.
  - **Account-owned poll authorship — SHIPPED (migration 122).** Polls
    now record `creator_user_id` (the signed-in creator's user_id; NULL
    for anonymous-created polls), mirroring `groups.creator_user_id`.
    The shared `_authorize_poll` chokepoint in `routers/polls.py`
    (close / reopen / cutoff-suggestions / cutoff-availability) is
    **additive**: a mutation is authorized if EITHER the session's
    `user_id` matches the poll's `creator_user_id` (account path — works
    on any device the creator is signed in on, no per-browser secret
    needed) OR the request's `creator_secret` matches (the sole
    authority for anonymous polls + a backwards-compatible fallback for
    the signed-in creator's original browser). So `creator_secret` is
    **NOT retired** — it still exists and is still written on every poll
    — but it's no longer the ONLY authority, and the cross-device gap it
    left is closed for signed-in creators. The four poll-mutation
    request models' `creator_secret` became `str | None = None`; the FE
    sends an empty secret from a device without one and the bearer token
    authorizes. FE gating goes through `isPollCreatedByViewer(poll,
    anchorQuestionId)` in `lib/browserQuestionAccess.ts` (secret-OR-
    session, mirroring the server). The avatar "creatorIsMe" check
    (`app/g/[groupShortId]/p/[pollShortId]/page.tsx`) and the create-poll
    30s duplicate-redirect dedup (`getCreatorSecret(existing.id)`) are
    display / double-submit concerns and intentionally still use the
    per-browser secret — they're not authorization. **Still genuinely
    deferred**: fully removing `creator_secret` (needs a "claim
    anonymous poll" flow first, like the group equivalent), and "edit
    poll/question" (title/options) — there is no poll-edit-mutation
    endpoint today, so the TODO's "edit" reduces to the four
    close/reopen/cutoff endpoints. Tests:
    `server/tests/test_poll_authorship.py`.
- C-follow-up: ~~native Google Sign In on iOS~~ **shipped** (per-bundle iOS client IDs hardcoded in `lib/oauth.ts: GOOGLE_IOS_CLIENT_IDS`; reversed URL scheme stamped into `Info.plist: CFBundleURLTypes` by `ios-build.yml`; uses the same `@capgo/capacitor-social-login` plugin as Apple native).

**Phase I (account management) shipped in migration 118.** Adds a
nullable `magic_link_tokens.user_id` (ON DELETE CASCADE) that tags a
magic-link token as a recovery-email-ATTACH token rather than a
SIGN-IN token. The two flows are kept uncrossed by predicate:
`consume_magic_link` (sign-in) adds `AND user_id IS NULL`;
`peek_recovery_email_token` / `consume_recovery_email_token` (attach)
add `AND user_id IS NOT NULL`. Three new auth endpoints + a delete:
  * `POST /api/auth/recovery-email/request {email}` — signed-in only
    (401 anon). Rejects (400) accounts that ALREADY have an 'email'
    identity (adding a 2nd email is out of scope — recovery email is for
    passkey-only / OAuth-only accounts that lack one). Mints a
    user_id-tagged token + sends "confirm recovery email" via
    `send_recovery_email`. Throttled (reuses `email_throttled`) — a
    throttled request still returns 202 accepted (no leak).
  * `POST /api/auth/recovery-email/verify {token}` — requires BOTH
    proofs: the token (email control) AND a signed-in session whose
    user_id matches the token's user_id (account control, else 403).
    The token is PEEKED, not consumed, until both checks pass — a
    wrong-device click (403) or already-taken email (409) leaves it
    usable for a correct retry within its TTL. Returns the refreshed
    `UserSummary` (no new session issued). FE landing page:
    `app/auth/recovery-email/page.tsx` (distinct from `/auth/verify`).
  * `DELETE /api/auth/me` — signed-in only. Single
    `DELETE FROM users WHERE id=...`; every users(id) FK declared in
    migrations 112–117 CASCADEs (sessions, identities, browser links,
    passkeys, this user's join requests + invites, recovery tokens) or
    SET NULLs (`groups.creator_user_id`,
    `group_join_requests.decided_by_user_id`). `group_members` is
    browser-keyed (no user_id col) so the browser keeps its memberships
    + poll creator_secrets and reverts to anonymous. 204.
  * `attach_email_identity(conn, user_id, email)` returns
    `'attached' | 'already_linked' | 'conflict'`. Conflict spans ALL
    providers: an email another user proved via Google can't be claimed
    here as a sign-in email. Idempotent on re-attach (already_linked).

  **`fetchWithBase` now returns `undefined` on HTTP 204** (was an
  unconditional `res.json()`, which throws "Unexpected end of JSON
  input" on an empty body). Fixes a latent issue for every `<void>`
  DELETE/POST endpoint (sign-out, delete-passkey, delete-account).

  FE: `apiRequestRecoveryEmail` / `apiVerifyRecoveryEmail` /
  `apiDeleteAccount` in `lib/api/auth.ts`. Settings page (`app/settings/page.tsx`)
  gains: a "Sign-in methods" row listing linked providers
  (`formatProviders`), an "Add a recovery email" affordance (gated on
  `currentUser && !providers.includes('email')`), and a red "Delete
  account" button → `ConfirmationModal`. `apiVerifyRecoveryEmail`
  updates the cached session user so the new 'email' provider surfaces
  everywhere; `apiDeleteAccount` clears local session (fires
  `SESSION_CHANGED_EVENT` → settings reverts to anonymous without a nav).
  Tests: `server/tests/test_account_management.py` (15 tests).

**Phase F (group join requests) shipped in migration 115.** Adds
`group_join_requests(id, group_id, requester_user_id, message,
status, requested_at, decided_at, decided_by_user_id)` with status
in `('pending', 'approved', 'denied', 'cancelled')`. A partial
unique index on `(group_id, requester_user_id) WHERE
status = 'pending'` enforces "one open request per (group, user)"
without blocking re-requests after a denial. Three endpoints in
`routers/groups.py`:
  * `POST /api/groups/<route_id>/join-requests` (body `{message?}`)
    — signed-in caller. Returns 200 + status discriminator
    (`pending` | `already_pending` | `already_member`). 401
    anonymous, 404 unknown group. Idempotent via the partial
    unique index — second call doesn't re-fire the creator push.
  * `GET /api/groups/<route_id>/join-requests` — creator-only.
    Returns pending oldest first, with `requester_email` joined
    in (NULL for passkey-only requesters). 401/403/404.
  * `POST /api/groups/<route_id>/join-requests/<id>/decide` (body
    `{action: 'approve' | 'deny'}`) — creator-only. Approve writes
    a `group_members` row keyed on the requester's
    earliest-linked `user_browsers.browser_id` (one row is enough
    — `load_user_visibility`'s user-aware lookup expands to every
    linked browser). Deny just walks the status. Returns 200 on
    transition, 404 on cross-group / already-decided / unknown
    request_id. The route_id + request_id pairing is enforced
    server-side: a creator of group A can't decide on a request
    that belongs to group B even with a guessed request_id.

`services/join_requests.py` is the single home for the three
operations (`create_join_request`, `list_pending_requests`,
`decide_request`) + the membership-or-creator short-circuit. The
membership write on approve uses the same `ON CONFLICT (group_id,
browser_id) DO NOTHING` pattern as the auto-join paths so an
existing membership row keeps its original `joined_at` watermark.

Push fan-out: `services/push.py: fan_out_join_request(group_id,
creator_user_id, payload)`. Walks `user_browsers WHERE user_id =
creator_user_id` (NOT group_members) — the creator might have
requested notifications on Device A and be looking at Device B
when the request lands. Gated on the per-group `notify_new_poll`
pref so muting a group still mutes join-request noise. Shares
`_dispatch_pushes` with `fan_out_new_poll` (the send + record-
outcomes loop is identical) — extracted on this PR so adding a
third event type doesn't fork the loop.

FE: `apiCreateGroupJoinRequest`, `apiListGroupJoinRequests`,
`apiDecideGroupJoinRequest` in `lib/api/groups.ts`. The /info page
mounts `<JoinRequestsSection groupId enabled />` when the viewer is
the recorded creator (gated on `session.user_id ===
group.creatorUserId`); the section renders nothing on an empty
pending list. The `<GroupNotFound>` 404 page accepts an optional
`routeId` prop — when signed in AND `routeId` is set, it surfaces
a "Request to join" button that POSTs to the join-request endpoint
and shows a "Request sent" / "Group not found" result. Anonymous
viewers on the same page get a "Sign in to request access" CTA
that opens `SignInModal`; signing in fires
`SESSION_CHANGED_EVENT` and the button surfaces without remount.

**Pitfall: requester-email surfaces are NULL for passkey-only
accounts.** Phase D permits accounts with no email at all
(`user_identities` carries only a passkey row). The
`requester_email` field on `GroupJoinRequest` / the list endpoint
returns null in that case; UI fallback is the literal string
"Passkey user". When adding new identity-bearing surfaces, mirror
this fallback rather than coercing the email to a placeholder
server-side — the null is the truth.

**Pitfall: the "Request to join" CTA only goes on group-level 404s,
not poll-level 404s.** `/g/<group>/p/<poll>` 404s pass through
`app/g/[groupShortId]/p/[pollShortId]/page.tsx`'s own "Poll Not
Found" branch, which is intentionally kept distinct — the user
might not need access to the whole group, they might just have a
dead poll URL. If a future request adds "request access to a
specific poll" semantics, that page is the place to mirror the
join-request CTA.

**Pitfall: my-emails normalization mismatch.** The server
normalizes emails to lowercase + trimmed via `normalize_email`
before persisting + comparing. Tests that mint an email and then
assert against `requester_email` from a response must also
normalize the expected value — or use a lowercase email to start.
The `_sign_in` test helper in `test_join_requests.py` returns the
normalized form for this reason.

**Phase G (group invite links) shipped in migration 116.** Adds
`group_invites(id, token_hash, group_id, created_by_user_id, mode,
target_poll_id, max_uses, use_count, expires_at, revoked_at,
created_at)` with a unique constraint on `token_hash`. Same
hash-only-storage pattern as `sessions` and `magic_link_tokens`:
the raw token is returned exactly once at create time and embedded
in the shareable URL; the server keeps only `sha256(token)`. A DB
leak doesn't yield usable invites.

Four endpoints across two routers:
  * `POST /api/groups/<route_id>/invites` (body: `{mode,
    max_uses?, target_poll_id?, expires_in_hours?}`) — creator-only.
    `mode='single'` forces `max_uses=1` server-side regardless of
    the body (the client's value is normalized, not rejected, so
    fewer edge cases surface in the UI). Cross-group
    `target_poll_id`s are silently downgraded to NULL — falling
    back to "land on group root" is friendlier than 400'ing on
    stale poll selection.
  * `GET /api/groups/<route_id>/invites` — creator-only. Lists
    active invites (not revoked, not expired, has remaining uses).
    Token + url are omitted from list responses — those are one-shot
    at create time. FE shows "Link only shown when first created"
    for previously-existing invites.
  * `DELETE /api/groups/<route_id>/invites/<invite_id>` —
    creator-only. Returns 204 on revoke, 404 when already revoked
    or not owned. The `created_by_user_id` check is folded into the
    UPDATE's WHERE clause so ownership + status transition happen
    atomically.
  * `POST /api/auth/invites/<token>/redeem` (lives on the auth
    router because the URL the joiner clicked has no route_id —
    just a raw token). Requires user_id (401 anonymous). 404 on
    invalid / expired / revoked / fully-used. Atomic conditional
    UPDATE on `use_count < max_uses` serializes redemptions at
    row-lock granularity — whoever wins the lock increments,
    whoever loses sees the predicate fail. Already-member redemptions
    roll back the use_count bump so a member re-clicking the URL
    doesn't consume an invite use. Returns short_ids pre-resolved
    so the FE builds the redirect URL without a second round-trip.

`services/invites.py` is the single home for `issue_invite`,
`list_active_invites`, `revoke_invite`, `redeem_invite`. The shared
FE-origin allowlist was lifted out of `routers/auth.py` into
`services/fe_origin.py: resolve_fe_origin` so both magic-link and
invite-URL minting use the same allowlist. When adding a new tier
or external embed that needs to appear in user-bound URLs, extend
`_ALLOWED_ORIGIN_PATTERNS` there.

FE: `apiCreateGroupInvite` / `apiListGroupInvites` /
`apiRevokeGroupInvite` in `lib/api/groups.ts` + `apiRedeemInvite`
in `lib/api/auth.ts`. `<InviteLinksSection>` mounts on /info next
to `<JoinRequestsSection>` (both gated on the same
`viewerIsCreator` derived from `session.user_id ===
group.creatorUserId`). The freshly-minted invite is the ONLY row
where a Copy button surfaces — `freshUrls` state holds
`{inviteId: rawUrl}` for that session only; refresh or navigate
away and the URL is gone, matching the server's
hash-only-storage. `/invite/<token>/page.tsx` is the redemption
landing page: anonymous viewers see "Sign in to continue" + the
existing `SignInModal`; signed-in viewers auto-redeem on mount via
`SESSION_CHANGED_EVENT`-driven re-fire and `router.replace` to the
destination URL (`/g/<group>` or `/g/<group>/p/<poll>` when the
invite carries a target_poll_id).

The template's fallback header gate now skips `/invite/<token>`
(`isInvitePage` flag in `app/template.tsx`) — the redemption page
renders its own full-screen UI; the template's empty top bar would
just be visual noise above it.

**Pitfall: invite list endpoint deliberately omits raw tokens.**
The list shape returns `token: null` / `url: null` for every row
because the only place the raw token exists post-creation is in
the URL the creator copied at create time. Don't add a "view
invite link" affordance — it would require either storing the raw
token (defeating the hash-only-storage model) or accepting that
re-viewing a link means minting a new invite anyway. The FE's
"Link only shown when first created" copy is the intentional
trade-off.

**Pitfall: redeem's use_count rollback is not transactional with
the membership write.** The redeem-then-rollback sequence for
already-member callers does the UPDATE → SELECT membership →
UPDATE -1 in three statements; a concurrent redeem from a
different user between statements 1 and 3 could theoretically see
the bumped count temporarily. In practice (a) the bump+rollback
happens in the same DB connection within one request,
(b) the visibility-affecting decision (already-member or not) is
final by the time the second UPDATE runs, and (c) a transient
use_count flicker is benign — the FE never sees it because the
list endpoint runs in a separate request later. If the
already-member-rollback pattern ever expands to side effects that
care about correctness (e.g. a webhook), refactor to a single
conditional UPDATE that doesn't bump in the first place when the
caller is already a member.

**Pitfall: invite URLs are origin-derived, not hardcoded.** The
`POST /api/groups/<route>/invites` response's `url` field uses
`services/fe_origin.resolve_fe_origin(request)` — same allowlist
as magic-link URLs. A request hitting the API with no recognized
`Origin` header falls back to `FE_DEFAULT_ORIGIN` (default
`https://whoeverwants.com`). For dev tiers the FE sends an
Origin like `https://<slug>.dev.whoeverwants.com` which IS on the
allowlist, so the URL embedded in the response matches what the
creator sees in their browser bar. If you add a new
`branch.api.whoeverwants.com`-style API host that takes a
different FE origin, extend the allowlist.

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
> canonical "invite someone" mechanism. Visibility is group membership
> only (the legacy `accessible_question_ids` bridge mentioned in the
> original Migration 106 note has since been fully removed —
> `group_members` is the single source of truth):
>
>   * B (or, signed in, any browser linked to B's user_id) has a
>     `group_members` row for T AND
>     (`P.is_closed = false` OR `P.closed_at >= members.joined_at`).
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
> still render its chrome (header + tappable title to /info + the
> "Create Poll" CTA). The previous "non-member with no `?p` → 404"
> rule is gone.
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
> `joined_by_group` only — `access_poll_ids` was dropped with migration
> 106, and `bridged_group_ids` (the legacy `accessible_question_ids`
> bridge) was removed when `group_members` became the single source of
> truth. `load_user_visibility` no longer takes a `legacy_question_ids`
> param, and `group_ids_for_question_ids` (which resolved that list)
> was deleted. The previously-shared `group_ids_for_poll_ids` helper is
> also gone (it only existed to fan out access-group sets).
>
> **Share button on the group info page hero**
> (`components/GroupShareButton.tsx`). Sits on its own line, centered,
> immediately below the group title in `/g/<id>/info`. Tapping
> invokes `navigator.share({title, url})` on iOS / Android, falls
> back to `navigator.clipboard.writeText` with a brief "Link copied"
> toast, then to a manual-copy `prompt()` as last resort. `AbortError`
> from a dismissed share sheet is swallowed silently. Shares the BARE
> group URL (`/g/<routeId>` with no `?p=`) — per-card copy-link
> buttons still emit `?p=<short>` URLs ("share this poll's view of
> the group"), but the access semantics are identical: both forms
> grant the recipient group membership on visit. Icon wrapper is
> `w-[46px] h-[46px]` with a `w-[20.7px] h-[20.7px]` SVG (a 15%
> bump over the original 40px/18px header version); the feedback
> toast (`Link copied` / `Copy failed`) is positioned
> `left-1/2 -translate-x-1/2 top-full` so it centers under the button
> instead of right-aligning. The button is no longer used inside
> `GroupHeader.rightSlot`; if it ever returns there, restore the
> per-instance styling at the call site rather than reintroducing a
> variant prop with a single caller (the move off the header is what
> killed the previous `large` variant abstraction).

> **Empty-group creation via `POST /api/groups`.** The home new group button
> now materializes a real group BEFORE any polls exist, so users can
> immediately name + share the group URL. Endpoints shipped:
>
>   * `POST /api/groups` — `INSERT INTO groups DEFAULT VALUES` +
>     `grant_group_membership_inline` for the caller. Returns
>     `GroupSummary {id, short_id, title, created_at}`. Requires a
>     `browser_id` (400 if missing) so the new group has a member.
>   * `POST /api/groups/empty` — every group the caller is a member of
>     that has zero polls. The membership lookup is `group_members` ∩
>     anti-join `polls`. Sorted newest-first. Pure membership — empty
>     groups always show for their members. (Same as everywhere now:
>     the legacy `accessible_question_ids` forget bridge has been
>     removed; `group_members` is the single source of truth.)
>   * `GET /api/groups/by-route-id/{id}/summary` — identity-free read
>     returning just `GroupSummary`. No membership write. Used by
>     `useGroup` (and `GroupPageInner`'s fallback chain) when
>     `/by-route-id/{id}` returns `[]` so the group page can still
>     render its header for membership-only groups.
>
> FE: `apiCreateGroup` invalidates the accessible-polls cache so the
> home list re-fetches on the next render. `getMyGroups()` in
> `lib/simpleQuestionQueries.ts` returns `{polls, emptyGroups}` and
> fires both `/mine` + `/empty` in parallel; the home page passes both
> to `GroupList` which builds them into a single list via
> `buildGroups(polls, voted, abstained, emptyGroups)`. The new group button
> (`CreateGroupButton` in `app/template.tsx`) holds an in-flight ref
> so rapid taps don't mint two groups.
>
> **`Group.isEmpty` distinguishes membership-only groups from
> populated ones.** Empty groups carry: `rootPollId/rootQuestionId/
> latestPoll/latestQuestion = null`, `polls/questions =
> []`, `groupId + groupShortId` from the GroupSummary. `getGroupHref`
> returns `/g/<routeId>` (no `?p=`). The home list passes
> `hideRespondents={true}` to GroupListItem and renders a
> `statusBadge="New group — tap to add a poll"` instead of the
> relative-time stamp. The group page (`/g/<id>`) and its sub-routes
> (/info, /edit-title) all work for empty groups via the
> `apiGetGroupSummary` fallback path in `useGroup` and
> `GroupPageInner.fetchGroup`. `GroupPageInner` carries a separate
> `isEmptyGroup` state alongside `rootPoll`: when
> `apiGetGroupByRouteId` returns `[]` but `/summary` resolves, set
> the flag, skip the per-poll fallback that would 404, and mount
> `<GroupContent>` unconditionally — its internal `useGroup` builds an
> empty Group from the summary. `rebuildGroupFromCacheOrPrev` no
> longer early-returns on `!prev.rootPollId`; it picks the first
> available poll in the group as the anchor for the empty → populated
> transition (when a placeholder/real poll lands via POLL_PENDING /
> POLL_HYDRATED).
>
> **`Group.groupTitleOverride` carries the raw `groups.title`** (or
> null) so the edit-title page input can pre-fill with the raw value
> rather than showing the computed "New Group" default. For populated
> groups it's `latestPoll.group_title`; for empty groups it's
> `summary.title`.
>
> **Current-user filter on participant names.** `buildGroups` and
> `buildEmptyGroup` filter the current `localStorage` user name
> (case-insensitive, trimmed) out of `Group.participantNames` so the
> viewer doesn't see themselves in the group's title or
> RespondentCircles graphic. When the filtered list is empty, the
> title falls through to `defaultTitle = "New Group"`. The rule
> applies uniformly:
>   * Home list: GroupListItem's title, the RespondentCircles avatar
>     (already gated via `hideRespondents` for empty groups).
>   * Group page header: `GroupHeader` skips the avatar entirely when
>     names is empty AND anonymousCount is 0 (previously rendered a
>     `?` fallback, which misrepresents an empty group as a single
>     anonymous voter).
>   * /info page is the EXCEPTION — it's the canonical roster, so the
>     viewer is ALWAYS rendered as a member. The member list adds the
>     viewer back in (with their localStorage name, or "You" when no
>     name is set — visiting any group URL auto-joins them as a member,
>     so omitting them would render "0 Members" on a group they just
>     joined). Hero avatar + title also surface the viewer in the
>     solo-member case so the page doesn't fall through to a gray
>     placeholder circle + "New Group" title; gated on a real
>     localStorage name (we don't invent a group name from "You").
>     `showViewerInHero` in `app/g/[groupShortId]/info/page.tsx` is the
>     predicate (`participantNames.length === 0 && anonymousRespondentCount === 0 && currentUserName !== null`).
>
> The legacy `/g/` empty placeholder route still exists as the home
> new group button's fallback on API failure — kept so a network blip during
> `apiCreateGroup` doesn't break the create-a-poll flow entirely.
> Once an empty group is created (the happy path), the user is
> navigated to `/g/<short_id>` rather than `/g/`.
>
> Backend tests live in `server/tests/test_empty_groups.py` (12
> tests). The existing `test_groups_api.py` + `test_groups_visibility.py`
> response shapes were NOT broken — `/api/groups/mine` still returns
> `list[PollResponse]`, the new empty-groups list is on a separate
> `/api/groups/empty` endpoint.

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
> **The forget bridge is now fully RETIRED — `group_members` is the
> sole visibility authority.** "Forget a group" is "leave the group":
> `forgetGroup` (in `lib/forgetQuestion.ts`) fires
> `apiLeaveGroup(routeId)` for the whole group. The old per-question
> "forget the last question → call apiLeaveGroup" wiring on the group
> page, the `accessible_question_ids` / `forgotten_question_ids`
> localStorage lists, and the server-side bridge in `/api/groups/mine`
> are all gone. The `accessible_question_ids` request field is kept on
> the Pydantic model (older bundles still send it) but the server
> ignores it. (Migration 106 had already collapsed the per-poll-access
> leg; the bridge was the only remaining non-membership signal, and
> it's removed too.)
>
> **Phase C.3 of the group-routing redesign shipped (#267).** (Historical
> — the legacy bridge described below has since been REMOVED; the
> visibility rule is now group-membership only.)
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
- **Internal client state can still key on question ids.** Refs (`cardRefs`), per-question cache entries (`questionCache`), and DOM keys all use question ids freely — they're stable internal identifiers, not URLs. The principle bites at the FE↔server boundary, not at internal data structures.

When designing a new feature: ask "is this a poll-level concept?" If yes, route through a poll endpoint or field; never sum/dedupe across questions in the browser.

**Status**: phasing plan in `docs/poll-phasing.md`. **Every phase shipped** (Phases 1 through 5b). The poll redesign is complete — all wrapper-level state lives on `Poll`, question data lives on `Question`, and the API contract reflects that boundary.

- **Phase 1 (schema + new API)** — migration 092 created the `polls` table and added nullable `poll_id` + `question_index` to `questions`; endpoints `POST /api/polls`, `GET /api/polls/{short_id}`, `GET /api/polls/by-id/{id}` create + read wrapper-and-questions atomically. Validation rejects participation questions, multiple `time` questions, and same-kind questions without distinct `context`. Auto-title is computed at read time from question categories + poll context (rules in `server/algorithms/poll_title.py`); explicit titles persist to `group_title`.
- **Phase 2.1 (frontend plumbing)** — `Poll` type in `lib/types.ts`, poll cache helpers in `lib/questionCache.ts`, `apiCreatePoll` / `apiGetPollByShortId` / `apiGetPollById` in `lib/api.ts`.
- **Phase 2.2 (writes route through polls)** — `app/create-question/page.tsx` calls `apiCreatePoll` for non-participation questions; participation keeps `apiCreateQuestion`. `app/g/[groupShortId]/page.tsx` loader tries `apiGetPoll*` first, falls back to `apiGetQuestion*` on 404 (uses exported `ApiError` for the status check). `next.config.ts` proxies `/api/polls` paths same-origin like `/api/questions`. Server-side `_resolve_parent_poll_id` translates `follow_up_to` QUESTION ids in the request into the parent's `poll_id` for the polls row, while the original question_id is also written onto each question's `questions.follow_up_to` so legacy group aggregation keeps working through Phase 5. `_insert_poll`'s group_title COALESCE has a third branch reading from the legacy parent question's `group_title` so groups with mixed-mode parents inherit titles correctly.
- **Phase 2.3 (What/When/Where bubble bar)** — replaced the single "+" button on group-like pages (`/group/<id>/`, `/p/<id>/`, `/group/new/`) with three pill buttons. Home page keeps the new group button which navigates to `/group/new/`. Each bubble preselects in the create-question modal: What → no preselection, When → `?mode=time`, Where → `?category=restaurant`. See "Navigation Layout" for full details.
- **Phase 4 (backfill)** — migration 093 wraps every non-participation question without a `poll_id` in a 1-question poll wrapper. After it runs, `polls.short_id` matches the source question's `short_id` (URLs preserved), `questions.poll_id` + `questions.question_index = 0` link them, and `polls.follow_up_to` references the parent's wrapper (NULL when the parent is a participation question). Migration is idempotent — `WHERE poll_id IS NULL` filter makes re-runs no-ops. The migration also self-heals dev DBs that lack `questions.short_id` / `questions.sequential_id` (a quirk where migration 030 dropped those columns and prod's Supabase-bootstrapped schema retained them but freshly-built dev DBs don't): a `DO` block adds them back when missing and back-fills sequential_id + short_id for pre-existing rows. No-op on prod.
- **Phase 2.5 (multi-question rendering)** — questions of one poll are treated as siblings when building groups. `Question` carries `poll_id` + `question_index` (server `QuestionResponse` exposes both, `_row_to_question` maps from DB, `toQuestion` maps to FE). `lib/groupUtils.ts: buildQuestionMaps` returns a `questionIdsByPoll` grouping (Phase 3.5 renamed `siblingsOf`); `collectDescendants` fans every visited question out to all its siblings. The group-page sort uses `question_index` as the tiebreaker for shared `created_at`. `server/algorithms/related_questions.py: QuestionRelation` carries `poll_id` + `poll_follow_up_to`; `get_all_related_question_ids` walks poll-level chains and expands every visited poll to its questions so discovery grants access to peer questions.
- **Phase 2.4 (multi-question create UI)** — `app/create-question/page.tsx` adds a `+ Add another section` button that calls `buildQuestionFromState()` to push a `CreateQuestionParams` onto a new `stagedQuestions` state, then resets per-question state (title, options, category, forField, optionsMetadata, ref location, min_responses, show_preliminary_results) while preserving poll-level state (creator name, voting cutoff, suggestion cutoff, details, follow_up_to). Staged rows render above the form; submit calls `questionDataToPollRequest(questionData, stagedQuestions)` (the helper now takes an `additionalQuestions` array that's prepended to the questions array — staged drafts come first, current form last). Persisted in the same `questionFormState` localStorage so modal close+reopen preserves the draft. The +Add button is hidden for `time` and `participation` (per MVP scope: no time-question staging; participation questions can't be questions at all). Submit is rejected client-side with a clear error if the user managed to switch to participation while staged questions exist. When staged questions exist AND `isAutoTitle === true`, the wrapper title is sent as `null` so the server's `generate_poll_title()` builds it from question categories — user-typed titles (isAutoTitle=false, e.g. yes/no questions) still pass through as the wrapper title. `recordQuestionCreation` is called for every question on success so the creator gets `creator_secret` access for each. Out of scope (Phase 3): per-question context UI, time-question staging, edit-staged questions, the dual-modal layout.
- **Phase 3.2 (group card aggregation)** — Sibling questions of a poll render as ONE card group instead of N cards. Server: `PollResponse` gains `voter_names: list[str]` + `anonymous_count: int` (computed via `_compute_poll_voter_data` — `array_agg(DISTINCT voter_name)` for named, `MAX(per-question anon)` for anon). Wired into every poll GET + close/reopen/cutoff endpoint. FE: group page iterates `groupedGroupQuestions` (memo grouping `groupQuestions` by `poll_id`); 1-question wrappers render identically to today, multi-question wrappers render one card with stacked `QuestionBallot` instances inside the expand clip (each with a section label = category icon + question's `details`). Poll wrapper is lazy-fetched via `apiGetPollById` on viewport intersection, stored in `pollWrapperMap`, refreshed on `QUESTION_VOTES_CHANGED_EVENT`. `VoterList` grows a static-data mode (`staticVoterNames` + `staticAnonymousCount`) that the group page uses to render the poll-level respondent row from the wrapper — never aggregated client-side per the Addressability paradigm. Copy-link routes through the poll's `short_id`. `maybeFetch` (results) treats anchor visibility as group visibility so every sibling's results are fetched together.
- **Phase 3.4 (unified vote endpoint + FE helper)** — `POST /api/polls/{poll_id}/votes` accepts `{voter_name, items: [{question_id, vote_id?, vote_type, ...}]}` and applies every item atomically inside a single transaction. Each item inserts (vote_id null) or updates (vote_id set) on its question_id; per-item validation, suggestion-phase enforcement, options_metadata merging, and auto-close all run inline so the unified path is functionally identical to N parallel per-question calls. Any item failure rolls back the whole batch — no half-applied state. `_submit_vote_to_question(conn, question_id, req, now) -> row` and `_edit_vote_on_question(conn, question_id, vote_id, req, now) -> row` are extracted from `routers/questions.py: submit_vote` / `edit_vote` so the per-question endpoints and the poll endpoint share the same logic; both helpers operate on a shared connection (no `with get_db()`) so the poll endpoint can wrap N calls in one transaction. FE helper `apiSubmitPollVotes(pollId, {voter_name, items})` lives in `lib/api.ts` alongside the existing per-question helpers; it cascades cache invalidation through `invalidatePoll` (which already evicts every question's per-question cache entry), so callers don't need to walk `items[]` manually. The `PollVoteItem` interface is exported.
- **Phase 3.4 follow-up A (poll-level Submit for all-yes_no multi-groups)** — When a group card holds 2+ yes_no questions (`isMultiGroup && group.subQuestions.every(sp => sp.question_type === 'yes_no')`), the per-question tap-to-vote-immediately flow is replaced by a wrapper-level Submit button + voter-name input rendered below the expand clip in `app/group/[groupId]/page.tsx`. Tapping yes/no/abstain on a question's external `QuestionResultsDisplay` writes to `pendingPollChoices: Map<question_id, 'yes'|'no'|'abstain'>` instead of firing `setPendingVoteChange`. The card's `userVoteChoice` reads staged-then-existing so the tapped pill highlights immediately. Submit is gated `disabled={submitting || !hasStagedChange}`; on confirm, `confirmPollSubmit(pollId, subQuestions)` builds a `PollVoteItem[]` from `buildPollItems(subQuestions)` (only questions with a staged choice), calls `apiSubmitPollVotes`, then distributes returned `ApiVote`s back into `userVoteMap` (keyed by `v.question_id` matched against `subQuestions`), syncs `setStoredVoteId` + `setVotedQuestionFlag` per item, fires `QUESTION_VOTES_CHANGED_EVENT` per item, and clears the staged choices for the poll. `pollVoterNames: Map<pollId, string>` keys the per-poll voter name input. Mixed-type multi-groups (yes_no + ranked_choice) and 1-question polls keep their existing per-question Submit flow until PR B lifts Submit out of `QuestionBallot` generally. Also: new `partOfPollGroup` prop on `QuestionBallot` suppresses the duplicate `<QuestionDetails details={question.details} />` render for multi-group questions (the group-page section label already shows `question.details` as the disambiguating context label). PR B will extend the same prop to gate Submit / voter name / confirmation.
- **`<QuestionDetails>` is also suppressed in single-question polls when `question.is_auto_title === true`.** The auto-title for time / ranked_choice questions encodes the per-question context as a "for X" suffix (e.g. a Time question with details="Partie" auto-titles as "Time for Partie"); rendering `details` below the title would surface the same string twice and read visually as if "Partie" were the question's "real" title separate from the poll's title. Yes/No questions store user-typed prompts (`is_auto_title === false`) and keep the details. The `=== true` comparison is deliberate: stale cached `Question` objects without the field default to `undefined`, which falls through to "show details" — matches the pre-rollout behavior. **`is_auto_title` flows through `lib/api/_internal.ts: toQuestion`** — when adding new fields to `QuestionResponse` server-side, audit `toQuestion` so the field actually reaches FE consumers (the field was on the Pydantic model + the FE `Question` type but missing from `toQuestion`, so every consumer got `undefined`).
- **Per-question section header is rendered ONLY in multi-question polls.** Format: `"<Label> for <Context>"` via `getQuestionSectionTitle(question)` in `lib/questionListUtils.ts`, mirroring the server's auto-title (e.g. a Time question with details="Partie" reads "Time for Partie" instead of just "Partie"). Without the type signal, a Time question's section header was indistinguishable from a Restaurant question's. The helper special-cases `time` (the Time bubble stores question_type=time but leaves category=custom, same load-bearing convention as `_category_for_title` server-side) and `yes_no` (server uses "Yes/No", BUILT_IN_TYPES has "Yes / No" — special-case keeps the FE in lockstep with server-generated wrapper titles). For single-question polls the card top already shows the question's title; rendering a section header underneath duplicated info, and for yes_no specifically it surfaced literal "Yes/No" right under the user's prompt — reading as if the category label were the title. The text branch is gated on `isMultiGroup` in `app/g/[groupShortId]/GroupCardItem.tsx`. **Hanging icon placement**: `HangingCategoryIcon` is `position: absolute` and anchors to its nearest `relative` ancestor's top edge, so the icon's parent must be a `relative` box for it to land in the correct column. Multi-question rendering keeps the existing `<div className="mb-2 relative">` header div as the icon's anchor + container for the title text. Single-question rendering moves the `relative` flag onto the OUTER section wrapper (the `<div key={sp.id}>`) and renders `HangingCategoryIcon` directly inside, with no intermediate header div — so the icon sits at the top of the section content area exactly as before, but the title text + its `mb-2` margin are gone and the rest of the question content (yes/no cards, QuestionBallot, etc.) slides up into the freed space. The earlier "must always render so closed-empty cases (e.g. ranked_choice with zero rounds = 'All voters abstained' with nothing else) keep an in-section identifier" rationale doesn't apply because the card top header always carries the title for single-question polls. **Per-question titles in multi-question polls**: every question row inside one poll shares the same `polls.title` (write-time), so reading `question.title` would surface the wrapper title for every section — `getQuestionSectionTitle` therefore uses the category label + per-question `details` (context) as the disambiguator, NOT `question.title`. If you reintroduce the section header for single-question polls, you reintroduce the redundant-title bug — guard new "must always render" use cases on `isMultiGroup` too. Putting the icon anchor on the outer `key={sp.id}` div is also load-bearing: an empty `<div className="mb-2 relative">` around just the icon would still consume the `mb-2` (8px) margin even with the title gone, leaving an unwanted gap above the question content.
- **`CompactRankedChoiceResults` renders the question's options list under the empty-state message** when `roundVisualizations.length === 0` (no votes OR all abstained). Without it, an expired all-abstain ranked_choice card collapses to just "All voters abstained" with no indication of what was on the ballot. The list pulls from `results.options` (already on `QuestionResults`, populated server-side); each row uses the existing `<OptionLabel>` so restaurant/location metadata renders the same as in the active ballot. The all-abstained branch is the canonical "All voters abstained" copy — earlier it stacked "No Votes" above "All voters abstained" as two separate `<p>`s, which read as redundant. The `total_votes === 0` branch keeps "No Voters" since "no one voted at all" is semantically distinct from "everyone voted abstain".
- **`CompactRankedChoiceResults`'s `#round<N>` hash is gated on `isPollDetailView(pathname)`** (from `lib/questionId.ts`). The component renders in both the expanded group card AND the poll detail page; unconditional `history.replaceState('#round1')` was polluting group URLs (`/g/<id>` → `/g/<id>#round1`) where the round visualizer isn't the page's primary content. The hash-write effect also no-ops when `window.location.hash` already matches `#round${currentRoundIndex+1}` to avoid redundant `replaceState` calls. **General rule**: any component that writes to the URL (hash, query, history) and is mounted on multiple route shapes must gate its writes on a route check — `isGroupRootView` and `isPollDetailView` are the canonical helpers in `lib/questionId.ts`; extend that file when adding more.
- **`confirmVoteChange` (yes_no tap-to-change for the non-staged path) routes through `apiSubmitPollVotes` when the question has a `poll_id`.** The group page's `confirmVoteChange` (used by 1-question yes_no polls AND by the yes_no anchor in mixed-type multi-groups where `usePollSubmit = isMultiGroup && allYesNo` is false) builds a single-item `PollVoteItem[]` and calls `apiSubmitPollVotes(pollId, { voter_name, items })`. The legacy `apiSubmitVote`/`apiEditVote` branch is preserved as a fallback for the `poll_id == null` case (theoretically unreachable for yes_no after the Phase 4 backfill, but kept for safety). On a fresh first-time vote the poll path also calls `saveUserName(voter_name)` so the name carries over to subsequent questions (matches the all-yes_no group flow).
- **`QuestionBallot.submitVote` also routes through `apiSubmitPollVotes` when `question.poll_id` is set** — same gate as the group page's `confirmVoteChange`. Builds a single-item `PollVoteItem` from the same `voteData` the legacy path uses, with `vote_id` set on edits / null on inserts. After this change, the only remaining `apiSubmitVote` / `apiEditVote` callsites in client code are the legacy fallbacks for `poll_id == null` — i.e. participation questions (kept on the legacy path forever) plus any not-yet-backfilled question. Suggestions are deliberately omitted from the item on ranked_choice edits past the suggestion-phase deadline (`isEditing && question.question_type === 'ranked_choice' && !canSubmitSuggestions`); the server's edit path uses `suggestions = COALESCE(%(suggestions)s, suggestions)` so sending `null` would also be safe, but matching the legacy `suggestions: undefined` pattern keeps the contract explicit. The explicit `invalidateQuestion(question.id)` call later in `submitVote` is intentionally NOT removed for the poll path: `invalidatePoll` only cascades to per-question evictions when the poll cache happens to be warm (`if (entry)` in `lib/questionCache.ts:178`); on a cold poll cache the question caches wouldn't be touched, so the explicit call is the safety net. Phase 3.4 follow-up B will lift Submit out of `QuestionBallot` entirely; this change retires the per-question endpoint usage one phase earlier so the wrapper-level lift becomes a pure UI refactor.
- **Phase 3.4 follow-up B (1-question case): wrapper-level Submit + voter name for every 1-question non-yes_no poll.** `QuestionBallot` is now a `forwardRef` component exposing `QuestionBallotHandle.triggerSubmit()`. New props on the component: `wrapperHandlesSubmit: boolean` (gates the inline Submit + voter-name + `CompactNameField` blocks in the time-availability and time-preferences branches AND propagates to `RankingSection` + `SuggestionVotingInterface` so they skip their internal Submit/voter-name); `externalVoterName?: string` and `setExternalVoterName?: (name) => void` (when passed, they override QuestionBallot's internal `voterName` state — `submitVote` always reads the wrapper-controlled value); `onWrapperSubmitStateChange?: (questionId, { visible, label }) => void` (fires whenever QuestionBallot's "should the inline Submit show + what does it say" computation changes — `visible` mirrors the original gating: hidden in the voted-not-editing steady state, visible during initial-vote and edit modes; `label` preserves the type-specific copy "Submit Vote" / "Submit Availability" / "Submit Preferences"). The `useImperativeHandle` for `triggerSubmit` is wrapped via a `useRef`-stashed `handleVoteClick` closure so the handle stays stable across renders while always invoking the latest closure. The `getUserName` initial-load `useEffect` skips when `wrapperHandlesSubmit` is true so QuestionBallot doesn't fire the wrapper's setter from inside the child on mount.
  - **Group page wiring** (`app/group/[groupId]/page.tsx`): `subQuestionBallotRefs: Map<string, QuestionBallotHandle>` collects per-question handles via callback refs. `wrapperSubmitState: Map<string, { visible, label }>` stores the per-question state from `onWrapperSubmitStateChange` (uses a single ref-cached stable callback so QuestionBallot's effect deps don't churn across parent re-renders). The wrapper Submit + voter-name JSX renders inside the same overflow-hidden expand clip as the all-yes_no follow-up A wrapper Submit, gated by `useWrapperSubmit = !isMultiGroup && !!group.pollId && group.subQuestions[0]?.question_type !== 'yes_no'`. The voter name input reads from / writes to the existing `pollVoterNames: Map<pollId, string>` (shared with follow-up A's all-yes_no flow). The Submit button calls `subQuestionBallotRefs.current.get(sp.id)?.triggerSubmit()` which routes to QuestionBallot's existing `handleVoteClick` → `ConfirmationModal` → `submitVote` → `apiSubmitPollVotes` flow — no duplication of submit machinery, no double-modal.
  - **Mixed-type multi-question groups also lifted to wrapper Submit (this PR).** A poll containing yes_no + non-yes_no questions (e.g. yes_no + ranked_choice) now renders ONE wrapper Submit + ONE voter-name input + ONE ConfirmationModal — both yes_no and non-yes_no items folded into a single atomic `apiSubmitPollVotes` batch. Two extensions to follow-up B's plumbing:
    - **`usePollSubmit` gate drops `allYesNo`.** Was `isMultiGroup && allYesNo && !!group.pollId`; now `isMultiGroup && !!group.pollId`. Yes_no taps still stage in `pendingPollChoices` (existing follow-up A path); the wrapper Submit click additionally walks each non-yes_no question's ref to gather batch items.
    - **`QuestionBallotHandle.prepareBatchVoteItem(): { ok, item, commit, fail } | { skip } | { ok: false, error }`** is the new ref method. Inline-mirrors `handleVoteClick` validation + `submitVote` voteData/PollVoteItem build, then returns commit/fail closures that capture the per-question state at build time (`suggestionMetadata`, `effectiveIsAbstaining`, `isEditing`, `questionOptions`, voter-name). The wrapper invokes these closures with the returned `ApiVote` per question after the batched API call resolves — running the same post-write side effects (`markQuestionAsVoted`, `clearQuestionDraft`, `saveUserName`, `setHasVoted`/`setUserVoteId`, `loadExistingSuggestions`/`fetchQuestionResults` re-fetch) that `submitVote` runs in the per-question path.
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
- **Visibility helpers live in `services/groups.py`** (`UserVisibility`, `load_user_visibility`, `filter_visible_polls`, `grant_group_membership_inline`, `is_caller_member_of_group`). Both groups endpoints share them — adding visibility enforcement to a third endpoint would call `load_user_visibility(conn, browser_id, user_id=...)` once and pass the result to `filter_visible_polls(conn, candidate_pids, visibility)`. Don't reinvent the rule inline; the helper is the single source of truth so changes (e.g. a dedicated `closed_at` column) ripple through every read path. `UserVisibility` carries only `joined_by_group` now — `access_poll_ids` was dropped with migration 106, and `bridged_group_ids` (the `accessible_question_ids` bridge) was removed when `group_members` became the sole visibility authority. `load_user_visibility` no longer takes a `legacy_question_ids` param.
- **The `accessible_question_ids` forget bridge is REMOVED — `group_members` is the single source of truth.** There is no `bridged_group_ids`, no `group_ids_for_question_ids`, no `legacy_question_ids` param on `load_user_visibility`, and no forget-bridge narrowing in `/api/groups/mine`. A poll is visible iff the caller (or any browser linked to their signed-in user_id) has a `group_members` row for its group AND the poll is open OR was closed at/after the member's `joined_at`. The `accessible_question_ids` request field is still accepted on `POST /api/groups/mine` (older client bundles send it) but the server ignores it. "Forget a group" is "leave the group" (`apiLeaveGroup` → DELETE /membership), which drops the row. Don't reintroduce a question-id-list bridge; if a new "the user can see this without membership" case appears, write a `group_members` row (or a dedicated grant) instead.
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

- Three "bubble" buttons replace the single "+" button on home and group pages: **What**, **When**, **Where**, equally spaced along the bottom.
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
- On group pages, the What/When/Where buttons auto-set `follow_up_to` to the latest poll in the group (same as today's bubble bar behavior reads `data-group-latest-question-id`).

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
  1. `CAP_SERVER_URL=<url>` — explicit override. The workflow sets `https://latest.whoeverwants.com` for every non-prod build (CAP_ENV=`latest`), where `latest.whoeverwants.com` is the canary tier auto-deployed on every push to `main`. **It is NOT per-developer / per-branch** — per-author dev SERVERS were retired when dev sites became per-branch (Mac mini), and per-branch dev sites are not wired up to any iOS app. The non-prod iOS tier's URL is fixed at `latest.whoeverwants.com`.
  2. Otherwise → `https://whoeverwants.com` (prod default).
- **Two iOS apps total, no per-author suffix.** Bundle IDs at build time: prod = `com.whoeverwants.app` (loads `whoeverwants.com`); canary = `com.whoeverwants.app.latest` (loads `latest.whoeverwants.com`). One shared `WhoeverWants Latest` TestFlight track for all contributors. The historical per-actor `.dev.<github-username>` suffix is gone — it served zero purpose on a solo project and made AASA / Apple Developer portal / App Store Connect onboarding a per-contributor manual step.
- **AASA at both hosts lists both bundles.** `app/.well-known/apple-app-site-association/route.ts` returns `appIDs: ["479DZ4AZT5.com.whoeverwants.app", "479DZ4AZT5.com.whoeverwants.app.latest"]`. Universal-link clicks route to whichever bundle is installed; both bundles' entitlements claim `applinks:whoeverwants.com` AND `applinks:latest.whoeverwants.com` so a single AASA covers all combinations. Adding a third iOS tier later: register the bundle, append its `479DZ4AZT5.<bundle-id>` to `appIDs`, add the matching `applinks:<host>` entry to `App.entitlements`, and enable "Associated Domains" on the bundle in the Apple Developer portal.
- Distribution: TestFlight only (no USB cable ever after initial setup). Paid Apple Developer account required.

### Build pipeline

A GitHub Actions workflow (`.github/workflows/ios-build.yml`) runs on a
self-hosted Mac mini runner (labels: `self-hosted, macos-mini`). The workflow:

1. Resolves `CAP_SERVER_URL`: CAP_ENV=`latest` points at `https://latest.whoeverwants.com` (the canary tier, auto-deployed on every push to main); CAP_ENV=`prod` leaves it unset and capacitor.config.ts's `PROD_URL` fallback (`https://whoeverwants.com`) wins. `workflow_dispatch` accepts a `cap_server_url` input that overrides both.
2. Computes bundle ID + display name from `CAP_ENV` (`com.whoeverwants.app` / `Whoever` for prod, `com.whoeverwants.app.latest` / `Whoever α` for latest). No per-actor suffix. **The Home Screen label is `CFBundleDisplayName`, NOT the brand name.** iOS renders icon labels as a single line truncated to ~11-12 chars (width-based; wide caps count for more) with no wrap option — embedding a newline in the display name doesn't produce a two-line label, it collapses to one line. The old `WhoeverWants` (12) clipped and `WhoeverWants Latest` always truncated, so the label was shortened to `Whoever` (7) — the first word of the brand, which fits without truncating. (It briefly shipped as `Decide`, a generic verb chosen so the label read as "what the app does" rather than the brand; the owner then preferred the `Whoever` brand-fragment instead. Either approach fits — the only hard constraint is the ~11-12 char width budget.) The label is set in TWO places that must stay in sync: this workflow step's per-tier `DISPLAY_NAME` (the `plutil -replace` that actually ships) AND the committed `ios/App/App/Info.plist` default (only used by local Xcode builds). Changing `CFBundleDisplayName` is isolated — it does NOT touch the bundle id, the App Store Connect listing name, the APNS topic, or universal-link entitlements. Renaming does NOT reach already-installed apps via the WebView reload path; it needs a fresh TestFlight build + reinstall/update — and TestFlight must finish PROCESSING the new build before reinstalling pulls it (a reinstall before processing completes just re-pulls the prior build with the old name). The canary suffix is `α` (alpha), not `β` — the tier is "latest", not a beta.
3. Patches `ios/App/App.xcodeproj/project.pbxproj` with the bundle ID (automatic signing ignores the xcodebuild command-line override). Fails loudly if the sed doesn't match the expected occurrence count.
4. Runs `npm ci` → `npx cap sync ios` → archives with `xcodebuild` → exports signed `.ipa` → uploads with `xcrun altool`. All signing uses App Store Connect API key auth (`-allowProvisioningUpdates -authenticationKey*`) — no Xcode GUI login needed.
5. On first run only: auto-scaffolds `ios/` via `npx cap add ios` and commits it back to the branch.

Triggers:
- Pushes to ANY branch that touch `capacitor.config.ts`, `ios/**`, `package.json`, `package-lock.json`, the workflow file, or `scripts/ios/**`. `main` builds the prod bundle (`com.whoeverwants.app`); every other branch builds the shared `latest` bundle (`com.whoeverwants.app.latest`). Concurrency is keyed on `github.ref` with `cancel-in-progress: true`, so rapid pushes to the same branch only run the latest commit.
- **GitHub Release published** (non-draft, non-prerelease) → builds the prod bundle pinned to the release's tag. Keeps the iOS prod IPA in lockstep with the Vercel + droplet auto-deploys that already fire on the same event. Prereleases are filtered out by an `if:` guard on the job (the `published` action fires for prereleases too).
- Manual via `workflow_dispatch` — inputs: `cap_env` (`latest|prod`), `cap_server_url` (explicit URL override), `skip_upload` (bool).

### Universal Links

Tapping a `https://whoeverwants.com/...` URL from iMessage / Mail / Notes opens the installed Capacitor app instead of Safari. Three coupled pieces:

- **AASA file at `/.well-known/apple-app-site-association`** is served by a Next.js route handler (`app/.well-known/apple-app-site-association/route.ts`) returning `{ applinks: { details: [{ appIDs: ["479DZ4AZT5.com.whoeverwants.app"], components: [{ "/": "/*" }] }] } }` with `Content-Type: application/json`. The path has NO `.json` extension; iOS will not follow redirects and will not accept any other content type. `skipTrailingSlashRedirect: true` in `next.config.ts` (already set for API routes) doubles as protection here — without it, iOS hitting the bare path would 308-redirect to `/path/` and abort. The `Cache-Control: no-cache, no-store` header on non-`/api`/`_next/static` paths applies and is fine (iOS does its own aggressive caching). Verify both URL forms return 200 directly: `curl -sI https://whoeverwants.com/.well-known/apple-app-site-association` and `.../apple-app-site-association/`.
- **Entitlement** `com.apple.developer.associated-domains` in `ios/App/App/App.entitlements` lists `applinks:whoeverwants.com` and `applinks:latest.whoeverwants.com`. Both `aps-environment` (push) and `associated-domains` share the same plist now; future capabilities go here too.
- **`appUrlOpen` listener** in `components/UniversalLinksHandler.tsx` (mounted from `app/layout.tsx`, NOT `template.tsx` for the same persist-across-routes reason as `PersistentCreatePollHost`). Delegates to `lib/universalLinks.ts: installUniversalLinksHandler(navigate)` which: (a) short-circuits synchronously via `Capacitor.isNativePlatform()` so browsers/PWA pay zero cost beyond a single boolean check, (b) sets a module-level `installed = true` flag BEFORE the `await import("@capacitor/app")` to defeat the StrictMode-double-mount race, (c) registers `App.addListener("appUrlOpen", ...)`, and (d) calls `pathFromUniversalLinkUrl(event.url)` which re-validates against the known-hosts allowlist before `router.push`-ing. The re-validation is belt-and-braces — iOS only hands us URLs matching the entitlement, but cross-origin navigation from this channel would be a high-blast-radius vuln if entitlements ever widen.

**Tier mapping:**
- `whoeverwants.com/...` → prod bundle `com.whoeverwants.app` (loads `whoeverwants.com` in the WebView).
- `latest.whoeverwants.com/...` → latest bundle `com.whoeverwants.app.latest` (loads `latest.whoeverwants.com`). The latest iOS build (`scripts/ios/build.sh --env latest` or any push to a non-main branch) sets `CAP_SERVER_URL=https://latest.whoeverwants.com`.
- Both AASA endpoints (prod + latest) serve the same JSON listing both bundles, because both bundles' `applinks:` entitlements claim both hosts. iOS picks the right installed app based on bundle id, not which AASA was fetched. Net result: a tap on either host opens whichever app the user has installed; a user with BOTH installed gets a chooser.

Manual prereqs (must do once per bundle ID, outside this code):
1. **Apple Developer portal → Identifiers → `<bundle>` → check "Associated Domains" → save.** Same UI as Push Notifications; no certificate generation. Without this, the entitlement compiles but iOS silently ignores it. Repeat for every bundle in the AASA `appIDs` list — prod (`com.whoeverwants.app`) AND latest (`com.whoeverwants.app.latest`).
2. **iOS aggressively caches AASA.** After deploying an AASA change, existing installs may not pick it up — delete + reinstall the app to force a refetch. TestFlight's "Update" button is NOT sufficient on its own.

Pitfalls:
- **Don't put AASA under `public/.well-known/`.** Next.js silently refuses to serve hidden directories from `public/`. Use the `app/` route handler.
- **Static-import `@capacitor/core`, not dynamic.** The chunk is already in every page bundle (via `app/template.tsx` + `lib/pushNotifications.ts`), so `await import("@capacitor/core")` just adds an async hop before the `isNativePlatform()` short-circuit. Same applies to any future Capacitor-conditional code.
- **The validation IS belt-and-braces, not optional.** iOS won't deliver a non-matching URL through `appUrlOpen` today, but a future entitlement widening (e.g. `applinks:*.whoeverwants.com` to cover dev) would expand the surface — and the FE has to assume the channel can carry hostile-but-valid-shape payloads (e.g. `https://whoeverwants.com.evil.com/g/foo`, blocked by the `KNOWN_HOSTS` Set check on `.hostname`).
- **WebView already on whoeverwants.com handles deeplinks natively.** If the app is foregrounded and the user taps a same-domain link, iOS lets WKWebView navigate without firing `appUrlOpen`. The listener is primarily a cold-launch / background-resume path. Both flows end up on the same Next.js route — don't try to detect "did the listener fire" to gate behavior.

### Helper scripts

- `scripts/ios/build.sh [--env latest|prod] [--skip-upload] [--ref <branch>]` — dispatches a workflow run and questions until completion. Requires a `GITHUB_API_TOKEN` with `actions:write`. On failure, calls `logs.sh --failed-only` automatically.
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
- **`altool` exits 0 even when it rejects the upload.** Multiple failure shapes — at least two seen in practice: explicit `UPLOAD FAILED` banner, AND silent `ERROR: ... Cannot determine the Apple ID from Bundle ID ... (12)` (emitted when the bundle isn't yet registered in App Store Connect). The "Upload to TestFlight" step greps for `UPLOAD FAILED|ERROR:` AND requires a success marker (`No errors uploading|successful upload`) — missing either causes a hard fail. Don't trust altool's exit code alone, and don't soften the success-marker check to a warning. If you add an extra altool invocation elsewhere, mirror the dual-check pattern.
- **`altool --upload-app` MUST pass `--apple-id <numeric ASC app id>` — its bundle-id auto-detection PREFIX-matches and mis-routes when bundle ids are nested.** This was the root cause of a multi-hour prod-iOS-upload failure. Without `--apple-id`, altool resolves the target App Store Connect app from the IPA's CFBundleIdentifier via a PREFIX match, not exact. `com.whoeverwants.app` ambiguously matches three sibling apps (`.app`, `.app.latest`, `.app.dev.samcarey`) and altool picks the wrong one — prod `.app` IPAs were routed to the `.latest` app record. Symptom is a pair of misleading 409s carrying the WRONG (sibling) app's state: `Validation failed (409) ... The bundle identifier cannot be changed from the current value, 'com.whoeverwants.app.latest'` and `bundle version must be higher than the previously uploaded version: '<canary build #>'` — the bundle id + build number in those errors belong to `.latest`, not the `.app` app you're uploading. Canary (`.latest`) uploads worked by luck (no app extends its prefix). Fix: the "Compute bundle identity" step emits a per-tier `apple_id` (`6762459339` = WhoeverWants/`.app`, `6769589158` = WhoeverWants Latest/`.latest`) and the upload step passes `--apple-id "${{ steps.bundle.outputs.apple_id }}"`. The IPA itself (Info.plist, embedded Distribution profile, entitlements, binary `__info_plist`) was provably 100% correct for `.app` the whole time — the bug was entirely altool's app resolution. **Decisive diagnostic**: run `xcrun altool --upload-app ... --apple-id <prod numeric id>` manually against the failing IPA on the Mac; it succeeds instantly, proving the IPA is fine and routing is the issue. New tier → get its Apple ID from `GET /v1/apps` on the ASC API or the app's ASC URL (`appstoreconnect.apple.com/apps/<APPLE_ID>/...`) and add a branch to the bundle-identity step.
- **`CFBundleVersion` uses `date +%s` (Unix epoch), NOT `git rev-list --count HEAD`.** Monotonic + unique per build + forward-proof. (Note: the "bundle version must be higher than '861'" error that originally motivated this change was actually a symptom of the altool prefix-mis-routing bug above — the `.app` upload was hitting `.latest`'s build history. The epoch scheme is still the right call regardless: `git rev-list --count HEAD` diverges between the canary branch and main, so prod and canary build numbers could legitimately collide or regress; epoch can't.) Apple accepts up to 18 chars for CFBundleVersion; the 10-digit epoch fits. `fetch-depth: 0` is retained for `git log` accuracy in other workflow steps, not for the version counter.
- **`ITSAppUsesNonExemptEncryption=false`** in `Info.plist` skips the TestFlight export-compliance prompt. WhoeverWants only uses standard HTTPS (exempt category).
- **App icon must be 1024×1024 opaque PNG** in `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`. Alpha channels cause `Missing required icon file` rejection. `.gitignore` excludes `*.png` except under `public/` and the AppIcon asset catalog — preserve both overrides.
- **`CFBundleVersion` monotonicity**: the workflow uses `git rev-list --count HEAD`. Never rewrite history in a way that lowers this count, or TestFlight will reject future uploads.
- **First build auto-scaffolds + commits `ios/`.** Subsequent pulls should include `ios/`. Don't manually `rm -rf ios/` without also rerunning the scaffold flow.
- **`server.url` + App Store review**: App Store review sometimes objects to pure remote-URL apps. Phase 2 switches to bundled assets (requires static export — non-trivial with Next.js 16 App Router + `force-dynamic` + `next.config.ts` rewrites). Fine for TestFlight / sideload.
- **`contentInset: 'always'` produces visible black bars at the top and bottom on iPhone X-class devices.** The setting pads the WebView's scroll view away from the safe areas, exposing the configured `backgroundColor` underneath as a solid bar. The web app already handles safe areas itself (`viewport-fit=cover` + `env(safe-area-inset-*)` padding throughout), so the WebView should go edge-to-edge — use `contentInset: 'never'` in `capacitor.config.ts`. Pair with `backgroundColor: '#ffffff'` so any brief flash during load matches the page bg in light mode (Capacitor doesn't support theme-aware config values).
- **UIWindow's default `backgroundColor` is black, which leaks as a bottom-of-screen bar if the WebView's frame doesn't fully cover the window.** `CAPBridgeViewController.loadView()` is `final` and assigns `view = webView` — you can't restructure the view hierarchy. Defenses: (a) `AppDelegate.didFinishLaunchingWithOptions` sets `window?.backgroundColor = .systemBackground` (window is non-nil here for non-UIScene apps with `UIMainStoryboardFile` in Info.plist), (b) a `MainViewController: CAPBridgeViewController` subclass overrides `viewDidLoad` to set `view.backgroundColor = .systemBackground`. Use `.systemBackground` (not `.white`) so dark-mode users don't see white safe-area zones against a near-black page. Capacitor already writes `webView.backgroundColor` + `scrollView.backgroundColor` from `capacitor.config.ts` (CAPBridgeViewController.swift L308-310) — don't redo those in the subclass.
- **Adding a new `.swift` file requires hand-patching `project.pbxproj`.** `npx cap sync ios` doesn't pick up new native files — it only syncs web assets and plugins. Xcode's GUI handles file-add via PBXBuildFile + PBXFileReference + group children entries, but the headless CI build has no GUI. For small additions (1–2 short classes), colocate inside `ios/App/App/AppDelegate.swift` which is already in the build phase. Reserve new files for non-trivial code where colocation hurts readability.
- **Storyboard `customClass` references use the Xcode target name as `customModule`.** `<viewController customClass="MainViewController" customModule="App" customModuleProvider="target"/>` resolves to the `MainViewController` Swift class in the `App` target. Verify with `grep "name = " ios/App/App.xcodeproj/project.pbxproj` — the target name is the source of truth. Capacitor's default scaffold uses `customModule="Capacitor"` because the bridge VC ships from the Capacitor SPM package; subclasses defined in the app target need `customModule="App"` and the `customModuleProvider="target"` attribute.
- **Per-author dev URLs are dead — the non-prod iOS tier targets `latest.whoeverwants.com`.** An earlier version of `ios-build.yml` derived `CAP_SERVER_URL` from `head_commit.author.email` (`<slug>.dev.whoeverwants.com`). That worked under per-author dev servers but broke silently when dev servers became per-branch (the `<email-slug>` URL still resolves DNS-wise via the wildcard Caddy frontend, but returns HTTP 503 `upstream connect error` because no upstream container is registered for that slug). The WebView loads the 503, renders nothing visible, and the user sees a white screen (light mode) or black screen (dark mode — the `view.backgroundColor = .systemBackground` showing through). Fix in this repo's history: workflow now hardcodes `https://latest.whoeverwants.com` for CAP_ENV=`latest`. If a new tier appears that requires per-bundle URLs again, key on `github.ref` (branch name) NOT email — and add a third bundle id rather than reviving the per-actor scheme.
- **TestFlight blank-screen diagnostic workflow.** Symptom: app launches, shows a solid white or black screen (color = light/dark mode default from `view.backgroundColor = .systemBackground`), no content. Before reaching for Safari Web Inspector, run this triage:
  1. Curl the URL the iOS build points at (`https://whoeverwants.com` for prod TestFlight, `https://latest.whoeverwants.com` for the `WhoeverWants Latest` TestFlight). Verify it returns 200 with a valid `<title>` and `<meta name="build-id">`. A 503 / 5xx here is the bug (see the per-author-URL pitfall above for the historical case).
  2. Open the same URL in iPhone Safari on the same device. If Safari renders fine but the WebView is blank, the bug is WebView-specific (CSS / JS / Capacitor bridge) — proceed to step 3. If Safari ALSO blanks, the bug is in the web bundle currently served by that tier.
  3. Compare deployed `build-id` between tiers — `curl -s https://whoeverwants.com | grep -oE 'build-id" content="[^"]+"'` vs the same against `latest.whoeverwants.com`. If they diverge AND the prod tier is older AND prod TestFlight is the one failing, the most likely fix is "cut a release" to promote the newer (fixed) bundle to prod — no new iOS build needed since the WebView reloads its URL on each app open. (Pattern we hit: prod blank screen was an overlay-slide regression in commit `8a60ff0` already fixed in subsequent main commits but never released to prod because the two-tier deploy was set up after the regression and no release had been cut.)
  4. Check client logs on the matching tier (`/api/client-logs?level=error&limit=50`) — the forwarder captures unhandled errors and prod-host `warn/error` console output. See the "Client Log Forwarding" section.
- **Cached provisioning profiles persist across workflow runs and bind the wrong bundle to the IPA.** Profiles live OUTSIDE DerivedData (`~/Library/Developer/Xcode/UserData/Provisioning Profiles/` and `~/Library/MobileDevice/Provisioning Profiles/`), so `xcodebuild clean` doesn't touch them. With automatic signing + `-allowProvisioningUpdates`, Xcode SHOULD fetch a fresh profile when the target bundle id changes — but in practice it often reuses a cached SIBLING profile (e.g. `com.whoeverwants.app.latest` left over from a canary build, used for a `com.whoeverwants.app` prod build). The resulting IPA has its `Info.plist` CFBundleIdentifier set to the right bundle id but its embedded `.mobileprovision` set to the sibling, and ASC rejects with `Validation failed (409) ... bundle identifier cannot be changed from the current value, '<sibling-bundle>'`. Fix: a workflow step before `Archive` that `rm -rf`'s both profile cache directories, forcing `-allowProvisioningUpdates` to re-fetch from ASC. Costs a few seconds per build for the round-trip. If the new fetch ALSO fails (capabilities mismatch in Apple Developer portal between `.app` and `.latest`, missing entitlements on `.app`, etc.), the failure will be a clearer error from xcodebuild instead of a confusing ASC 409 at upload time.
- **`xcodebuild archive` without `clean` reuses stale embedded CFBundleIdentifier from the App binary.** The Mac self-hosted runner's DerivedData persists across runs. After a canary build (`com.whoeverwants.app.latest`) runs, the next prod build (`com.whoeverwants.app`) re-uses the previously-compiled App.app — the outer `App.app/Info.plist` regenerates correctly from the freshly-patched `pbxproj`, but the App binary's Mach-O `__info_plist` segment still carries the previous bundle id baked in at link time. ASC's altool validator reads CFBundleIdentifier from BOTH locations and rejects the upload with `Validation failed (409) This bundle is invalid. The bundle identifier cannot be changed from the current value, 'com.whoeverwants.app.latest'.` Symptom: prod release builds fail at the "Upload to TestFlight" step right after a canary build of the same project succeeded. Fix: pass `clean archive` (both actions) instead of just `archive` to xcodebuild — forces full re-link so the binary's embedded plist regenerates from the patched pbxproj. Trade-off: ~30s → ~2min archive time per run; acceptable because the workflow's path filter only triggers iOS builds on native-relevant changes / release publishes / push-to-main. The `clean` action targets the specific scheme/config so SPM caches stay warm. Note that codesign + provisioning profile lookups also benefit from the clean — Xcode's per-project profile selection cache lives in DerivedData too. Don't try to fix this with `rm -rf ~/Library/Developer/Xcode/DerivedData/App-*` instead; that nukes SPM caches and triples archive time.
- **`plutil -insert KEY -xml "<value>"` corrupts Info.plist on macOS — use `/usr/libexec/PlistBuddy` for nested-structure inserts.** When wiring native Google Sign In, an early version of `ios-build.yml`'s "Stamp Info.plist with Google iOS URL scheme" step did `plutil -insert CFBundleURLTypes -xml "<array><dict><key>CFBundleURLSchemes</key>..." Info.plist`. The step exited 0, the next `plutil -extract` was silent (didn't fail), but downstream `xcodebuild archive` failed at `builtin-infoPlistUtility` with `error: contents of file is not a dictionary` — the entire root element had been replaced with the inserted `<array>`, blowing away CFBundleDisplayName, the existing plist boilerplate, everything. plutil's `-xml VALUE` typing isn't strict enough to refuse a value that, when applied at the root, would un-dict-ify the file. Switch to `/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" + "Add :CFBundleURLTypes:0 dict" + "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" + "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string $REVERSED"` — slower, more verbose, but it can't blow up the root because each `Add` is keypath-scoped. Belt-and-braces: end the step with `/usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes"` + `plutil -lint` so any future corruption fails the step at the source instead of two minutes later in xcodebuild.

### Clipboard Link Prompt

On Capacitor iOS app activation (cold launch + every foreground-from-background), `lib/clipboardLinkPrompt.ts` peeks at the system clipboard for a copied web URL; if it holds an `https://whoeverwants.com/...` or `https://latest.whoeverwants.com/...` URL the user isn't already on, `components/ClipboardLinkPrompt.tsx` surfaces a `ConfirmationModal` that `router.push`es into the app. Inert on web/PWA via the `Capacitor.isNativePlatform()` short-circuit.

- **Silent detection via a custom native plugin, NOT `@capacitor/clipboard`.** `Clipboard.read()` (= `UIPasteboard.general.string`) forces iOS's "Pasted from <app>" banner on EVERY call, before JS can inspect the content — so the old design prompted on every launch even when the clipboard held a non-app URL or plain text. The fix: `ClipboardUrlPlugin` (colocated in `ios/App/App/AppDelegate.swift`, registered JS-side via `registerPlugin("ClipboardUrl")`) calls `UIPasteboard.general.detectValues(for: [.probableWebURL])` (iOS 16+), which is privacy-preserving and returns the matched URL with NO banner. JS then runs the URL through `pathFromUniversalLinkUrl`'s host allowlist and only surfaces our own modal for actual whoeverwants links. On iOS < 16 `detectValues` is unavailable, so the plugin returns `{supported: false}` and JS skips the auto-check entirely (no banner-triggering fallback — iOS 15 just loses the copied-link convenience). **On-device verification of the no-banner behavior is mandatory** — headless WebKit / the iOS Simulator can't confirm pasteboard banner behavior; only a real device can. The detection API only inspects the FIRST pasteboard item.
- **`ClipboardUrlPlugin` is a `CAPPlugin, CAPBridgedPlugin` colocated in AppDelegate.swift** (same rationale as `MainViewController`: a new `.swift` file means hand-patching `project.pbxproj` in headless CI). Capacitor auto-discovers `CAPBridgedPlugin` conformers at runtime — no `project.pbxproj` or `capacitor.config.ts` change beyond compiling the class. `@capacitor/clipboard` is now unused (still in `package.json`; left installed to avoid churning the SwiftPM graph — see the apple-sign-in version-conflict pitfall for why plugin removal is risky). Any change to this plugin needs a fresh iOS build to take effect.
- **Cold launch needs an explicit one-shot check** — `App.addListener("appStateChange")` doesn't fire on the initial active state. Same shape as `lib/universalLinks.ts`'s "claim `installed` BEFORE await" guard against StrictMode double-mount.
- **Coalesce overlapping detection** via an `if (checking) return; checking = true; try {...} finally { checking = false }` guard so rapid foreground/background cycles don't fire two modals for the same activation.
- **Mark the URL responded BEFORE invoking `onLinkFound`**, not after the user confirms/cancels. Without the early mark, a second `checkClipboard` racing the modal mount can pass the `respondedUrls.has(raw)` check and fire a duplicate `onLinkFound`. The component's confirm/cancel handlers still call `markClipboardUrlResponded` — that's idempotent (Set-add).
- **`respondedUrls` is LRU-bounded at 50 entries** — a long-running PWA session could otherwise accumulate forever. `Set` preserves insertion order, so the oldest entry is `respondedUrls.values().next().value`. Pattern matches `lib/questionCache.ts: setLru`.
- **Skip-if-already-on-that-path uses `normalizePath` from `lib/questionId.ts`**, not a local helper — same single-trailing-slash strip both files need. Don't reintroduce a local `normalisePath` (or any other spelling variant) for path comparison.
- **The component's useEffect mirrors `UniversalLinksHandler.tsx`'s cancellation-race pattern** (`let cleanup; let cancelled; install().then(c => cancelled ? c?.() : cleanup = c); return () => { cancelled = true; cleanup?.(); }`). Two callers is the abstraction threshold — keep duplicated for now; if a 3rd "install-once Capacitor listener" component lands, extract a shared `useCapacitorInstaller(install)` hook to eliminate the foot-gun.

---

## Group Avatar Images

Groups can have a custom uploaded image avatar that replaces the participant-initials graphic. **Storage**: inline on the `groups` row — migration 108 added `image_data BYTEA`, `image_mime_type TEXT`, `image_updated_at TIMESTAMPTZ` columns. Keeping bytes in Postgres (vs filesystem / object storage) means pg_dump captures them automatically, no second storage surface to provision per-branch on the Mac dev infrastructure, and "destroy + recreate dev DB" stays a one-step operation. Trade-off accepted for the current scale.

**API**:
- `POST /api/groups/{route_id}/image` — base64 JSON body (`{image_base64, mime_type}`); JPEG/PNG only; 5 MiB cap. No creator-secret check, same trust model as `/title`.
- `DELETE /api/groups/{route_id}/image` — idempotent clear; returns 200 even when no image was set.
- `GET /api/groups/by-route-id/{route_id}/image` — raw bytes with the stored MIME type and `Cache-Control: public, max-age=31536000, immutable`. The FE's `?v=<image_updated_at>` query string is the cache-buster.

**`image_updated_at` propagates as a wrapper field on every `PollResponse`.** Surfaced via the same `_SELECT_POLLS_WITH_GROUP` JOIN as `group_title` / `group_short_id` (extend the constant when adding a new joined groups field, NOT a parallel SELECT). FE `Poll.group_image_updated_at` flows through `toPoll`; `Group.imageUrl` is derived in `lib/groupUtils.ts: buildGroupImageUrl(routeId, ts)` and consumed by the new `<GroupAvatar>` wrapper.

**`<GroupAvatar imageUrl|names|anonymousCount|sizeClassName>`** in `components/GroupAvatar.tsx` replaces direct `<RespondentCircles>` use at every "this is the group's icon" surface: home list rows, group-page header, /info hero. When `imageUrl` is null, falls through to `RespondentCircles` for the initials graphic — same outer dimensions either way, so swapping doesn't shift layout. Both variants render through SVG with a viewBox-100×100 disc of radius `BOUNDING_RADIUS = 41.5` (exported from `RespondentCircles.tsx`, alongside `BOUNDING_DIAMETER = 83` and `BOUNDING_OFFSET = 8.5`). The image branch uses `<image>` with `preserveAspectRatio="xMidYMid slice"` clipped to the same disc; the initials branch packs N circles inside that disc with `LAYOUTS[n]` centers + `diameter`, scaled by `BOUNDING_SCALE[n]`. **`BOUNDING_SCALE` is computed from `LAYOUTS`** (`BOUNDING_RADIUS / max(distance_from_50_50 + r)`) — don't hand-tune it; the formula encodes "snug to bounding circle". For multi-name tessellations, the parent SVG draws a `fill-gray-100 dark:fill-gray-800` backdrop circle of the same radius behind the initials so the bounding shape reads as a quiet container; gated `!isPlaceholder` (single-name and empty cases already cover the disc with a colored circle). **The home-list avatar size is `w-[4.8rem]` (76.8px)** — bumped from the `w-16` (64px) default by 20% via `sizeClassName` in `components/GroupListItem.tsx`; other surfaces keep their own explicit overrides (`w-28` on /info, `w-[10.5rem]` on /edit-title). The text-column gets `mt-1` to nudge the title baseline toward the avatar's vertical center at the larger size.

**Symmetric `LAYOUTS[n]` is load-bearing for the bounding-disc backdrop.** All centers must be equidistant from (50,50), otherwise uniform scaling leaves child circles at different gaps from the outer ring — visibly asymmetric. The original `LAYOUTS[3]` was `[[50, 26], [27, 74], [73, 74]]` (top circle at distance 24, bottom two at 33.24 → top sat further from outer ring after scaling). Replaced with equilateral `[[50, 22.708], [26.364, 63.646], [73.636, 63.646]]` — all three at distance 27.292, all pair distances equal. When adding a new `LAYOUTS[n]` row, design it symmetric around (50,50) first; the BOUNDING_SCALE formula then snugs it into the disc with equal gap on every side.

**`<ImageCropModal>`** (`components/ImageCropModal.tsx`) is the drag + pinch-zoom + canvas-export cropper. Several traps learned the hard way:

- **iOS WebKit (Safari + iOS Firefox) silently fails `<img src="data:image/...">` for data URLs over ~1-2 MB.** Phone photos at 5-15 MB produced an empty crop circle. The fix is `URL.createObjectURL` for the displayed source — blob URLs have no length limit. FileReader/data URLs are NOT a working substitute on mobile WebKit.
- **Pair `URL.createObjectURL` + `URL.revokeObjectURL` + `setUrl` inside ONE `useEffect`.** First attempt put the URL in `useState(() => createObjectURL(file))` lazy init, assuming React StrictMode would re-run the initializer on the simulated remount. **It doesn't** — StrictMode preserves state across the dev mount→unmount→mount cycle; only effects re-run. So the cleanup revoked the URL while state kept pointing at it, and the img permanently displayed a dead URL. Pattern that works:
  ```tsx
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => { URL.revokeObjectURL(u); setUrl((prev) => prev === u ? null : prev); };
  }, [file]);
  ```
  The `setUrl(...)` in cleanup is load-bearing — without it the img briefly keeps `src=URL_A` after the revoke, fires onError, and sets `loadError` permanently. With it, the img unmounts cleanly between StrictMode mounts.
- **Tailwind preflight ships `img { max-width: 100%; height: auto }` globally.** When the displayed img has explicit `width: 1737px` set inline AND its parent container is 370px, max-width caps the width at 370 BEFORE the transform: scale() runs — so the transform downscales an already-clipped width, producing an image rendered at 1/N of the expected width and positioned off-screen. The fix is `maxWidth: 'none'` (and `maxHeight: 'none'` for safety) in the inline style. **This is a browser-agnostic bug**; my Playwright tests only checked `getBoundingClientRect().width > 0`, which was true even for the 78×658-px sliver, so it slipped through. When testing image-sizing fixes, validate the rendered dims match the math.
- **Keep the displayed `<img>` mounted across the loadError → success transition.** Earlier the JSX gated the entire crop container on `!loadError`, so an onError firing for a stale URL_A unmounted the img — the subsequent URL_B never got a chance to load. Render the img unconditionally (once `url` is set); show loading/error overlays on top. Successful onLoad sets imageDims AND clears loadError.
- **Don't allocate per-frame in pointermove.** The hot path runs at ~60Hz on touch. Iterate `pointersRef.current.values()` directly (Map iterator) — don't `Array.from(...values())`, which allocates a fresh array each frame. Capture first/second pointer in the same loop for pinch math.
- **Canvas export**: 512×512 JPEG at quality 0.9 → ~50-80 KB typically. Drawn from the freshly-loaded blob URL (the modal's URL stays alive until unmount).
- **5MP+ image render limits on iOS**: not actually a hard problem in practice (modern iPhones handle 12+ MP fine). Symptoms that look like image-decode failures on mobile have always traced back to one of the items above, not actual memory limits. Don't pre-resize on the client without evidence; the canvas export already downscales.

**Edit-title flow** (`app/g/[groupShortId]/edit-title/page.tsx`) defers all image + title changes to local state and commits via the Save button:
- Picking + cropping stages a `Blob` in `pendingCroppedBlob` and a derived blob URL in `localImagePreviewUrl` for the preview avatar. No server round-trip.
- Tapping the X badge stages `pendingImageRemoval = true` (and clears any `pendingCroppedBlob`).
- Save runs the staged image action (upload or delete), then the title update if changed, then navigates back. Skips the DELETE entirely when `pendingImageRemoval && !group.imageUrl` (no-op on a group without an image).
- Back checks `hasUnsavedChanges = titleChanged || imageChanged` and shows a `ConfirmationModal` ("Discard your changes?", red Discard button) if anything is staged. Confirm → navigate away without committing; cancel → stay.

The X-badge / camera-badge pattern needs both to be **siblings of the avatar button** inside a single `relative` wrapper — NOT children of the same button — so their click handlers stay independent (tapping X doesn't open the file picker). The X badge only renders when `effectiveImageUrl` is truthy (no point offering to remove a non-existent image).

**Template `py-6` was retired for sub-routes** (`app/template.tsx`). The page-wrapper used to apply `py-6` (24px top + bottom padding) to every route that wasn't home, settings, or `isGroupLikePage` — so `/g/<id>/info` and `/g/<id>/edit-title` got 24px of extra top space ON TOP of their inline `paddingTop: calc(env(safe-area-inset-top, 0px) + 1.05rem)` for floating-button clearance. Changed to `pb-6` (drop top). Other routes in the bucket are redirect stubs where padding is irrelevant.

**(Historical) `accessibleQuestionIds` non-UUID 500 pitfall.** This is moot now: `/api/groups/mine` no longer resolves the `accessible_question_ids` list against the DB (the forget bridge is removed and the field is ignored), and `group_ids_for_question_ids` was deleted. The general lesson still stands — when an endpoint casts an FE-supplied array to `uuid[]`, filter through a UUID regex first so one corrupt element can't 500 the whole call (`services/groups.py: require_uuid` / `_is_uuid_like` are the canonical guards for path-param uuids).

**Dev-infra trap (FIXED on `claude/remove-group-dividers-ion0C`)**: `scripts/mac-mini/dev-server-manager.sh`'s `INSERT INTO _migrations (filename) VALUES (:'fname')` line was broken since the script's inception — the `:'fname'` psql variable substitution fails with `syntax error at or near ":"` when used inside `psql -c` (`-c` sends SQL to the server with no psql-level variable expansion). So `_migrations` never persisted, every upsert re-ran every migration from scratch, and any non-idempotent rename eventually corrupted the schema. The canonical fingerprint was the three-way `polls` + `multipolls` + `questions` state, caused by migration 092 (`CREATE TABLE IF NOT EXISTS multipolls`) re-running after 097's first-pass rename had already renamed `multipolls → polls`, then 097's second pass failing because `questions` and `polls` both exist and rolling back, leaving subsequent ALTER COLUMNs to land on the wrong tables. Fix: interpolate `$basename` directly into the SQL string (`'$basename'`) — the upstream regex check already rejects single quotes, so no injection vector. With `_migrations` actually persisting now, second-and-later upserts skip already-applied migrations and the drift cannot recur. If you encounter the three-way state on a long-lived dev DB created BEFORE this fix, destroy → upsert resolves it cleanly because migrations only run once on the fresh DB.

## User Profile Avatar Images

Users can upload a profile image on the settings page that replaces their initials circle wherever their name renders. **Storage** mirrors the group avatar pattern (migration 108): inline BYTEA on a `user_profiles` row keyed by `browser_id` (the per-browser uuid issued by `BrowserIdMiddleware`). Migration 109 added the table.

**API**:
- `POST /api/users/me/image` — base64 JSON body (`{image_base64, mime_type}`); JPEG/PNG; 5 MiB cap. Reads `request.state.browser_id` — no body identifier.
- `DELETE /api/users/me/image` — idempotent clear.
- `GET /api/users/me/profile` — `{browser_id, image_updated_at}`. Lets the FE warm the cache without fetching bytes.
- `GET /api/users/by-browser-id/{browser_id}/image` — public bytes endpoint, immutable cache headers, `?v=<image_updated_at>` cache-buster. Returns 404 → FE falls back to initials.

The MIME-type / 5 MiB constants are intentionally duplicated from `routers/groups.py` (separate domain, separate identity model). If a third image domain appears, consider extracting a shared `routers/_image_helpers.py`.

**`<InitialBubble>`** in `components/InitialBubble.tsx` is the canonical single-user avatar bubble. Originally a name-initials disc; extended with an optional `imageUrl` prop that renders an `<img>` clipped to the circle (`object-cover`) when set. Configurable via `sizeClassName` (default `w-7 h-7`) and `textSizeClassName` (default `text-xs`). Used everywhere a single-user avatar appears: settings page hero (`w-28 h-28` + `text-2xl`), `GroupCardItem` creator bubble (default size), `/info` members list rows (`w-8 h-8`). Don't introduce a parallel avatar component — extend this one.

**`<RespondentCircles>` swaps the matching circle for an SVG `<image>` clipped to the disc** via `<clipPath>` + `<image href ... preserveAspectRatio="xMidYMid slice">`. The component subscribes to `USER_PROFILE_CHANGED_EVENT` via `useMyUserImageUrl()` and resolves only the CURRENT user's image — cross-user image lookup is out of scope (per "show only on new participations"). `useId()` generates a stable per-instance prefix for clipPath ids so multiple circles on the same page don't collide. The dual iteration (one for `<defs>`, one for the `<g>` body) is required — SVG `<defs>` must precede their references and can't be mixed inline.

**`useMyUserImageUrl()`** (`lib/useMyUserImageUrl.ts`) is the canonical hook. Synchronously seeds from `getMyUserImageUrl()` on mount (no flash) and subscribes to `USER_PROFILE_CHANGED_EVENT` for live updates. Module-level memo in `lib/api/users.ts: getCachedMyUserProfile()` means 50+ visible cards each calling the hook on a busy group page do a SINGLE localStorage read + JSON parse — not 50. The memo is invalidated only by `cacheMyUserProfile` / `clearCachedMyUserProfile`, the two paths that can change the value in-process. `cacheMyUserProfile` skips both the localStorage write AND the event dispatch when the new profile is content-equal to the cached one (`browser_id` + `image_updated_at`) so a refresh from `apiGetMyUserProfile()` that confirms the cache doesn't churn every subscriber.

**Settings page staging mirrors `/edit-title`** — `pendingCroppedBlob` (new upload) and `pendingImageRemoval` (clear) accumulate locally; `commitPendingImageChange()` is the single helper that both the inline "Save photo" button and the main "Save" button call. Extract the helper once; never inline the upload/delete branch in two places. The localStorage cache is updated as part of the API call (`apiUploadMyUserImage` / `apiDeleteMyUserImage` both call `cacheMyUserProfile` internally), so the avatar updates everywhere on the page without a navigation.

**"Is this poll mine?" check uses `isCreatedByThisBrowser(questionId)`, NOT a name match.** The first iteration of the creator-bubble swap compared `wrapper.creator_name === getUserName()` (case-insensitive trim). That broke for two real cases: (a) the user uploaded an image but never typed a name in settings → `creator_name: null` → falls through to `getUserInitials(null) = "?"`; (b) the user typed a slightly different name when creating the poll ("Sam C." vs "Sam Carey"). Both produce a "?" bubble on a poll the user created. The fix in `GroupCardItem.tsx`: `creatorIsMe = isCreatedByThisBrowser(firstQuestionId) || isCurrentUserName(wrapper?.creator_name)`. The localStorage `creator_secret` is the canonical "this browser created this poll" signal (written by `recordQuestionCreation` at create time); the name match is a fallback for cross-browser cases. Whenever you need "this is the current user's poll/vote/content", reach for `isCreatedByThisBrowser` over name comparison.

**`isCurrentUserName(name)`** (in `lib/userProfile.ts`) is the canonical case-insensitive trim-based name match against `getUserName()`. Returns false when no name is saved (so anonymous-name bubbles don't suddenly inherit the current browser's image). Use this anywhere you need "is this bubble's name me?" — don't re-inline the trim + lowercase compare.

**`/info` members list renders avatars per row**. Each `<li>` is a `flex items-center gap-3` row with a `<UserAvatar sizeClassName="w-8 h-8">` on the left and the name on the right. The viewer's row (either literal "You" when no name is saved OR a real-name row that matches `isCurrentUserName`) gets `imageUrl={myUserImageUrl}`; everyone else passes `null` and falls through to initials. Pass `name={name === "You" ? null : name}` so "You" doesn't render as a "Y"-initial disc — `null` produces the anonymous gray fallback, which is the right visual for "you, no real name".

**Three real avatar swap sites**: settings page hero, `GroupCardItem` creator bubble (per-card), and `/info` members list. The home group avatar + group page header avatar use `<GroupAvatar>` which renders `<RespondentCircles>` internally, so they inherit the multi-circle SVG swap automatically when a name in the participant list matches the viewer. Out-of-scope for now: `<VoterList>` pill row (it shows the name as text, not as an initials disc — no swap needed).

---

## Theme Switcher (Light / Dark / System)

The settings page (`app/settings/page.tsx`) exposes a 3-option sliding segmented control for color theme. The preference lives in `localStorage[whoeverwants_theme]` (`THEME_KEY` exported from `lib/theme.ts`); selecting "System" REMOVES the key so the page falls through to `prefers-color-scheme`.

- **Source of truth at runtime is the `data-theme` attribute on `<html>`.** `lib/theme.ts: applyTheme(theme)` sets `data-theme="light"` or `data-theme="dark"`, OR removes the attribute for system. The Tailwind `dark:` variant is redefined in `app/globals.css` via `@custom-variant dark { ... }` so it triggers when `data-theme="dark"` is set OR (no override AND prefers-color-scheme dark). Setting `data-theme="light"` deliberately suppresses every `dark:` utility on the page.
- **CSS custom properties (`--background`, `--foreground`) ALSO follow `data-theme`** via `[data-theme="light"]` / `[data-theme="dark"]` blocks alongside the existing `@media (prefers-color-scheme: dark)` rule. Each block also sets `color-scheme: light|dark` so native form controls (scrollbars, date pickers) follow.
- **Pre-hydration script in `app/layout.tsx <head>` avoids FOUC** by reading localStorage and stamping `data-theme` BEFORE React mounts. The inline script template-interpolates `THEME_KEY` from `lib/theme.ts` so the storage key has a single source of truth. Don't replace the inline script with a React effect — `useEffect` runs after first paint and would flash light→dark on every load. **`<html suppressHydrationWarning>` is load-bearing** because the script's `data-theme` write happens between SSR render (no attribute) and React hydration (attribute present) — without the suppression, React 19 / Next.js 16 logs `A tree hydrated but some attributes ... didn't match` on every load. Scope is one element only (`<html>`); React still validates everything inside `<body>` normally.
- **`THEME_OPTIONS` (in `app/settings/page.tsx`) is module-scope, not per-render.** The array contains static `ReactElement` icons (sun/moon/monitor SVGs); hoisting avoids re-allocating per render. Don't move it back into the component body.
- **Sliding-pill indicator uses `transform: translateX(${selectedIndex * 100}%)`** on an absolutely-positioned span sized at `calc((100% - 0.5rem) / 3)` (the parent's `p-1` reserves 0.5rem of total horizontal padding). Buttons sit at `z-10` over the indicator. Transform animation is GPU-accelerated; no width/layout transitions. If you add a 4th option, recompute the width divisor.

## Push Notifications

Per-group "New Poll" notifications via Web Push (browser / PWA / iOS PWA 16.4+) + APNS (Capacitor native iOS). Toggle lives on `/g/<id>/info` (`components/NotificationSettingsCard.tsx`).

- **`<NotificationSettingsCard className>` overrides the outer `<section>` margin** (default `"mt-6"`). Use the prop when a caller needs different vertical spacing — don't wrap the component in a negative-margin div to fight the default. The /info page uses `mt-[0.96rem]` since the card sits directly under the avatar-title block with tight spacing.
- **Storage shape (migrations 110 + 111).** `push_subscriptions` keyed by `(browser_id, endpoint)` with `kind IN ('web_push', 'apns')` discriminator. `group_notification_preferences` keyed by `(browser_id, group_id)`. **Missing pref row = default ON** — the fan-out query uses `COALESCE(pref.notify_new_poll, TRUE) = TRUE` so we never need to write a row at member-join/create-poll time. Toggling OFF is the only write. `app_config` is a key/value singleton table holding the auto-generated VAPID keypair (lazy-gen on first call to `get_vapid_keys()`).
- **VAPID keys are auto-generated per-tier, persisted in DB.** `services/push.py: get_vapid_keys()` checks `app_config` first; if absent, generates a fresh ECDSA P-256 keypair, persists, and returns. `ON CONFLICT (key)` keeps concurrent callers from racing. Per-tier keys (canary vs prod vs each dev branch) — that's the right shape since subscriptions are origin-scoped anyway. Rotating keys = DB UPDATE; nuking a dev DB requires re-subscribing all that branch's browsers.
- **APNS env vars (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_AUTH_KEY_P8`) live in `/root/whoeverwants/.env.api`** on each droplet (NOT `/root/whoeverwants/.env`, which doesn't exist on these droplets — docker-compose loads `.env.api` via `env_file:` in `docker-compose.yml`). `apns_configured()` reports false when any of the three is unset, and the dispatch path silently skips APNS subscriptions — so deploying without APNS keys is safe (web push still works). `APNS_USE_SANDBOX=1` switches to `api.sandbox.push.apple.com` for development entitlements; leave unset for production. After editing `.env.api`, restart with `docker compose up -d --force-recreate api` (NOT `restart api` — env_file is only re-read on container recreate).
- **APNS Auth Key is reusable across both environments.** When generating in the Apple Developer Portal (Certificates → Keys → +), pick **Sandbox & Production** so one key signs JWTs for both APNS endpoints. The server picks the endpoint by `APNS_USE_SANDBOX`; the entitlement (`aps-environment` in `App.entitlements`) determines which one the device registers against. For TestFlight + App Store, use `production`. The APNS Auth Key MUST have **Admin** role / certificate-management scope, otherwise the JWT signs but APNS rejects it.
- **Two service workers coexist via different scopes.** `/sw.js` and `/sw-mobile.js` (caching) live at scope `/` and are unregistered on dev hosts to avoid stale-cache headaches. `/sw-push.js` (push event handler ONLY, no caching) lives at scope `/push/`. They don't conflict because scope dictates which pages the SW *controls*, NOT which receives push events — `pushManager.subscribe()` works regardless of whether any page under the scope exists. This lets push work on dev servers (where the caching SWs are off) and prod alike.
- **`Notification.permission` returns 'denied' in headless Chromium.** Playwright's `permissions: ['notifications']` context grant doesn't override it. To screenshot the active-state card, inject `Object.defineProperty(Notification, 'permission', {get: () => 'granted'})` via `context.addInitScript()` BEFORE the page loads. Real-browser behavior is what users see; the override is screenshot-only.
- **`ensurePushSubscription()` is idempotent and handles VAPID key rotation.** Before subscribing, it calls `getSubscription()` and compares the existing `applicationServerKey` to the current VAPID public key via `arrayBuffersEqual`. Mismatch → unsubscribe → fresh subscribe. Without this, a dev-DB-nuke (or VAPID key reset) leaves browsers stuck with a stale subscription that the server can no longer sign for.
- **Capacitor APNS registration is event-based, not promise-returning.** `PushNotifications.register()` returns void; the device token arrives via `addListener('registration', ({value}) => ...)` async. Wrap in a `Promise` that resolves on `registration` and rejects on `registrationError`, with a 60s timeout — first-install on a fresh APNS connection routinely takes 20-40s for iOS to deliver the token (after that the connection is cached and it's near-instant). Bootstrap is fire-and-forget so the long wait costs nothing user-visible. Bundle ID is read from `@capacitor/app: App.getInfo()` (matches the iOS topic for the APNS push); fall back to `com.whoeverwants.app` if the lookup fails. **If `register()` reliably hits the timeout instead of firing `registration` or `registrationError`, the cause is almost certainly the AppDelegate forwarding hooks being missing** — not slow APNS. See the "@capacitor/push-notifications requires AppDelegate forwarding hooks" pitfall below for the symptom + fix.
- **iOS `App.entitlements` is required AND wired via `CODE_SIGN_ENTITLEMENTS` in both Debug + Release configs in `project.pbxproj`.** Capacitor's default scaffold doesn't add this file. Without `aps-environment` in entitlements, `PushNotifications.register()` fails with `no aps-environment entitlement string found`. The pbxproj edit sits next to the existing `PRODUCT_BUNDLE_IDENTIFIER` line so the workflow's bundle-id sed-patch doesn't interfere.
- **Each bundle ID needs Push Notifications capability enabled in Apple Developer Portal → Identifiers.** This is per-bundle: `com.whoeverwants.app` AND `com.whoeverwants.app.latest`. Capability mismatch surfaces as `BadDeviceToken` from APNS at send time, not at registration.
- **Fan-out runs via `BackgroundTasks`, not inline.** `create_poll` schedules `fan_out_new_poll(group_id, creator_browser_id, payload)` to run AFTER the create response is sent. Each subscription's send is wrapped in try/except — a slow or failing push service can't slow the creator's API response, and 410/404 responses delete the dead subscription row inline. `pywebpush` is synchronous (requests under the hood); httpx HTTP/2 is used for APNS. For a typical group with <20 members this fan-out is well under a second; for larger groups, switch to a thread pool inside `fan_out_new_poll`.
- **`POST /api/notifications/subscriptions` is upsert-on-(browser_id, endpoint).** Re-subscribing the same browser refreshes encryption keys (Web Push rotates them) AND resets `failure_count`/`last_error`. Don't try to dedupe client-side based on stored subscription state — let the server's ON CONFLICT handle it.
- **Adding a new npm dep requires `npm install --package-lock-only`** to regenerate `package-lock.json` before pushing — the Mac dev-server entrypoint uses `npm ci` which fails hard on lockfile drift. Symptom: dev container loop-restarts with `npm error` referencing `npm ci` not matching `package.json`. Same lockfile must be in the commit. Server-side `uv.lock` is regenerated via `uv lock` from `server/pyproject.toml`; the Dockerfile uses `uv sync --frozen` IF lock exists so it must be committed alongside the dep change.
- **The server-side default-ON pref means nothing without a registered subscription.** `group_notification_preferences` defaults to ON via missing-row semantics, but `fan_out_new_poll`'s recipient query joins through `push_subscriptions` — if the device never POSTed `/api/notifications/subscriptions`, the row count is zero regardless of how many `group_members` rows exist. On the canary droplet, after the feature shipped: 519 group members, 0 push subscriptions, 0 POSTs ever (because the per-group toggle's default-ON UI never triggered `ensurePushSubscription` on its own — it only fired when the user TAPPED the toggle, which most users never did). Fix: `bootstrapCapacitorPushSubscription()` (in `lib/pushNotifications.ts`) is called from `<PushAutoRegister />` (mounted in `app/layout.tsx`) on every page load on Capacitor iOS — calls `ensureCapacitorPushSubscription()` unconditionally when permission isn't `'na'`/`'denied'`, letting iOS itself rate-limit re-prompts (a previous `whoeverwants:ios-push-bootstrap-asked` localStorage flag was retired because it permanently stranded users whose iOS permission state stayed at `'prompt'` — e.g. dismissed dialog — and never let bootstrap retry; the flag value is now dead-but-not-cleaned-up in existing installs and never read again). Web/PWA short-circuits via `Capacitor.isNativePlatform()`. The per-group toggle in `components/NotificationSettingsCard.tsx` ALSO probes `getCapacitorPushPermission()` on mount and gates its `checked` display: when the OS permission isn't granted, the toggle renders OFF (even if server pref is ON) with help text "Tap to allow push notifications on this device" — so the visible state matches actual delivery state. Whenever you add a new "server pref + per-device registration" surface, audit BOTH legs: the pref's default and the device-side registration trigger. Default-ON server prefs are only honest if the device-side state mirrors them.
- **`bootstrapCapacitorPushSubscription` + `runCapacitorPushRegistration` log every outcome at `console.warn` level.** Tags: `[push-bootstrap]`. The bare `catch {}` blocks were originally silent because the helpers are fire-and-forget, but that hid every failure mode on real devices — when zero subscriptions were registered out of 15 group members, there was no way to tell whether (a) `Capacitor.isNativePlatform()` was returning false, (b) the dynamic import of `@capacitor/push-notifications` was failing (TestFlight build missing the plugin), (c) `requestPermissions` returned denied, (d) `register()` timed out waiting for the APNS token, or (e) the POST to `/api/notifications/subscriptions` was rejecting. Each branch now emits a distinct warn that the canary log forwarder picks up (`isHighVolumeHost()` in `lib/clientLogForwarder.ts` forwards warn+error on `latest.whoeverwants.com` / `whoeverwants.com`). Success ALSO logs at warn (token prefix only — never the full token, since it's effectively a credential) — this trades a small amount of log volume for the ability to verify on real devices that registration actually completed. To diagnose a "no notification" report: `curl -s "https://latest.whoeverwants.com/api/client-logs?search=push-bootstrap&limit=50" | python3 -m json.tool`. Once subscriptions reliably register and we have a corpus of devices to compare, the success log can be dropped to `console.info` (not forwarded on prod hosts).
- **`@capacitor/push-notifications` requires AppDelegate forwarding hooks; the plugin does NOT auto-swizzle.** `ios/App/App/AppDelegate.swift` must implement `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` AND `application(_:didFailToRegisterForRemoteNotificationsWithError:)` — each posts to `NotificationCenter.default` with the plugin's named notification (`.capacitorDidRegisterForRemoteNotifications` / `.capacitorDidFailToRegisterForRemoteNotifications`). Without these, `PushNotifications.register()` returns OK on the device but iOS's APNS callbacks are silently dropped — JS hangs at `addListener("registration", ...)` until the timeout fires. Symptom captured on canary: every iOS launch produces `[push-bootstrap] ensureCapacitorPushSubscription threw Error: Timed out waiting for APNS registration` with no preceding `registrationError` event, regardless of how long the timeout is bumped to. Fix is two ~3-line methods in the existing AppDelegate class (no new .swift file needed — colocate to avoid `project.pbxproj` patching per the existing rule). Verify the build picked it up by greping the IPA's `AppDelegate.swift` for `capacitorDidRegisterForRemoteNotifications` after `npx cap sync ios`. Audit checklist when adding any new Capacitor plugin that handles iOS system callbacks: skim the plugin's README → grep our AppDelegate.swift for the documented forwarding calls. Don't trust `npx cap sync` to do this — it only touches generated SPM packages, not AppDelegate.
- **`PushNotifications.addListener` leaks listeners across calls if you don't `.remove()` the returned handle.** The first iteration of `ensureCapacitorPushSubscription` registered listeners inside the `Promise<token>` executor and never removed them. Every subsequent call (toggle off→on→off→on, or `PushAutoRegister` + per-group toggle) would pile up listeners that all fire on every `register()`. Fix: install listeners BEFORE calling `register()` (so the `registration` event can't race the `addListener` handle assignment), and `Promise.allSettled([regHandle.remove(), errHandle.remove()])` in a `finally` block. The `await Promise.allSettled` form keeps the cleanup non-throwing without two nested try/catches. Pattern applies to any Capacitor plugin's `addListener` — assume listeners persist for the page lifetime unless you explicitly `.remove()`.
- **Don't await `ensurePushSubscription()` in interactive UI when permission is already granted.** The native-iOS branch runs `PushNotifications.register()` and waits up to 15s for the `registration` event before the helper resolves. If the per-group notification toggle awaits it inside the same `try` that calls `apiSetGroupNotificationPref`, the switch sits in `saving=true` (disabled + dimmed but visually ON from the optimistic `setEnabled(true)`) for that whole window — long enough that users navigate away assuming it's stuck, and the pref save never fires. On return, the server pref is unchanged and the toggle reverts to OFF. Fix in `components/NotificationSettingsCard.tsx: onToggle`: when `capability?.capacitorNative === true && iosPermissionGranted`, fire `ensurePushSubscription()` as `void ensurePushSubscription().catch(() => {})` (background refresh) and proceed straight to the per-group pref save. The `'prompt'` / web-push / first-time-grant branches still await because they need the user's permission decision (or the web-push endpoint POSTed) before the pref save makes sense. The launch-time `bootstrapCapacitorPushSubscription` already registers the APNS token on every app open, so the background refresh is a true no-op confirmation, not a load-bearing call.
- **`ensureCapacitorPushSubscription` is internally in-flight-coalesced via a module-level `capacitorRegistrationPromise`.** Bootstrap fires on every layout mount (Capacitor iOS) and the per-group toggle's background refresh fires on tap; without coalescing they'd install duplicate listener sets, call `register()` twice, and POST the same APNS token to `/api/notifications/subscriptions` twice on every overlap. The dedupe pattern mirrors the SW `registrationPromise` above it — single promise per in-flight call; both callers subscribe to the same resolution; `capacitorRegistrationPromise = null` in `finally` so the next call after settlement does a fresh registration. The split into `ensureCapacitorPushSubscription` (coalesce wrapper) + `runCapacitorPushRegistration` (actual work) keeps the early-return / coalesce logic separate from the listener-install / register flow.

### Poll-Closed + Phase-Transition Notifications (migration 120)

The single per-group `notify_new_poll` toggle now governs THREE events: new poll (existing), **poll closed**, and **prephase → voting transition**. The column name is historical; the FE label was changed from "New Poll" to "Activity" to reflect the wider scope. Don't add a second toggle without an explicit ask.

- **The app computes "closed" / "prephase over" LAZILY on read — nothing in the app acted on deadlines passing before this feature.** `is_closed` was never flipped when `response_deadline` passed (the FE derived "closed" from `is_closed AND response_deadline`); the vote endpoint only checked `is_closed`, so a poll past its deadline technically still accepted votes server-side. Migration 120 + the cron tick close that hole: `is_closed` becomes authoritative. If you add any new deadline-driven behavior, remember there is NO eager deadline processor except `POST /api/internal/tick`.
- **`POST /api/internal/tick` (`server/routers/internal.py`) is the only server-side deadline actor.** Bearer-gated by `INTERNAL_TICK_SECRET`; 503s when the env var is unset (dev tiers without it just don't run it). Three passes per tick, all idempotent via atomic `UPDATE ... RETURNING`: (1) flip `is_closed` for past-`response_deadline` polls (`close_reason='deadline'`), (2) claim every `is_closed AND NOT close_notified` poll → fire `fan_out_poll_closed`, (3) claim every past-prephase `NOT prephase_notified AND NOT is_closed` poll → finalize its questions' options → fire `fan_out_phase_transition`. Hit once a minute by `scripts/notification-tick.sh` (host crontab, added by `provision-droplet.sh`). Exempt from rate limiting (`/api/internal/` prefix in `RateLimitMiddleware`).
- **Idempotency lives in the `close_notified` / `prephase_notified` flags, NOT the `is_closed`/`prephase_deadline` transition.** This is what lets the SAME notification fire-once whether the close came from the explicit `/close` endpoint (fires inline via `BackgroundTasks` + sets the flag), auto-close (`_check_auto_close` deep in the vote path — no `BackgroundTasks`, so the tick catches it), or a deadline. Explicit `/close` and `/cutoff-*` fire INLINE (instant + demoable without cron) AND set the flag so the tick won't double-send. `reopen` resets `close_notified=false` so a reopen→close cycle re-notifies. The cron is the backstop for the no-endpoint-ran paths (deadline, auto-close).
- **Close audience = whole group with pref on, NO actor exclusion** (unlike new-poll, which excludes the creator). A close is detected by the cron decoupled from whoever closed it, deadline closes have no actor, and the creator legitimately wants the "results are in" ping. `fan_out_poll_closed(group_id, poll_id, payload)` in `services/push.py`.
- **Phase-transition skip rule (the one subtle bit): notify everyone in the group EXCEPT members where prevoting was on AND they prevoted AND no option-adding contribution arrived after their last view.** Never-prevoters are notified (they may have been holding off until options settled); prevoters with unseen options are notified; only the prevoter who already saw the final set is skipped. `fan_out_phase_transition(group_id, poll_id, payload, *, prevoting_on, latest_contribution)` implements it as a `NOT (prevoting_on AND EXISTS(vote by member) AND latest IS NOT NULL AND EXISTS(poll_view >= latest))` clause. `latest_contribution` = `MAX(created_at)` over option-adding votes (suggestions OR `voter_day_time_windows`). Membership keyed per browser_id (matches new-poll); a person on two browsers who prevoted on one may still be notified on the other — accepted for v1.
- **Two new schema dependencies feed the skip-logic.** `votes.browser_id` (migration 120, nullable — historical votes have none) links a vote to the caller so "did this member prevote?" is answerable; captured on INSERT only (`_submit_vote_to_question(..., browser_id=)`), never on edit. `poll_views(browser_id, poll_id, last_viewed_at)` is the per-member "last looked at it" watermark, upserted by BOTH the FE `/viewed` ping (poll detail page, only while the prephase is active) AND the vote path (`_record_poll_view` — voting IS viewing). The `/viewed` endpoint uses an `INSERT ... SELECT ... WHERE EXISTS(poll)` guard so an unknown poll id no-ops instead of FK-500ing.
- **Payload builders + schedule helpers live in `routers/polls.py` and are imported by `routers/internal.py`.** `_notification_base(conn, poll_id)` is the shared fetch/title/url; `_build_close_notification` / `_build_transition_notification` are thin wrappers adding title+tag (+ prevoting/latest for transition). `_schedule_close_notification` / `_schedule_transition_notification` build-and-`add_task` gated on the already-notified flag. The tick imports the two `_build_*` and calls the `fan_out_*` directly (it dispatches inline, post-claim, not via BackgroundTasks). Base payloads carry NO hardcoded badge — the real per-recipient count is injected downstream in `_dispatch_pushes` (`_payload_for`); when no count is present (computation failed) `_send_apns` omits `aps.badge` so iOS leaves the icon untouched rather than stamping a phantom "1".
- **Notification message shape: line 1 = `<event> in "<Group name>"`, line 2 = `<icon> <poll title>`.** (`title` renders as the banner's first line on both web push `showNotification(title, {body})` and APNS `aps.alert.title`; `body` is the second line — so the poll-title body DOES render on iOS as the second line, no folding-into-title needed.) The events: `New poll in "<G>"`, `Poll closed in "<G>"`, the phase-transition event (per-prephase-kind, see next bullet), `Join request for "<G>"`. **Phase-transition copy is prephase-kind-specific** via `_transition_event_phrase(question_rows)` in `routers/polls.py`: a poll whose only prephase kind is `ranked_choice` → `New options available in "<G>"` (the suggestion phase ended, there are new options to rank); a `time`-only poll → `Time to vote in "<G>"` (availability collected, like/dislike vote opens); a poll mixing BOTH ranked_choice + time (or anything with no recognized prephase kind) → the generic `Voting is open in "<G>"` fallback. `_notification_base` returns `question_rows` as its 5th tuple element so the transition builder can branch on `{sp["question_type"]}`; the close builder ignores it. When adding a new prephase-bearing question type, extend `_transition_event_phrase`'s type set. Two shared helpers in `services/groups.py`: `group_display_name(conn, group_id, *, override)` resolves the group's name (the `groups.title` override → deduped participant names "creators first, then voters" → `None`), and `group_name_phrase(...)` wraps it as a double-quoted name or the unquoted literal `your group` (quoting "your group" would read wrong). `routers/polls.py` builds line 2 via `_poll_body(row, question_rows)` = `_poll_own_title` (the poll's OWN title, bypassing the `group_title` override the way `_compute_display_title` does NOT — that override-collapse was why the old line 2 showed the group name) prefixed by `_question_icon` ONLY when the poll has exactly one question (multi-question polls have no single category → title alone). `_question_icon` + the `_CATEGORY_ICONS` / `_QUESTION_TYPE_SYMBOLS` dicts are a Python mirror of the FE `getCategoryIcon` (`components/TypeFieldInput.tsx: BUILT_IN_TYPES` + `lib/questionListUtils.ts`) — keep them in sync when adding a category. The join-request body stays generic (`"<email> wants to join"` / `"Someone wants to join"`) since passkey-only requesters have no email. **Pitfall: a poll created WITH `group_title` set at create time (the API-only "mint a fresh group named X" path) stores that name as the question title too (`question_title = req.title or req.group_title or ...`), so line 2 would echo the group name — but the FE create flow never passes `group_title` (renames go through `POST /api/groups/{id}/title`), so this only bites raw-API callers.**
- **App-icon badge model is "hardcoded 1", not a real unread count.** APNS already sent `aps.badge=1`; `sw-push.js` now also calls `navigator.setAppBadge(payload.badge)` on web/PWA, cleared on notification click AND on app focus (`clearAppBadge()` in `lib/pushNotifications.ts`, wired into `PushAutoRegister`'s visibilitychange/focus listeners). iOS native badge-zeroing would need a Capacitor plugin (+ rebuild) — out of scope; the iOS badge clears when the user taps the notification.
- **DEPLOY CAVEAT (read before merging / cutting a release).** The push-to-main / release webhook auto-applies migration 120 AND the new code, so the INLINE close/cutoff pushes work on canary/prod immediately. But the webhook does NOT run `provision-droplet.sh`, so the **per-minute crontab entry + `INTERNAL_TICK_SECRET` in `.env.api` + an `api` container recreate** (env_file is read only on create) are NOT installed automatically — the DEADLINE-driven closes/transitions won't fire until those one-time steps run on each droplet via `scripts/remote.sh` / `scripts/remote-latest.sh`. Also note migration 120's backfill flips `is_closed=true` for all already-past-deadline polls on apply (intended — makes `is_closed` authoritative + prevents a first-tick notification storm); it's a real data change that lands automatically on deploy.
- **Push DELIVERY can't be scripted in a demo** — it needs a real subscribed endpoint (browser with notifications granted, or a TestFlight device). The recipient-SELECTION logic + endpoint wiring + flag transitions ARE testable/demoable (15 tests in `server/tests/test_notification_events.py`; the transition skip-logic is the highest-value one). When verifying on dev, prove the recipient set via the SQL against live data rather than expecting a delivered banner.

#### Follow-ups (TODO — deferred from the shipping PR #466)

Real-device feedback after shipping surfaced four refinements. Items 1, 3, and 4 are **done**; only item 2 remains open (not a blocker).

1. ~~**Phase-transition push copy is too generic — make it option-specific + show the poll title.**~~ **DONE** (`_transition_event_phrase` in `routers/polls.py`): ranked_choice-only prephase → "New options available", time-only → "Time to vote", mixed/other → "Voting is open" fallback. The poll title still renders as line 2 (`aps.alert.body` / web `options.body`) — verified by code that iOS receives it in the standard `aps.alert.body` field, so no folding-into-title was needed. Tests in `test_notification_events.py` (`test_cutoff_availability_uses_time_to_vote_copy`, `test_transition_event_phrase_per_prephase_kind`, updated `test_cutoff_suggestions_sets_flag_and_fires`).
2. **Show the "new options were added" banner immediately when the poll opens from a notification tap — not only after tapping the edit/ballot button.** Today the new-options banner appears only when the user clicks into the ballot. On landing on the poll detail page (`app/g/[groupShortId]/p/[pollShortId]/page.tsx`) with unseen new options, surface the banner upfront. New-options detection lives in `lib/browserQuestionAccess.ts` (`storeSeenQuestionOptions` / `getSeenQuestionOptions`) + the `newOptions` computation in `QuestionBallot`.
3. **Clicking the banner itself enters edit mode with the new options pre-placed. SHIPPED.** When the voter has ranked but isn't editing, the amber "new options available" banner in `components/RankingSection.tsx` is a `<button>` (with a "— tap to rank" suffix + right chevron); tapping it calls `enterRankingEdit()` (extracted from the existing Edit button, so the abstain-restore logic is shared) → `setIsEditingRanking(true)`. Everything downstream was already wired: `RankableOptions` restores prior rankings via `initialRanking`/`initialTiers` (keyed on `isEditingRanking` so it remounts on entry) and drops the new options into the unranked "No Preference" pool (sorted to top via the `newOptions` prop, NEW badge). While ALREADY editing, the banner downgrades to a static informational `<div>` (no chevron, no "tap to rank") since there's nothing left to enter — gate is `newOptionsBannerClickable = hasNewOptions && !isEditingRanking && !isQuestionClosed && !isLoadingVoteData`. Note this is only reachable today in the post-vote summary while the suggestion phase is still OPEN (early-voting) — once the phase closes, `QuestionBallot` shows the "Your Ballot" amber link instead of `RankingSection`, so making the banner reachable after a phase-transition notification tap is still item 2's job.
4. **Rich-option metadata (favicon/underline/clickable) cross-browser propagation — FIXED.** A search-picked suggestion (restaurant/location with favicon, rating, coords) rendered as a rich `OptionLabel` only for the submitter; other voters saw plain text. Tracing `voteDataBuilders.ts → merge → polls_for_poll_ids → OptionLabel` end-to-end found the FE always SENT the metadata correctly (insert + edit) and the bulk read path (`polls_for_poll_ids` → `_row_to_question`) always SURFACED it — the drops were:
   - **Server EDIT path never persisted `options_metadata`.** Only `_submit_vote_to_question` (insert) merged it into `questions.options_metadata`; `_edit_vote_on_question` didn't, `EditVoteRequest` had no such field, and `_vote_item_to_edit_req` didn't forward it. So adding a search-picked suggestion to an *existing* vote (the common 2nd+ suggestion case in an active suggestion phase) dropped its metadata for everyone but the submitter — and permanently, once finalized into `questions.options`. Fix: extracted the merge into a shared `_merge_suggestion_metadata(conn, question_id, options_metadata, suggestions)` (`services/questions.py`, gated on both present) called from BOTH insert and edit; added `options_metadata` to `EditVoteRequest` + `_vote_item_to_edit_req`. **When adding a new field that a vote can contribute to the question row, wire it through BOTH `_submit_vote_to_question` AND `_edit_vote_on_question` (+ both request models + `_vote_item_to_*_req`) — the edit path is the easy one to forget.**
   - **FE `optionsMetadataLocal` only re-synced on `question.id` change.** `QuestionBallot` seeds `optionsMetadataLocal` from `question.options_metadata` and previously only reset it when `question.id` changed — so a cache-first mount with a stale poll, or the group page's 5s refresh bringing in another voter's metadata for the SAME question, never reached the ballot (a truly-fresh viewer worked because the `useState` initializer caught it). Fix: kept the `[question.id]` reset (full replace, so one question's metadata can't leak into another's) AND added a merge effect on `[question.options_metadata]` (merge not replace, so the submitter's in-flight metadata survives the round-trip; returns `prev` when nothing's new to avoid re-render churn).
   - Note: `_compute_results` returns `options_metadata=None` on `QuestionResultsResponse`, but no FE consumer reads it (`QuestionResultsDisplay` takes `optionsMetadata` as a prop sourced from `question.options_metadata`), so that null is irrelevant — don't "fix" it. Regression coverage: `server/tests/test_options_metadata.py` (insert + edit propagation + bulk group read).

## App-Icon Badge Model + Viewed Tracking (migration 121)

> **Intent doc + spec.** The app-icon badge is no longer a hardcoded "1" dot. Its *meaning* is a per-user choice, exposed as **three account-synced switches** in Settings. Same notification triggers as migration 120 (new poll / poll closed / prephase→voting); this layer decides how those events translate into a *number* on the icon, and reframes the per-poll "respondents" roster into a **"Viewed (N)"** list.

### The two badge meanings + the three switches

Settings exposes three `SliderSwitch`es (account-synced — see storage below). Sensible defaults chosen so a casual user who never touches Settings gets the "unread" behavior:

1. **`badge_todo_mode`** (default **OFF**). The headline switch.
   - **OFF = Unread model** (casual default): badge = count of polls with *notification activity you haven't looked at*. **Opening a poll's detail page clears it** from the badge. This is the "open the app, the number goes away" behavior casual users expect.
   - **ON = To-do model** (power users): badge = count of *open, votable polls you haven't voted or abstained on*. **Only voting or abstaining clears a poll** — merely seeing it never does. This is what forces power users to explicitly abstain on polls they don't want, instead of looking-and-ignoring.
2. **`badge_on_voting_open`** (default **ON**). Whether a prephase→voting transition re-lights a poll on the badge. **Applies to the unread model only**; inert (and rendered disabled) when `badge_todo_mode` is ON, where the badge is purely the awaiting-action set.
3. **`badge_on_results`** (default **ON**). Whether a poll closing ("results are in") re-lights a poll on the badge. Same unread-only applicability as #2.

New polls always contribute (no switch) — in unread they're a never-opened poll, in to-do they're a fresh awaiting poll. Switches 2/3 are the Q4 "re-light" fork turned into user-tunable knobs.

**Badge set, precisely.** A poll P contributes to browser B's badge iff B is a `group_members` row for P's group AND:
- **To-do mode**: P is not closed, votable now (`prephase_deadline` IS NULL or passed), deadline not passed, AND B has no `votes` row on any of P's questions (vote OR abstain — both insert a row). Views never matter.
- **Unread mode** (any of, gated by the toggles): (a) P never viewed-since-created (`poll_views.last_viewed_at` IS NULL or `< P.created_at`); (b) `badge_on_voting_open` AND P transitioned (`prephase_deadline` passed) since last view; (c) `badge_on_results` AND P closed (`updated_at` close-proxy) since last view. Opening P's detail page bumps `last_viewed_at`, clearing all three.

### "Seen" + "Ignored" + the Viewed (N) list

- **"Seen" = opening the poll detail page** (`/g/<g>/p/<p>`). The FE pings `POST /api/polls/{id}/viewed` on **every** detail-page open (migration 120 added the endpoint + `_record_poll_view`; this broadens the ping from prephase-only to always). That single watermark (`poll_views.last_viewed_at`) feeds BOTH the unread badge (clears it) and the viewed list.
- **`poll_views.first_viewed_at`** (added in migration 121, set on insert, NOT bumped on re-view) is the stable clock for "ignored": a viewer is **ignored** when they have a `poll_views` row, `first_viewed_at` is older than **5 minutes**, and they have no vote/abstain on the poll. Within the 5-minute window a no-action viewer is "still looking" (not yet ignored). Derived at read time — no cron, no client beacon needed; "navigates away" and "5 min elapsed" both collapse to "first saw it ≥5 min ago without acting".
- **The respondents roster becomes "Viewed (N)".** N = everyone who opened the poll = named voters + anonymous voters + ignored (viewed-no-action) viewers. Vote state is a **secondary per-person marker**: named/anon voters render as chips (via the existing `VoterList`), and the ignored viewers — mostly nameless (they never submitted a `voter_name`) — surface as a muted "N viewed but haven't responded yet" sub-line. Backend adds `viewed_ignored_count` to the poll-level voter aggregate (alongside `voter_names` + `anonymous_count`) via `_compute_poll_voter_data` (a 3-tuple now — all 7 callsites + `_row_to_poll` updated); FE threads it `PollResponse` → `Poll` (`toPoll`). **The relabel lives at the poll-detail page level, NOT in `VoterList`**: the detail page's "Respondents" `<h2>` becomes "Viewed ({named + anon + ignored})" and renders the muted sub-line when `viewed_ignored_count > 0`. `VoterList` itself is unchanged — it still renders the voter chips below the heading. (An earlier pass added a `staticIgnoredCount` prop + a multi-line "Viewed (N)" branch to `VoterList`, but both static callers — poll detail + group card — use `singleLine`, so that branch was unreachable; it was reverted. If a future multi-line static roster needs the count, do the relabel at that callsite too rather than reviving the dead `VoterList` branch.)

### Storage (per account, synced)

- Authoritative location: `users.badge_todo_mode` / `users.badge_on_voting_open` / `users.badge_on_results` (BOOLEAN, defaults false/true/true). Surfaced on `UserSummary` (rides every sign-in response + `/api/auth/me`) and `SessionUser` (FE). Written via `POST /api/auth/me/badge-settings` (signed-in only). On sign-in the account values are authoritative; mirrored to a localStorage cache for the client-side badge resync.
- **Anonymous fallback**: anonymous users have no `users` row, so their preference lives in localStorage only and shapes the **client-side** badge (web/PWA `setAppBadge`). Their **server push** badge uses the defaults (unread, both re-light ON) — once they sign in, the account settings apply to pushes too. Documented limitation, mirrors the display-name local↔account pattern.

### Badge computation — where the number comes from

- **Server (push payloads), per recipient.** `_send_apns` only sets `aps.badge` when the payload carries an int (omits it entirely otherwise — never a phantom `1`), and `_dispatch_pushes` injects a per-recipient `badge` computed by `compute_badge_count(conn, browser_id, settings)` in `services/push.py`. Settings per recipient = account columns via browser→user, else defaults. Recipient sets are small (group membership), so a per-recipient count query in the dispatch loop is acceptable at current scale (documented; batch later if needed).
- **Client (web/PWA), on focus.** `GET /api/notifications/badge` returns `{count}` for the current browser+settings (the single source of truth shared with the push path). `PushAutoRegister`'s focus/visibility handler calls it and `setAppBadge(count)` — replacing the old blind `clearAppBadge()`. So an unread-mode user who reads on device A sees device B's badge correct itself on next focus.
- **Native iOS (Capacitor).** Badge is push-driven (`aps.badge` from the per-recipient payload) AND now live-resynced on app open / focus via the **`AppBadgePlugin`** colocated in `ios/App/App/AppDelegate.swift` (exposes `setBadge({count})` → `UNUserNotificationCenter.setBadgeCount` on iOS 16+, `applicationIconBadgeNumber` fallback on iOS 15). `lib/pushNotifications.ts: setAppBadge` / `clearAppBadge` route through this plugin when `Capacitor.isNativePlatform()`, since WKWebView doesn't expose the Web Badging API. The existing `PushAutoRegister` resync (`refreshAppBadge` on mount/focus/visibility/session-change) therefore drives the native icon badge to the true count — clearing a stale badge for a signed-out / no-group user (server returns 0). **This closes the bug where a "1" badge stuck on the icon on a fresh install / TestFlight update** (iOS preserves the icon badge across app updates, and there was previously no way to clear it from the WebView). Clearing (count 0) works without notification auth; setting > 0 needs the `.badge` permission the push bootstrap requests. Requires a fresh iOS build for the native plugin to ship; the JS half reaches the device via the WebView's deployed URL. Verifying the native icon badge change requires a real device (Simulator doesn't render app-icon badges reliably).

### Status / sequencing

Built as coherent increments on `claude/ios-badge-model-1Ennb`: (1) schema + account-synced settings + Settings switches + client/server badge honoring the model; (2) seen-ping broadening + Viewed (N) list. Native-iOS live resync shipped on `claude/ios-app-badge-bug-muYxL` via `AppBadgePlugin` (see the "Native iOS (Capacitor)" bullet above) — the badge now self-corrects on app open instead of being eventually-correct via push/tap only.

## Geolocation (Native + Web)

`lib/geolocation.ts` is the canonical entry point for "where is the user?" — every callsite must route through it, not directly through `navigator.geolocation`.

- **WKWebView in Capacitor silently denies `navigator.geolocation`.** Capacitor's `CAPBridgeViewController` doesn't implement `WKUIDelegate.webView(_:requestGeolocationPermissionFor:initiatedBy:decisionHandler:)`, so a JS call to `navigator.geolocation.getCurrentPosition` in the iOS app produces no permission prompt, no error, and no position — the callback just never fires (or fires the error callback with a generic POSITION_UNAVAILABLE depending on iOS version). Adding `NSLocationWhenInUseUsageDescription` to Info.plist is necessary but NOT sufficient — the plist key enables the OS prompt, but without a delegate to receive the WebView's geolocation request, the prompt never shows. The fix is the `@capacitor/geolocation` plugin, which bridges to native Core Location.
- **`getCurrentPosition(options?)` dispatches to native or web.** Under `Capacitor.isNativePlatform()` it dynamic-imports `@capacitor/geolocation` and routes through `Geolocation.checkPermissions() → requestPermissions() → getCurrentPosition()`. On web (browsers / PWA / iOS PWA) it falls back to `navigator.geolocation`. Both paths return the same `Coords` shape (`{latitude, longitude}` from `lib/userProfile.ts`) and throw a unified `GeolocationDeniedError` when permission is refused so callers can `instanceof`-branch the catch instead of string-matching.
- **`detectAndSaveUserLocation()` is the full pipeline** — calls `getCurrentPosition()`, reverse-geocodes via `apiGeocode(...)`, builds a label fallback, and persists via `saveUserLocation(...)`. Both detect-location callsites (`components/ReferenceLocationInput.tsx`, `app/settings/page.tsx`) consume this helper; differences are confined to UI state (input clear, `setMessage` vs `setError`). When adding a third "detect my location" surface, reuse this helper rather than re-doing the pipeline.
- **`NSLocationWhenInUseUsageDescription` MUST be in `ios/App/App/Info.plist`** with a justification string the user will actually see in the permission prompt. iOS rejects the app at first geolocation request with no prompt at all if the key is missing. No matching entitlement is needed — `aps-environment` and `com.apple.developer.associated-domains` are separate capabilities; geolocation has no entitlement.
- **`NSLocationAlwaysAndWhenInUseUsageDescription` is ALSO required alongside the when-in-use key**, even though we only request when-in-use access. Apple's `ITMS-90683` post-upload warning flags any binary that references the always-and-when-in-use API surface — and `@capacitor/geolocation` (or a transitive dep) does, regardless of whether the JS layer ever asks for "always" permission. The warning is non-blocking (the upload succeeds, TestFlight build still distributes) but compounds across builds and surfaces to App Store reviewers. Set it to the same user-facing string as the when-in-use key so the prompt copy stays consistent regardless of which key iOS surfaces. General rule for ITMS-90683-style warnings: the offender is usually a Capacitor / SwiftPM dep referencing the API, not the app's own code — just add the requested key with the existing wording rather than chasing the SDK reference.
- **`Coords` lives in `lib/userProfile.ts`, and `UserLocation extends Coords`.** Don't redefine the lat/lng pair locally — import from `userProfile.ts`. The label (city/zip display string) is the only thing `UserLocation` adds on top.
- **Native dispatch uses the dynamic-import-Capacitor-plugin pattern** (`await import("@capacitor/...").catch(() => null)`), matching `lib/pushNotifications.ts: ensureCapacitorPushSubscription` and `lib/universalLinks.ts: installUniversalLinksHandler`. The chunk only loads on the native bundle; web bundles include the chunk but never execute it (the `Capacitor.isNativePlatform()` short-circuit returns false). Don't `import` the plugin statically at module top — that pulls it into every web bundle for no benefit.
- **Four plugins now use this pattern** (`geolocation`, `pushNotifications`, `universalLinks`, `clipboardLinkPrompt`). The 5th occurrence triggers the extraction of a shared `loadCapacitorPlugin<T>(name, exportKey)` helper; the current ~4-line repetition is below the abstraction threshold.

## Haptics (Native + Web)

`lib/haptics.ts` is the canonical entry point for "give the user a tactile bump on this action" — every callsite must route through `haptic.{light,medium,heavy,success,warning,error}()`, not `navigator.vibrate` directly.

- **`navigator.vibrate` is a no-op on iOS WebKit** — Safari mobile, iOS PWA, and (most importantly) the Capacitor `WhoeverWants Latest` / prod WebView all ignore the Vibration API entirely. Apple has never implemented it. The pre-haptics-PR codebase had 4 `navigator.vibrate(N)` calls (long-press × 2, swipe-threshold, swipe-commit) that worked on Android but were silently dead on every iOS surface, which is the entire user-installed iOS app. Always route through `lib/haptics.ts` so the native-iOS branch fires Capacitor → Core Haptics. Treat any new `navigator.vibrate` in a PR as a bug.
- **Module pattern matches `lib/geolocation.ts` / `lib/pushNotifications.ts`.** Module-level `bridgePromise` caches the dynamic-imported `@capacitor/haptics` bridge; first call resolves it, every subsequent call awaits the same promise. On non-native (`!Capacitor.isNativePlatform()`) the dynamic import never runs and we fall straight through to `navigator.vibrate` (works on Android, no-op on iOS Safari / PWA — acceptable, those users have no equivalent affordance).
- **Semantic levels, not raw durations.** Six exported wrappers (`haptic.light` / `.medium` / `.heavy` / `.success` / `.warning` / `.error`) each map to `ImpactStyle.Light/Medium/Heavy` + `NotificationType.Success/Warning/Error` on native, with web-vibrate fallback durations (`10/20/35/30/40/50` ms). Adopt iOS HIG conventions: impact for tap-feedback ("button registered"), notification for action results ("task done / failed"). Don't reach for the raw fallback ms — pick the level that names the user-facing concept.
- **Fire at the moment of commit, not after API resolves.** Every instrumented site fires the haptic synchronously at the click handler entry (or at the modal-confirm callback) — BEFORE the `await apiFoo(...)` call. Users expect the bump to coincide with the press, not with the network round-trip 500ms later. The `success` notification fires on commit for vote/save/create paths even though that's slightly off-spec (HIG says success = after the task completes); the trade-off is snap-of-feedback over technical correctness. If you ever need true "success after API" semantics, fire `haptic.medium()` on tap PLUS `haptic.success()` after the resolve — but no current site does this.
- **Inventory of instrumented sites (commit moments only — UI state changes below "form-field threshold" deliberately uninstrumented):**
  - Vote submit: `components/QuestionBallot.tsx: submitVote` (success), `lib/useGroupVoting.ts: confirmPollSubmit` (success), `lib/useGroupVoting.ts: submitYesNoChoice` (success).
  - Poll create: `app/create-poll/page.tsx: handleSubmitClick` (success — fires after validation passes, before API call).
  - Confirmation modal confirms (close/reopen/cutoff-suggestions/cutoff-availability/forget): `app/g/[groupShortId]/GroupPage.tsx` `pendingAction` `onConfirm` (single `haptic.medium()` at the top of the handler, BEFORE the per-kind branches so the same feel applies to every action).
  - Bulk-forget confirm: `components/GroupList.tsx: handleConfirmDelete` (medium).
  - Edit-title + group image save: `app/g/[groupShortId]/edit-title/page.tsx: save` (success).
  - Settings profile image save: `app/settings/page.tsx: saveImageChange` (success).
  - Settings main save: `app/settings/page.tsx: handleSave` (success).
  - Notification toggle: `components/NotificationSettingsCard.tsx: onToggle` (medium).
  - new group button: `app/template.tsx: CreateGroupButton.onClick` (medium).
  - Share buttons: `components/GroupShareButton.tsx`, `components/PollShareButton.tsx` (both light — share is borderline-significant; light keeps it from feeling like a vote).
  - Long-press → modal open: `app/g/[groupShortId]/GroupCardItem.tsx` (medium — migrated from `navigator.vibrate(50)`).
  - Long-press → enter group selection mode: `components/GroupList.tsx: enterSelectionWithGroup` (medium — migrated from `navigator.vibrate(50)`).
- **Deliberately NOT instrumented** (below the "above form-field filling out" threshold the user set when this shipped): theme switcher (preference change, no commit semantics), category bubble taps (opens the create modal — opening a modal is navigation, not commit), every text input / dropdown / slider in the create-poll modal (filling in fields), the back-arrow on group / info / edit-title (nav). If a future request asks "why doesn't X tap give haptic feedback?" check this list first — most omissions are intentional.
- **No new iOS build needed when changing haptic call sites.** `@capacitor/haptics` was already in `package.json` and so was already bundled in every TestFlight build going back to before this PR (it just wasn't called). The native plugin lives in the IPA; the web bundle decides whether to call it. So a new haptic site lands the same way any other web change does: push → deploy to `latest.whoeverwants.com` (or prod release) → next WebView page load picks it up. No need to trigger `ios-build.yml` for haptics changes alone. (Adding a different Capacitor plugin DOES require a fresh build because the native code is per-plugin.)
- **Verifying haptics requires a physical iOS device.** Headless Chromium has no haptics engine; iOS Simulator on a Mac does NOT vibrate (Apple disabled simulator haptics deliberately). The only way to confirm a new haptic site is to install the `WhoeverWants` / `WhoeverWants Latest` TestFlight build on a real iPhone, navigate to the affected surface, and feel for the bump. Dev/canary tier hosts the web code so as soon as the branch deploys to `latest.whoeverwants.com` the existing TestFlight app picks it up — no rebuild required.

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

### Suggestion / Availability Deadline (starts at creation)

> **Migration 118 removed the "deferred until first submission" behavior.** The prephase (suggestion / availability) countdown now starts at poll creation. There is no open-ended "waiting for the first response" phase, and empty cutoffs (deadline passes with zero submissions) are accepted — that's the trade-off the user chose for predictable, immediately-ticking timers. The history below describes the retired design; the bullets describe current behavior.

- **The prephase deadline is armed at creation, never on first submission.** `_insert_poll` (`server/routers/polls.py`) resolves a preset `prephase_deadline_minutes` to an absolute `polls.prephase_deadline = now + minutes` at create time, capped to `response_deadline - 1 minute` when a voting deadline exists. A custom absolute `prephase_deadline` passes through unchanged. `prephase_deadline_minutes` is still stored (it's the per-question "this is a suggestion-mode question" signal the FE reads via `question.suggestion_deadline_minutes`) but it's no longer used to defer the deadline.
- **No per-vote arming.** `_submit_vote_to_question` does NOT touch `prephase_deadline` — the old `has_deferred_deadline` block (set the deadline on the first suggestion / availability submission) is gone. `_enforce_suggestion_phase_timing` keys solely on `prephase_deadline` (`has_suggestion_phase = suggestion_deadline is not None`); the `suggestion_deadline_minutes`-without-a-deadline branch was removed.
- **`hasSuggestionPhase` / `isInSuggestionPhase` key on the deadline only.** `lib/questionListUtils.ts: isInSuggestionPhase(question, prephaseDeadline)` returns true iff the question is `ranked_choice` AND `prephaseDeadline` is set AND in the future. The retired "`minutes` set but `deadline` null → in phase forever" branch is gone. In `QuestionBallot`, `inSuggestionPhase` is `hasSuggestionPhase && !!effectiveSuggestionDeadline && now < deadline`. `suggestionDeadlineOverride` survives ONLY for the creator-cutoff path (`apiCutoffPollSuggestions` sets it to the now-past wrapper deadline so the UI exits the phase immediately) — it's no longer used for optimistic first-submission timer starts.
- **No "pending" prephase UI.** `DeadlineKind` dropped `'prephase-pending'` (the blue dot for "configured but timer not started") in `lib/groupUtils.ts` + `components/GroupListItem.tsx: PENDING_DOT`. The static "Taking Suggestions" / "Collecting Availability" no-countdown labels in `GroupCardItem` and the poll detail page were removed — there's always a `prephase_deadline`, so the `<SimpleCountdown>` branch always wins. (The time-availability `"Collecting Availability"` static fallback is kept as a defensive branch for a hypothetical time poll created with no prephase cutoff.) `response-pending` (green dot for "unvoted work, no deadline anywhere") is unrelated and stays.
- **In-flight backfill.** Migration 118 arms any poll left in the old deferred state (`prephase_deadline IS NULL AND prephase_deadline_minutes IS NOT NULL`) with `created_at + minutes` (capped below the voting deadline). The down migration is a no-op — the deferred state can't be distinguished from a legitimately-armed deadline after the fact.
- **The optimistic placeholder carries the prephase deadline.** `synthesizePlaceholderPoll` takes a `prephaseDeadline` arg; `app/create-poll/page.tsx` computes it (`prephaseDeadlineIso ?? now + minutes`) so the optimistic card shows the countdown immediately instead of flashing a blank slot until `POLL_HYDRATED`.
- **The group page's `QUESTION_VOTES_CHANGED_EVENT` patcher still carries `prephase_deadline`** through `patchGroupPolls` — not because votes arm it (they don't anymore), but so a concurrent creator suggestions/availability cutoff is reflected without a manual refresh.
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
- **Don't use `env(safe-area-inset-bottom)` in layout-affecting properties that feed `scrollHeight`.** On iOS Safari browser mode the value is dynamic — `0` when the URL bar is visible (it occludes the home-indicator area), `~34px` when the URL bar hides. If a page's `padding-bottom` uses `calc(X + env(safe-area-inset-bottom))`, the document height animates in lockstep with the URL bar, making `max-scrollable` a moving target and producing a visible scrollY clamp during momentum near the bottom edge. Use a static value for content padding; reserve `env(safe-area-inset-bottom)` for the positioning of truly fixed elements (e.g., the new group button, the floating `BubbleBarPanel`) where it doesn't affect flow. The home-page padding is `6rem` flat (clearing the new group button); group-like pages reserve `var(--bubble-bar-panel-height, 12rem)` for the floating bubble panel — see the BubbleBarPanel section below.
- **Group-page bottom padding is `var(--bubble-bar-panel-height, 12rem)`** — a CSS variable set by the floating `BubbleBarPanel`'s ResizeObserver. The cards-wrapper inside `GroupContent` reserves exactly the panel's measured height so the last card sits flush against the panel's top edge at scroll-bottom. The `12rem` fallback (192px) is a generous upper bound for the single-row bubble bar (one ~40px button row + 34px safe-area inset) used during the first paint before the observer fires; the observer collapses it to the real ~75px on the next tick. The template wrapper at `app/template.tsx` no longer adds a `paddingBottom: '0.5rem'` for `isGroupLikePage` — that buffer was for the OLD in-flow bubble bar and surfaced as an 8px gap below the last card once the bar floated. `slideOverlay`'s group-kind `innerStyle` and `GroupBackdropHost`'s wrapper similarly dropped their 0.5rem so the overlay → real-route handoff doesn't shift content. Historical: an earlier in-flow bubble bar set padding to 0.5rem flat; an even earlier iteration set it to 4.5rem (72px) as iOS Safari URL bar clearance but read as a layout bug on every other surface.
- **Per-second `setState` in a countdown component causes Firefox iOS scroll jitter at scroll edges.** When ~15+ countdown spans each re-render every second via `setTimeLeft(...)`, Firefox iOS momentum scrolling near the top edge compensates scrollY by +200-230px in a single frame (a single-frame snap, not a smooth bounce). The React reconciliation pass triggered by the setState — even if the DOM diff is just a text-node swap — trips a layout event that FxiOS treats as reason to adjust `scrollY`. Fix: update countdown text imperatively via a ref (`span.textContent = ...` inside `setInterval`) so React never re-renders. Both `components/GroupList.tsx` and the inner `SimpleCountdown` in `app/group/[groupId]/page.tsx` use this pattern. Safari iOS doesn't exhibit the bug, but the ref-based approach is also more efficient.
- **Diagnosing weird scroll behavior: instrument scrollY with a client-log tracer.** When user-reported "jitter" doesn't reproduce in Playwright (chromium + touch simulation can't replicate iOS momentum + URL-bar physics), add a temporary `window.addEventListener('scroll', () => console.log(...))` that records `scrollY`, `scrollHeight`, and `innerHeight` with timestamps via the existing client log forwarder. The user reproduces the issue once on their real device; the buffer captures the per-frame numbers. Finding a single-frame `dy > 100` with stable `scrollHeight`/`innerHeight` → something's programmatically adjusting scrollY (anchoring, max-clamp, browser compensation). `dy` tracking scrollHeight/innerHeight changes → layout-driven. This is how both the iOS Safari URL-bar bug and the FxiOS countdown-setState bug were nailed down — without the tracer, both looked identical visually.

### BubbleBarPanel (Floating Bubble Bar)

The create-poll bubble bar lives in a fixed-position panel (`components/BubbleBarPanel.tsx`) at the bottom of group-like routes (`/g/<id>` and the `/g/` empty placeholder). The bar's JSX is still owned by `CreateQuestionContent` — it portals into every `#draft-poll-portal` in the DOM, which `BubbleBarPanel` provides one of. The panel auto-hides on scroll-down and reappears on scroll-up or at the document edges.

- **Visibility rule:** `visible = atTopOfDocument || atBottomOfDocument || lastDirection === 'up'`. The `atTop` clause is load-bearing on iOS: rubber-band at the top edge produces a synthetic positive scrollY delta on snap-back, which would otherwise flip the direction to `'down'` and hide the panel.
- **Two-layer DOM structure** is load-bearing for the back-swipe gesture. Outer **shell** div is `position: fixed; bottom: 0; left: 0; right: 0; z-30` with NO visuals — it's the swipe-back transform target. Inner **panel** div carries the bg / border / safe-area `padding-bottom` + the visibility `translateY(0|100%)`. `useSwipeBackGesture` writes `el.style.transform = translate3d(X, 0, 0)` directly onto its targets; if the shell and the panel were one element, that write would clobber the visibility transform. Splitting them lets the two compose naturally (outer transform applies to the subtree; inner panel applies its own transform on top). The forwarded ref points at the shell so `GroupContent` can register it in `useSwipeBackGesture.extraTargets`.
- **Mount outside the swipe wrapper.** The panel sits as a sibling of `swipeWrapperRef`, NOT a child. A transformed ancestor would re-anchor `position: fixed` to that ancestor's containing block — on tall pages that pushes the panel far below the viewport once the swipe wrapper gets a transform.
- **Swipe-back-to-home is exempt on the panel.** Two layers of protection: (1) the sibling-not-child structure (touches starting on the panel can't reach the swipe wrapper's React synthetic `onTouch*` handlers because the panel isn't in the wrapper's React component subtree), AND (2) explicit `onTouchStart/Move/End/Cancel` on the shell that call `e.stopPropagation()`. The second is belt-and-suspenders against a future refactor that moves the panel inside the wrapper — without it, such a refactor would silently re-enable horizontal drags on the bubble row triggering swipe-back. Native browser horizontal scroll on the bubble row (`overflow-x-auto`) still works because `stopPropagation` only stops React's synthetic-event dispatch.
- **CSS vars `PANEL_HEIGHT_VAR` / `PANEL_OFFSET_VAR`** are exported from `components/BubbleBarPanel.tsx`. The cards-wrapper in `GroupContent` reserves `var(${PANEL_HEIGHT_VAR}, 12rem)` of `padding-bottom` so the last card sits flush against the panel at scroll-bottom; the down scroll-helper arrow uses `bottom: calc(... + var(${PANEL_OFFSET_VAR}, 0px))` so it floats above the panel when visible and reclaims the space when it auto-hides. Don't hand-write the CSS var names — import the constants so a rename is grep-safe.
- **Measurement via `useMeasuredHeight`** (`lib/useMeasuredHeight.ts`) on the inner panel. **No initial seed** — see "Empty-write guard" pitfall below for why. A `vvCounter` state is bumped on every `visualViewport.resize` and passed as the hook's deps — that re-attaches the ResizeObserver and reads a fresh `offsetHeight`. iOS browsers resolve `env(safe-area-inset-bottom)` differently depending on URL-bar / toolbar visibility, but the env-driven size change isn't always picked up by ResizeObserver on those browsers; the deps bump catches the shift without reimplementing measurement.
- **Empty-write guard + `:root` CSS defaults.** The bubble bar JSX is portaled in by `CreateQuestionContent` asynchronously (its MutationObserver fires after BubbleBarPanel mounts), so for a few rAF ticks after each BubbleBarPanel mount the `#draft-poll-portal` div is empty and the panel's `offsetHeight` is only its border + `env(safe-area-inset-bottom)` — 1px on browsers without safe-area, ~35px on iPhone X-class. Writing that small value to `--bubble-bar-panel-offset` pulls the down scroll-helper arrow to the viewport bottom; when content lands and the panel resizes to ~130px the arrow's `transition: bottom 200ms ease-out` then visibly animates it up — surfacing to users as "the arrow repositions itself after the slide completes". Two-part fix in this file + `app/globals.css`: (a) `:root { --bubble-bar-panel-height: 192px; --bubble-bar-panel-offset: 192px; }` so consumers (cards-wrapper padding-bottom, down arrow's `bottom`) have a sensible default before any panel mounts; (b) BubbleBarPanel's CSS var writer skips when `visible && heightPx < MIN_MEANINGFUL_PANEL_HEIGHT` (50px) — comfortably above max-empty (35px) and below min-populated (~88px on wide desktop, ~130px+ on phones). The seed value passed to `useMeasuredHeight` was also removed; with the seed at 192 (≥ threshold), Render 1's useEffect closure could fire with `panelHeight=192` and write 192 to the var, briefly snapping the arrow back to the default before the measurement-driven write of 129 — sequence visible in the trace as `192 → 129 → 192 → 129` during the slide. Default-0 panelHeight + threshold guard catches that path too. Trace evidence: with the fix, the var transitions `192px → 129px` exactly once per slide (matching ResizeObserver's first real measurement after content portal); without the fix, the var oscillates `(empty) → 1px → 129px → 1px → 129px` across the overlay→real-route handoff.
- **Cached scrollHeight.** Reading `document.documentElement.scrollHeight` on every scroll tick forces a synchronous layout flush — on long group pages that's the hottest cost in the visibility loop. The component caches it via a one-shot `ResizeObserver(documentElement)` that updates a ref; the scroll evaluator uses the cached value.
- **Change-detection guard on CSS-var writes.** `style.setProperty` on `:root` invalidates style on every element reading the var (the cards-wrapper and the down arrow here). The write effect compares the new `(height, visible)` tuple against `lastWrittenRef` and skips no-ops — important because `visualViewport.resize` can fire many times per URL-bar transition with the same `offsetHeight`.
- **Two instances coexist during a slide-overlay handoff** (the overlay's GroupContent + the real route's GroupContent). Both register their own `#draft-poll-portal` and `CreateQuestionContent` renders into both. Both write to the same `:root` CSS vars with the same measured value (panel content is identical). The vars are deliberately NOT cleared on unmount — a sibling instance may still be rendering and the host's padding would jump to 0 otherwise.
- **Sliding with the page on transitions:**
  - *home → group* (slide-overlay forward): the overlay's GroupContent contains its own BubbleBarPanel; the overlay container's transform slides everything (including the panel) in together. ✓
  - *group → home* (back-swipe): the shell ref is in `useSwipeBackGesture.extraTargets`, so the swipe transform applies to the shell directly while the inner panel's visibility translateY is preserved. ✓
  - *group → home* (back button via View Transitions): the panel has no `view-transition-name`, so it's part of the root snapshot and slides off with the source. ✓
  - *sub-route → group* (slide-overlay back): same as the forward case — destination panel inside the transformed overlay. ✓
  - *group → sub-route* (slide-overlay forward): the source's panel stays put at viewport bottom while the overlay covers it from above. `slideOverlay` doesn't apply source-side parallax, so this is the one case where the panel doesn't translate with the rest of the page during the transition. The overlay's opaque background hides the panel for the duration of the slide, so this isn't visually broken — but if a future change adds source-side parallax to `slideOverlay`, audit this case.
- **Pitfall: rubber-band at scroll-top can flip direction to `'down'`** on iOS. Without the `atTop` clause, the snap-back from a pull-down gesture (scrollY goes negative briefly, then snaps back to 0 with a positive delta > threshold) flips `lastDirection` to `'down'` and hides the panel even though the user is at the top. The `atTop = currentY <= 2` check defeats this.
- **Pitfall: env(safe-area-inset-bottom) changes can be silent to ResizeObserver on iOS.** The `vvCounter`-driven remeasure is what catches them. If you remove the `visualViewport.resize` listener, expect iOS Firefox / iOS Safari to ship a stale panel height on URL-bar toggles, sliding content under the panel at scroll-bottom.

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

- **Two-phase flow**: availability phase (voters submit `voter_day_time_windows`) → preferences phase (voters submit `liked_slots`/`disliked_slots` after cutoff). When the poll wrapper has `allow_pre_ranking !== false` (the default), the preferences phase opens for each voter as soon as they've submitted availability — they don't wait for the cutoff. See "Pre-ranking for time polls" below.
- **Slot finalization at cutoff**: `_finalize_time_slots()` runs at availability cutoff, applies `filter_slots_by_min_availability()` (keeps slots whose count ≥ `max_slot_availability * min_availability_percent/100`), deduplicates via `_keep_longest_per_start_time()`, and writes the filtered slot list to `question.options`. Everything downstream uses `question.options` directly — no re-filtering at results time. The same algorithm is exposed write-free as `_compute_candidate_time_slots(question, votes)` (in `server/services/questions.py`) for the pre-ranking tentative-slots path; both callsites converge on the same `algorithms/time_question.py` primitives.
- **Pre-ranking for time polls (`allow_pre_ranking` on `polls`).** When set (default true), voters can react to candidate slots before the availability cutoff. `_compute_results` returns the dynamically-computed candidate list as `options` with `options_are_tentative=true`; the FE `questionResults.options_are_tentative` flag drives the new `isAvailabilitySubmission` derived state in `QuestionBallot.tsx`. Voter UX is sequential: availability form → submit → bubble UI with tentative slots → submit preferences → summary. The slot list shifts as more voters submit availability; likes/dislikes the voter cast on slots that subsequently get eliminated remain in their vote row but are silently ignored by the winner algorithm (only slots in `question.options` after finalization count). To edit availability after submitting, voters Forget the question and redo (no separate "Edit availability" affordance in this iteration). Disable the toggle to restore the old "wait for cutoff" behavior. Three load-bearing pieces of plumbing:
  - **`include_tentative_time_options` kwarg on `_compute_results`** (`server/services/questions.py`) — defaults `True` (per-question results endpoint), but the bulk `polls_for_poll_ids` path (`/api/groups/mine` + `/by-route-id/{id}`, on a 5s page refresh tick) passes `False` to skip the slot-generation pass. Without this gate, every active group tab with N time polls triggers `_compute_candidate_time_slots` for each poll twice every 5s — the algorithm is O(days × windows × durations × starts × voters) and dominates server CPU on the hot loop. The per-question `/api/questions/<id>/results` call still populates tentative options for the ballot UI; `QuestionBallot`'s `apiGetQuestionResults` cache write merges in.
  - **`isAvailabilitySubmission` vs `inAvailabilityPhase`** (`QuestionBallot.tsx`) — pair of distinct concepts that USED to be one boolean. `inAvailabilityPhase` is the wrapper-level "slots aren't finalized yet" gate that drives the "Collecting Availability" status label and the tentative-slots amber notice. `isAvailabilitySubmission` is the per-voter active-form gate: true while filling the availability inputs, false while reacting to tentative bubbles. Both flow through to `TimeBallotSection`; the summary header label, the input-vs-bubble JSX fork, and `voteDataBuilders` all switch on `isAvailabilitySubmission`. `BallotInputs.isAvailabilitySubmission` in `voteDataBuilders.ts` is the renamed field (was `inAvailabilityPhase`) — keeps the wire-format decision local to the builder.
  - **Inline `setUserVoteData(v)` on first-time submits, not just edits** (`QuestionBallot.tsx: submitVote` + `prepareBatchVoteItem.commit`). Was `if (isEditing) setUserVoteData(v)`. Pre-ranking time flow reads `userVoteData.voter_day_time_windows` synchronously to derive `hasSubmittedAvailability`, which feeds `isAvailabilitySubmission`. Without the inline write, the first-time-submit path leaves `userVoteData` null until the loadVoteData useEffect re-fetches — causing a one-cycle flash through the "Your availability:" summary before the bubble UI lands. The companion `await fetchQuestionResults()` after submission (gated on `time + inAvailabilityPhase + allow_pre_ranking !== false`) lands the tentative options in the same paint cycle.
- **`TimeWindow.enabled?: boolean`** in `lib/types.ts` is the per-window "on/off" toggle the voter form writes. **The availability algorithms (FE `isVoterAvailableForSlot` + server `_voter_available_at`) do NOT read it.** Disabled windows must be stripped before submission, AND the day must be dropped if all its windows are disabled — leaving an empty `windows` array on a day means "all day available" per the helper's contract, which silently inverts the voter's "I'm NOT available" intent. The `voteDataBuilders.ts` time-availability branch handles both filters; mirror the pattern in any future direct-submit path. Submit-button disabled-state gating also reads `w.enabled !== false` so an all-unchecked state surfaces as a disabled CTA rather than silently sending null availability.
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
- **Shared time-slot helpers** in `lib/timeUtils.ts`: `parseSlotStart`, `parseSlotDate`, `groupSlotsByDay`, `getBubbleLabel` (predecessor-aware compact label returning `{time, period}` — see "Time bubble grid layout" below for the case table), `expandHourRowsToQuarters` (pads each hour-row to four `:00/:15/:30/:45` `SlotCell { slot, available }` entries — synthetic ghost cells for missing positions use a slot-key WITHOUT an end time, e.g. `${date} 10:00`, distinct from real keys so liked/disliked Set lookups never collide), `periodColorClass(period)` (Tailwind class for AM=orange / PM=purple, used by `TimeSlotBubbles`, `QuestionResults`, AND `DayTimeWindowsInput`'s time-window pills — extract before introducing a 5th call site), `formatStackedDayLabel` (stacked weekday / month+day for the bubble grid row label), and `formatTimeSlot` (full "Mon, Apr 28 • 10:00 AM – 10:30 AM (30m)" label). `TimeSlotBubbles.tsx` (voting ballot) and `QuestionResults.tsx` (results view) both use these — never re-implement slot formatting locally.
- **Time bubble grid layout** (`components/TimeSlotBubbles.tsx` + the `QuestionResults` results-view start-options panel). Each day renders three columns: stacked day label (left, `w-12`) | period column (`w-7`, AM/PM badge, orange/purple via `periodColorClass`, empty when this row continues the previous period) | bubble grid (a 2-col CSS grid where col 1 holds the hour-anchor bubble and col 2 holds a `flex flex-wrap` of the minute bubbles, so col-2 wraps stay indented past col 1). One row per hour. Every row carries all four quarter-hour positions; missing positions render at the same `min-w-12 h-8 px-2` footprint but with no border/background + faded text (`text-gray-300 dark:text-gray-600`, `select-none`, `aria-hidden`) — ghost cells, so the columns line up vertically across rows. Bubble text uses Geist Mono (`font-mono` Tailwind class → `--font-geist-mono`); single-digit hours are NBSP-padded in `getBubbleLabel` (e.g. `  1:00`) so the digit/colon/minute aligns column-by-column with `10:00`/`11:00`/`12:00`. **NBSP, not a regular space**: `white-space: nowrap` still collapses leading regular spaces; NBSP survives. `getBubbleLabel` cases: `:MM` for same-hour-different-minute, `H:MM` for same-period-different-hour, `H:MM` + non-null `period` for first-of-row / period-change. Hour-anchor labels always include `:00` (no bare-hour form) so the format is uniform across the grid. Row-level `period` is read off the first cell's `getBubbleLabel(firstSlot, prevSlot).period`, where `prevSlot` is the previous hour-row's last cell's slot key (use `hourRows[rowIdx-1].at(-1).slot`, NOT a flat-array index — the old `hourRows.flat() + flatIdx + cellsWithPrev` orchestration was retired). The shared `SLOT_CELL_SIZE` string lives at module scope inside each consumer so the ghost branch + real branch agree on dimensions. **Per-day `useMemo`** wraps the `groupSlotsByDay + formatStackedDayLabel + expandHourRowsToQuarters` chain keyed on `[options]` — keep new transformations inside the same memo rather than re-running per render tick.
- **Slot keys `"YYYY-MM-DD HH:MM-HH:MM"` arrive from the backend already in chronological order.** Consumers that just group by day (`groupSlotsByDay`) do NOT need to re-sort the list first; the old list view only sorted because it reordered by dislikes/likes.
- **Cap-height text centering for bubble labels**: time-slot bubble labels are pure cap-height text (digits, uppercase letters, colons — no descenders like g/j/y). `flex items-center` on a `leading-none` line box positions the **line box** at the bubble center, but the visible glyphs sit in the UPPER half of that line box because the space below the baseline is reserved for descenders that never appear — so the text looks "too high". Fix: use the modern CSS properties `text-box-trim: trim-both` + `text-box-edge: cap alphabetic` to shrink the text box to exactly the cap-height range, so flex centering aligns the visible glyphs instead of the padded line box. The shared `.cap-height-text` utility class in `app/globals.css` encapsulates the rule; use it on any `<span>` wrapping single-line, descender-free labels inside a centered container. Supported in Chromium 133+ / Safari 18.2+.
- **Availability cutoff requires `suggestion_deadline_minutes` to be set** on the question — the endpoint enforces `suggestion_deadline IS NULL AND suggestion_deadline_minutes IS NOT NULL`. Questions created without this field will fail the cutoff endpoint with 400.
- **`ChunkLoadError` after new builds**: the browser has stale cached chunks from the previous build. The lazy `CreateQuestionContent` import and the global `unhandledrejection` handler in `template.tsx` both auto-reload the page when this happens. The service worker uses network-first for JS chunks so new builds take effect immediately.
- **Autotitle convention**: time questions use `"Time?"` as the autotitle (matching the `BUILT_IN_TYPES` label), not a bespoke prompt like "When works?". Every branch of `generateTitle()` in `app/create-question/page.tsx` must call `appendFor(...)` on its return value so the "for X" suffix gets appended — the standalone `questionType === 'time'` fallback originally returned a raw string and silently dropped `forSuffix`.

### Day-Time-Windows Input (Creator Form)

- **The `+` button does NOT open the time-grid modal**; it appends a slot in place via `pickNextTimeWindow(targetDay, allDays)` (in `lib/timeUtils.ts`). The algorithm walks chronologically-previous days first (each day's slots tried latest-start first; the first one that doesn't overlap any existing slot on the target day wins), then chronologically-following days under the same rule, then falls back to `DEFAULT_TIME_WINDOW` (`08:00–17:00`). The `TimeGridModal` is now an **edit-only** surface — `handleEditApply` only handles the `editingIndex !== null` path. The `+ Time` amber-pill fallback for empty days is also gone since new days always inherit windows; if an empty-windows day ever happens, the always-on `+` column adds one.
- **`useDayTimeWindowsState.onWindowsChange` always sorts by start time.** Sorting is the single source of truth for "slots are in chronological order"; every consumer (the per-pill `intersectsPrev` validation, the `+ button`'s smart pick) trusts this. Don't store slots out-of-order anywhere — the sort lives in the hook so any new mutation that funnels through `onChange` is covered.
- **`useDayTimeWindowsState.onDaysSelected` inheritance**: a newly-added day's windows come from (1) the in-memory removed-day cache (re-adding a day restores its previous windows), else (2) the chronologically-previous day in the working list (deep-copied so edits don't propagate backward), else (3) `DEFAULT_TIME_WINDOW`. The auto-added "today" entry from `emptyDraft({category: 'time'})` and the parallel path in `app/create-poll/page.tsx` also seed with `DEFAULT_TIME_WINDOW` so the "first day" rule lands even when the day was auto-added.
- **`intersectsPrev` is per-pill validation, not a global error.** The styling is a soft orange outline (`border-orange-400 dark:border-orange-500`) on an otherwise-normal pill — read as a hint, not a blocker. Submission is not blocked. The duration-too-short check is a separate, harder error state (`bg-red-50` + red border + red text). Two separate flags fold into a single `pillVariant` selector keyed against `PILL_STATE_CLASSES` (`disabled | tooShort | intersecting | normal`).
- **Layout-stable pill borders via `border-transparent`.** Every pill state carries the `border` class; non-outlined states use `border-transparent` so the 1 px border slot is reserved on every pill regardless of variant. Switching states (e.g. adding a 2nd slot that triggers the orange warning) doesn't shift the layout by ±1 px.
- **Date column is fixed at `w-[88px]`** so the `+` button column to its right lands at the same X position on every row, regardless of how short any individual row's date / relative-day label is. The width is sized to the upper bound of label widths in Geist Sans: longest date line "Wed, Sep 30" ≈ 81 px, longest abbreviated relative-day "23mo away" ≈ 50 px. If labels ever exceed 88 px, either widen the column or compact the labels further.
- **Relative-day labels use abbreviated units with no space between number and unit**: `Today`, `Tomorrow`, `5d away`, `2w away`, `3mo away`, `1y away`. Matches the `compactDurationSince` convention in `lib/questionListUtils.ts`. Bucket thresholds: <14 days → `Nd`, <8 weeks → `Nw`, <24 months → `Nmo`, else `Ny`.
- **The `+ button` is in its own flex column, `self-start` aligned**, so its center sits at the same Y as the topmost pill's center regardless of how many pills the day has. `shrink-0` keeps it a perfect 34 px circle even when delete controls appear in the slot column and pressure the row. Diameter 34 px = pill height (text-sm line + py-1.5 + 1 px border each side).
- **Delete control hides when only one slot remains.** Two-or-more-slot days show a red `×` icon (no trash can) to the left of each pill; one-slot days show no `×` so the day can never drop to zero windows. To remove the entire day, use the day picker — that's the only path.
- **`DEFAULT_TIME_WINDOW`** in `lib/timeUtils.ts` is the canonical "first window" — `{ min: '08:00', max: '17:00' }`. Imported by `useDayTimeWindowsState.ts`, `createPollHelpers.ts: emptyDraft`, and `app/create-poll/page.tsx`'s today-init path. Don't re-inline the times.
- **`allDays` prop on `DayTimeWindowsInput`** is the full day list across the form, used only by the `+ button`'s smart-pick. Optional with a sensible fallback (`[{day, windows}]`) so the component still works standalone if a caller forgets to pass it; the smart-pick just degenerates to the default-window branch in that case.

### Service Worker Caching Strategy

- **Never use `url.pathname.startsWith('/')` in service worker URL matching** — it matches ALL paths. Use exact equality (`===`) or more specific prefixes like `/create-question`.
- **Use network-first for HTML navigation, cache-first only for immutable assets.** Cache-first for navigation causes the PWA to serve stale HTML that references old JS bundles (also cached), making it impossible for users to get new code. Network-first ensures fresh HTML on every load; cache is only a fallback for offline.
- **Skip API requests in the service worker** — let them go directly to the network. Caching API responses causes stale question data with no visible error.
- **Bump `CACHE_NAME` version when changing caching strategy** to force old caches to be deleted on activation. Without this, users keep stale cached content indefinitely.
- **JS chunks need network-first too** — even with content-hash filenames, the old manifest chunk references old chunk names. After a new build, the manifest is cached with old chunk references; network-first for `/_next/static/chunks/` ensures the manifest is always fresh.

### iOS PWA Safe Area Positioning

- **`position: fixed; top: 0` goes behind the notch** in iOS PWA with `viewport-fit: cover` and `black-translucent` status bar. Either push content down via `padding-top: env(safe-area-inset-top)` on the fixed element (so its background fills the notch zone), or anchor the element at `top: env(safe-area-inset-top)` (so it sits below the notch). The group header uses the first pattern; the commit badge uses the second via `.pwa-badge-top`.
- **Body gets horizontal safe-area padding** (`padding-left/right: env(safe-area-inset-left/right)`); vertical safe-area insets are handled per-element by whatever sits at the top/bottom (fixed group header, home/settings titles via `.page-title-safe-top`, the new group button via its flat `bottom: 1rem` offset — see "iOS PWA layout viewport vs physical screen" below for why we don't add `env(safe-area-inset-bottom)` here).
- **Use CSS media queries, not JS state, for PWA safe-area layout.** React state (`isStandalone`) starts `false` and only updates after `useEffect`, causing a visible jump on first render. `@media (display-mode: standalone)` applies instantly before any JS runs. Reserve `isStandalone` state for conditional rendering (e.g., back button visibility) where a one-frame flash is acceptable.
- **To position at the true screen edge**, render via a portal to `document.body` (outside the `.responsive-scaling-container`). From there, `fixed top: 0` = the safe area boundary (notch bottom) in PWA standalone mode.
- **Fixed header bars need to cover the notch zone, not just sit below it.** A header anchored at `top: env(safe-area-inset-top)` leaves the area above it (the notch zone) uncovered, showing scrolling content through it. Instead, anchor the bar at `top: 0` and push its content down with `padding-top: env(safe-area-inset-top, 0px)` so the background fills from the physical screen top. **The measurement ref (for computing a sibling's `padding-top`) must be on the OUTER fixed div, not the inner content div** — `offsetHeight` includes the element's own padding, so measuring the outer div picks up `env(safe-area-inset-top)` automatically (in iOS PWA where it's ~47-59px notch; in browser/desktop where env resolves to 0, the outer and inner heights match). An earlier iteration kept the ref on the inner content div with the rationale "stays content-only", but the consumer's `paddingTop: ${headerHeight}px + 0.5rem` then under-reserved by the safe-area amount and content sat behind the bottom of the header in iOS PWA. Most visible on the empty group placeholder (`/g/`) where a centered "Create a question…" caption was clipped by the header; on regular group cards the same bug just consumed the first ~47px of dead space and went unnoticed. Pattern used in `components/GroupHeader.tsx`.
- **iOS PWA layout viewport vs physical screen.** On iPhone X-class devices in PWA standalone mode (e.g., iOS 18.7 / Safari 26.4), `window.innerHeight` (= the layout viewport) can be smaller than `window.screen.height` (= the physical screen). One observed pairing: `innerH=812`, `screenH=874` — 62 logical points of physical screen sit BELOW the layout viewport. This is separate from `env(safe-area-inset-bottom)`, which reports the home-indicator zone WITHIN the layout viewport (typically 34px on iPhone X-class). Two consequences:
  - **Fixed-positioned DOM elements are clipped to the layout viewport boundary.** Anything at `top: ${innerH}px` or `bottom: -<n>px` simply doesn't render. Only `body`/`html` background paints into the strip below the layout viewport (verified by setting `--background: #ffff00` and observing the entire physical screen turn yellow). Therefore, the only knob on this strip is its bg color — you cannot put a button, text, or any DOM there.
  - **iOS PWA screenshots crop at the layout viewport bottom**, NOT the full physical screen. A `position: fixed; bottom: 0` element appears flush with the screenshot's bottom edge while sitting well above the device's actual screen edge. This burned multiple debugging cycles in the original session — markers that looked correct in screenshots were physically displaced on-device. When debugging iOS PWA layout from screenshots, mentally extend the screenshot's bottom edge by `screen.height - innerHeight` to get the true physical bottom. Or just trust the readout values, not the eye.
  - **The new group button sits at flat `bottom: 1rem` (NOT `max(1rem, env(safe-area-inset-bottom))`)** because adding the env value pushes it `1rem + ~34px` above the layout viewport bottom (which already sits well above the physical screen edge), producing a visibly far-from-edge button on iPhone PWA. Flat `1rem` keeps it 16px above the layout viewport bottom; the home-indicator gesture pill is centered horizontally at the bottom and doesn't reach the new group button's right-edge position, so iOS's reserved-zone overlap there is fine. The 62px physical strip below remains body-bg-painted "wasted" space that we currently leave matching the page background.

### Navigation Layout

- **No bottom bar. No home button.** The old three-button bottom bar (Home / + / Profile) was removed. Navigation is:
  - **New group button on home only**: a single rounded blue "+ Group" pill pinned bottom-right via `position: fixed` + `max(1.5rem, env(safe-area-inset-right, 0px))` / `max(1rem, env(safe-area-inset-bottom, 0px))`. Tapping it navigates to `/g/` (the empty placeholder), where the category bubble bar lets the user pick a category to start a new poll. Home does NOT show the bubble bar — choosing a category is a per-group decision, not a "starting fresh" decision. Sizing tuned empirically: `px-[16.56px]` horizontal padding (1.38× the original `px-3` to give the "+" + "Group" content room to breathe at the pill ends) and `text-[28.8px]` for the "+" glyph (0.8× the original `text-4xl` so the plus reads closer in visual weight to the `text-lg` "Group" label rather than dominating it). Half-pixel arbitrary Tailwind values are house style throughout the codebase (see other examples in `GroupListItem.tsx`, `DayTimeWindowsInput.tsx`); don't "tidy" them to the nearest standard size — they encode exact percentage-tuned design specs.
  - **Category bubble bar on group-like pages**: portaled into `#draft-poll-portal`, which lives inside the floating `BubbleBarPanel` (`components/BubbleBarPanel.tsx`) at the viewport bottom on `/g/<id>` and the `/g/` empty placeholder — see the "BubbleBarPanel (Floating Bubble Bar)" section above for the panel's structure, visibility rules, and slide-with-page behavior. The row starts with a bold "+ New Poll" button (catch-all opening the modal with the default `custom` category) followed by one button per `BUILT_IN_TYPES` entry — see `BUBBLE_ENTRIES` in `app/create-poll/page.tsx`. Each entry calls `openModalFor(category)` which seeds a fresh draft via `emptyDraft({category})` and opens the new-question modal. There is no separate draft poll card or always-on creation form. All buttons share the module-scope `BUBBLE_BUTTON_CLASS` constant; the retired trailing "Other" entry (also `custom`-category) was folded into "New Poll" to avoid two buttons doing the same thing. **Each bubble is a rounded rectangle (`rounded-2xl`), not a pill** — `BUBBLE_HEIGHT_PX = 112` (fixed across all bubbles for vertical uniformity), icon stacked above word-wrapped title. The icon is `BUBBLE_ICON_PX = 32` (2× the previous `text-base` glyph); the `+` on the New Poll bubble is an SVG cross sized to the same 32×32 footprint because a text `+` at the same `font-size` only occupies ~18px of its em-box and read visually smaller than the 40px-wide emoji glyphs on the neighbour bubbles. Title uses `-webkit-line-clamp: 3` for the cap and `wordBreak: normal` + `overflowWrap: normal` so words stay intact and wrap by spaces. **Width auto-sizes via `width: min-content`** floored at `BUBBLE_MIN_WIDTH_PX = round(32 × 1.75) = 56px` (2× icon would be 64, but 1.75× felt visually balanced and packs more bubbles into the viewport — "Restaurant" lands at ~90px because its single word doesn't fit 56). Vertical balance: the button uses `pt-3` only (no `pb-*`), so the title wrapper's `flex-1 + items-center` produces equal slack between (icon-bottom → title-top) and (title-bottom → rectangle-bottom); adding bottom padding would tilt that balance toward the bottom. Bg is the standard "off-page-bg" `bg-gray-50 dark:bg-gray-800` + a 1px `border-gray-200 dark:border-gray-700` outline so the bubbles read as quiet containers rather than primary affordances. The panel uses `bg-background` so it blends with the page bg and has no top divider — the rounded rectangles are sufficient visual separation. Earlier iterations: single-line pill chips with blue fill and inline icon+label (`rounded-full` + `px-[13.5px] py-[6.75px]`); before that an underlined sticky "New" label with bordered bubbles + a top border on the panel; before that a 3-row wrapped grid with a centered "Create a New Poll" h2 above. (Earlier iterations had a visible draft card hosting staged questions + a Submit button; that's gone — the modal now submits the entire poll directly. Even earlier iterations had a floating What/When/Where 3-bubble bar with `?mode=time` / `?category=restaurant` URL preselection; also gone — see the historical note in the Active Plan section above. An intermediate iteration kept the bar in-flow at the bottom of the cards-wrapper; the current floating panel replaces that with hide-on-scroll-down behavior.)
  - **Bubble order is recency-driven, not the static `BUILT_IN_TYPES` order.** The 6 built-in category bubbles are sorted by: (1) categories the user created polls for most recently IN THE CURRENT GROUP, (2) most recently IN GENERAL, (3) remaining categories in a per-app-start random order. The bold "New Poll" catch-all stays pinned first (it's the primary affordance, and `custom` polls never need ordering). `orderBubbleEntries(BUBBLE_ENTRIES, groupRecency, generalRecency)` in `app/create-poll/page.tsx` does the merge; `SESSION_BUBBLE_FALLBACK_ORDER` is a module-scope Fisher-Yates shuffle computed once at load (the file is `"use client"` + lazy, so `Math.random()` never runs during SSR — a fresh page load / app cold-start reshuffles, matching "random order generated each time the app is started"). Server-side tracking: migration 117 `poll_category_history` (upsert keyed `(browser_id, group_id, category)` with `last_created_at`); `services/poll_categories.py: record_poll_categories` (decoupled own-transaction write, mirrors `services/memberships.py`) is called from `create_poll` AFTER the commit, feeding `[_category_for_title(qr) for qr in question_rows]` so a time question records as `"time"` (not its stored `"custom"` category). `load_category_recency(conn, browser_id, *, user_id, group_id)` returns `{group, general}` ordered lists, unioning across linked browsers via `user_browsers` (same expansion as `load_user_visibility`). FE reads it via `GET /api/users/me/poll-category-history?group=<routeId>` (`apiGetPollCategoryHistory` in `lib/api/users.ts`); `CreateQuestionContent` observes `<body data-group-id>` (the group UUID, which the endpoint resolves via `resolve_group_id_from_route_id`) with a MutationObserver, refetches on group change AND after every successful create (via a `categoryRefreshTick` bump), and feeds the result into the `orderedBubbleEntries` memo. **Per-browser caveat**: the ordering reflects the requesting browser's history, so sharing a group URL does NOT transfer your bubble order to the recipient — each viewer sees their own recency. Tests: `server/tests/test_poll_categories.py`.
  - **`LazyCreateQuestionContent` lives in `<PersistentCreatePollHost />` inside `app/layout.tsx`, NOT `app/template.tsx`.** The component owns the bubble-bar portal AND the create-poll modal. Two previous gating patterns failed:
    1. **Route-gated** (`isMounted && isGroupLikePage`): the component only mounted after `router.push` flipped the pathname, so the overlay-slide transition showed an empty `#draft-poll-portal` for the full slide duration; bubble bar popped in ~150-300ms after the slide visually completed.
    2. **Unconditional in template.tsx** (`isMounted` only): per Next.js App Router semantics, `template.tsx` re-instantiates on every navigation — so the component unmounted + remounted across home→group, and the brief state-init→MutationObserver-fire gap caused the bubble bar to BLINK off and back on once per navigation tick (often 2-4 times in StrictMode dev). Same mechanism that forces `<SlideOverlayHost />` to live in the layout.

    Layout-level mounting persists across client-side navigation — the component mounts once per page load and stays mounted. The `<PersistentCreatePollHost />` wrapper handles the lazy import + chunk-error reload + idle preload internally (the preload was previously in template.tsx, where it re-ran on every navigation). The component renders nothing visible when there's no portal target AND no open modal, so mounting on every route (including home) costs nothing visual — only its lazy module's effects (form-state load from localStorage, `getUserName` lookup, MutationObserver attach). The idle preload runs once per page load. Don't try to move the mount back into `template.tsx` without solving the re-instantiation flicker.
  - **`CreateQuestionContent`'s portal lookup uses `querySelectorAll` and picks the LAST match, not `getElementById`.** During the slide there are TWO `#draft-poll-portal` divs in the DOM simultaneously: the real route's (inside the React tree under `#__next`) and the overlay's (createPortal'd directly to `document.body`, so appended LATER in DOM order). `getElementById` returns the FIRST match — the real route's — which is hidden behind the overlay's `z-index: 60` layer, so the bubble bar would be portaled into the wrong (invisible) target. The "last-in-DOM" rule picks the overlay's portal during the slide and falls back seamlessly to the real route's once the overlay unmounts (their visual positions coincide, so the user sees no flicker). Verified end-to-end via DOM trace: at t=200ms the bubble bar is in the overlay's portal with URL still `/`; at t=500ms URL has flipped, two portals exist, bubble bar stays in the overlay; at t=1000ms+ overlay is gone and the bubble bar has hopped to the real-route portal. Don't switch back to `getElementById` "for simplicity" — the dual-portal coexistence is load-bearing for the slide animation.
  - **Settings gear**: only on the home page, upper-left, icon-only (no text). Links to `/settings`. Rendered as `position: absolute` inside a `relative` wrapper around just the h1, with `top-1/2 -translate-y-1/2` so its vertical center auto-tracks the title's midline (no hardcoded offset — survives font-size/padding changes). Sits in normal page flow and **scrolls off-screen with the page** (intentionally not fixed). The outer container's `padding-top` (`calc(0.75rem + env(safe-area-inset-top, 0px))`) handles the iOS notch clearance.
  - **Back arrow**: the HeaderPortal back button renders unconditionally on the settings page and always navigates to `/` (via `navigateWithTransition(router, '/', 'back')`); it does NOT consult `hasAppHistory` or fall back to `history.back()`. All other pages (group, question) render their own back button in their fixed header.
- **Home reserves `6rem` of bottom padding** (to clear the new group button); group-like pages reserve `var(--bubble-bar-panel-height, 12rem)` on the cards-wrapper (to clear the floating bubble panel — see the BubbleBarPanel section above). Other pages use the normal `pb-6`/`py-6` from the outer Tailwind classes.
- **Portal target**: `#floating-fab-portal` (previously `#bottom-bar-portal`) in `app/layout.tsx`. Lives outside `.responsive-scaling-container` so fixed positioning is relative to the viewport, not the scaled container.
- **The new group button and What/When/Where bubble bar slide with the root snapshot during view transitions.** Earlier they shared `view-transition-name: floating-plus` on a `.floating-plus-button` class so the bar would stay "pinned" across home ↔ group navigation. The browser paired the small "+" element with the wider bubble-bar element as a single transition group — and even with `animation: none` on both pseudo-elements, the old "+" and the new bar coexisted in their original sizes/positions for the 500ms transition window, which read visually as the "+" growing and lingering at the bottom while the bubble bar expanded in. Removed the shared name + the `.floating-plus-button` class entirely; both portal-rendered controls now belong to the root snapshot, so the home "+" slides off-screen with the home page and the group bubble bar slides in with the group page (and vice versa on back). Don't re-introduce a shared `view-transition-name` between conceptually different controls just because they occupy the same screen position — the browser will pair them and the morph will look wrong unless you can make the two elements visually identical.
- **The outgoing root snapshot slides fully off-screen (`translateX(±100%)`), not a 25% parallax.** The first iteration used iOS-style parallax: outgoing 25% with opacity 0.5, incoming 100%. That stranded the bubble bar (which spans most of the bottom width) in the right portion of the viewport during back-nav — the new home page covered only the left half by the time the old page settled at +25%, leaving the rightmost button visible at half opacity under the incoming page. Symmetric 100%/100% slide ensures the bar fully exits the viewport before the new page lands. If you want the parallax look back later, you'd need to keep the outgoing page mostly off-screen (e.g. translateX(80%)) and accept a shorter trail — don't go below ~80% or the wide bubble bar will linger again.
- **Create-question modal close cleans up `category` along with `create`/`followUpTo`/`duplicate`/`voteFromSuggestion`/`mode`.** The Where bubble adds `?category=restaurant` to the URL; closing the modal must strip it so the URL display stays tidy. The cleanup list lives in `navigateCloseModalRef` in `app/template.tsx` — extend it whenever you add a new query param that the create modal consumes on entry.
- **`?category=<value>` preselection on the create-question modal** — `app/create-question/page.tsx` reads `categoryParam = searchParams.get('category')` once and feeds it as the initial `useState` value for `category` (defaults to `'custom'` when absent). The Where bubble uses this; future per-bubble flows (Phase 2.4 dual modal) can extend it. **The URL param wins over the saved-draft `questionFormState.category`** — the localStorage restore is gated on `formState.category && !categoryParam`, so a stale "restaurant" draft can't override a "What" tap that explicitly arrives with no `category` param. If you add another URL preselection mechanism that interacts with the saved-draft restore, mirror this guard.

### Back Button Navigation Strategy

- **On poll pages the back arrow always renders and leads to the containing group** — including on direct/first-link loads where there's no in-app history. Computed at click time by walking up `follow_up_to` in the `questionCache` via `findGroupRootRouteId`; a standalone question resolves to `/p/<itself>`, which renders as a single-item group. **Settings follows the same "always renders, hard-coded destination" pattern** — back from `/settings` always goes to `/`, regardless of in-app history. Mirrors the group page rule (which hard-codes `/` for the same reason: a create-question side-trip can leave the previous history entry pointing at a now-empty placeholder).
- **Detect standalone mode with `isStandalonePWA()`** which checks both `navigator.standalone` (iOS) and `window.matchMedia('(display-mode: standalone)')` (Android/Chrome). Both are device constants — evaluate once on mount, not on every navigation.
- **Don't use `document.referrer` or `window.history.length` for navigation decisions.** `document.referrer` is unreliable (privacy settings, cross-origin, browser variations). `history.length` is cumulative across the tab's lifetime, not app-specific. Use `sessionStorage` to track in-app navigation count instead (per-tab, auto-cleared on close).
- **After a create-question submission, the back button should lead to the group containing the new question**, not back through the `?create=1` URL (which reopens the modal) and not to whatever random page the user was on before opening the modal. Implemented via `lib/questionBackTarget.ts`: the create-question flow calls `questionBackTarget.set(questionRouteId, groupRootRouteId)` before `router.replace('/p/<id>')`; the back button in `app/template.tsx` calls `questionBackTarget.consume(questionRouteId)` and uses `navigateWithTransition(router, customBack, 'back', { mode: 'replace' })` to replace the question entry with the group entry — so subsequent `back` from the group skips over the question. Skip setting the target when the page underneath the modal already matches the group URL (avoids leaving a duplicate history entry).
- **`history.replaceState(null, '', url)` does not integrate with Next.js App Router back navigation.** When popstate fires with `state === null` (because we bypassed the router), Next.js's popstate handler can't resolve the target route and falls back in unpredictable ways — on the first attempt of this pattern, standalone questions were landing on the main list instead of the group URL we'd injected. Use `router.replace` (which writes proper Next.js route state) combined with sessionStorage overrides for custom back destinations; never rely on raw `replaceState` to feed Next.js router back navigation.
- **Consecutive `router.replace` + `router.push` calls in Next.js App Router don't reliably produce two history entries.** Both navigations are scheduled through React transitions and can batch, so only one may actually commit. If you need the prior entry to be a different URL, use the sessionStorage-override pattern (a single `router.replace` plus back-button override in the next page).

### Group-Page Layout Stability

- **Each card is a `React.memo`'d `<GroupCardItem>` (`app/g/[groupShortId]/GroupCardItem.tsx`) with slice-based custom equality.** A vote/expand/press/swipe on card A no longer re-renders cards B..N. The parent's `.map()` recomputes per-card primitives (`isExpanded`, `isPressed`, `isAwaiting`, `isClosed`, `isVisible`, `isSwipeThresholdActive`, `isTooltipActive`, `isPlaceholder`) from its useState values and passes them as props — for cards whose primitive didn't flip, the memo's first cheap-boolean comparison short-circuits to `true` and the card's ~600-line JSX render is skipped entirely.
- **State Maps (`questionResultsMap`, `userVoteMap`, `pendingPollChoices`, `wrapperSubmitState`, `pollVoterNames`, `pollSubmitting`, `pollSubmitError`) are passed by reference; the equality fn slices them by THIS card's question/sub-question/poll IDs.** Every Map mutation produces a new identity (e.g. `setQuestionResultsMap(prev => new Map(prev).set(id, fresh))`), so a default shallow-compare would invalidate every card on every Map update. The slice-based equality fn iterates `next.group.subQuestions` and compares only `prev.questionResultsMap.get(sp.id) !== next.questionResultsMap.get(sp.id)` (and similar for the other Maps); siblings of the changed entry compare equal and skip re-render.
- **Stable handler/setter identity is invariant across the component lifetime — the equality fn does NOT compare them.** This is a deliberate assumption: useState dispatchers are inherently stable, callbacks passed to `GroupCardItem` are wrapped in `useCallback([])` (`attachCardEl`, `detachCardEl`) or pinned via `useRef(...).current` in `lib/useGroupVoting.ts` (`setPollVoterName`, `handleWrapperSubmitStateChange`). If a parent stops pinning a callback, it'll show up as a stale-closure bug, not as missed re-renders — fix it in the parent. New handlers passed to GroupCardItem MUST be stable; before adding one, audit its closure for reactive state and pick the right pinning pattern.
- **Card-local handlers (touch/swipe/click) live inside `GroupCardItem`, not in the parent.** `handleTouchStart`, `handleTouchEnd`, `handleTouchMove`, `finalizeSwipe`, `toggleExpand`, `handleClick` close over per-card props (`question`, `group`, `swipeEligible`, `isExpanded`) plus stable refs/setters/callbacks passed in. Recreating them per render is cheap because they only ever execute when the user touches that specific card. The previous version recreated all N×6 handler closures on every parent render — moving them to the child means each card's handlers are recreated only when that card itself re-renders.
- **The placeholder branch stays in the parent's `.map()`.** Unmounted groups render as `<div style={{height: groupHeightById.current.get(group.key) ?? ESTIMATED_GROUP_HEIGHT}} />` directly inside the parent — they're trivial JSX with no per-card state that needs memoization. `attachCardEl`/`detachCardEl` are shared between the placeholder and `GroupCardItem` so both register in `cardRefs` (the scroll-helper logic that iterates `cardRefs` works regardless of mount state).
- **`GroupCardGroup` type lives in `GroupCardItem.tsx`** and is imported by the parent. Same-file colocation keeps the prop interface and the consumer's primitive computation discoverable in one place; if a future refactor needs it elsewhere, lift to a shared `groupCardCommon.ts`. (The previous `SwipeState` type was retired with the swipe gesture in the rectangle-redesign cleanup.)
- **`pendingPollSubmit`, `pendingVoteChange`, `voteChangeSubmitting`, `confirmPollSubmit`, `confirmVoteChange` stay in the parent** — they only feed the page-level confirmation modals, never the per-card chrome. Don't push them into `GroupCardItem`'s prop interface.
- **Future bounded-memory scroll-window (deferred): the IO-driven mount/unmount window past ±2 viewport heights is now affordable** (a card's mount/unmount is ~free for siblings since memo skips them). Implementing this means changing the progressive-fill effect to instead drive `mountedGroupKeys` from the IntersectionObserver: add when crossing into a `±2 × innerHeight` envelope, remove when crossing out. The placeholder's measured height keeps scroll position stable across mount/unmount cycles. Hold off until groups actually hit hundreds of polls — premature scroll-driven virtualization can cause flicker if the placeholder height is mismeasured.
- **Initial mount = anchor only; rest fills in idle-time around the anchor.** Mounting all groups upfront pays a heavy initial-render cost on long groups (each card in the .map is ~200ms in dev mode). The current compromise: initial render contains only the URL-anchored card. A `useEffect` then walks a distance-from-anchor queue and mounts groups in batches of 4 per `requestIdleCallback` tick (falls back to `setTimeout(16)`), so the surrounding cards "fill in around" the anchor visibly. With memoized cards, each progressive-fill batch only re-renders the newly-mounted cards — not the entire list — so the fill is visually smooth even on long groups.
- **Placeholder divs are kept around for groups not yet mounted (the bulk during the initial fill, plus the brief window between a new poll arriving and the maintenance useEffect adding it to mountedGroupKeys).** Each placeholder renders as a `<div>` with `style={{ height: groupHeightById.get(key) ?? ESTIMATED_GROUP_HEIGHT }}` so the doc height is stable across the swap. A shared `ResizeObserver` populates `groupHeightById` from each rendered group's `borderBoxSize` (NOT `offsetHeight` — that forces a layout per entry, which on iOS URL-bar transitions stutters the scroll because every observed card fires at once).
- **Anchor pin (single source of truth) lives in `applyScrollAdjustmentRef.current`** (a ref-stored function so both `useLayoutEffect` and the `ResizeObserver` callback can call it without dep churn). Two modes:
  - **Card-anchor** (`initialExpandedQuestionId` set): re-apply `scrollTo(card.offsetTop - headerHeight)` every layout settling, until `userInteractedRef.current` flips.
  - **Bottom-pin** (`initialExpandedQuestionId === null`, suppressExpand): re-apply `scrollTo(scrollHeight - innerHeight)` until `userInteractedRef.current` flips.
- **Gate on user input, not scrollY deltas.** The first version tracked `prev.offsetTop` and scrolled by `newOffsetTop - prevOffsetTop` to preserve visual position. That broke when cards above mounted SMALLER than estimated → doc shrank → browser silently CLAMPED scrollY (e.g. 1796 → 1568) → my prev was stale → my delta calculation produced wrong scrolls. Hard to distinguish browser-clamp scroll events from user-initiated ones at the JS level. Switching to "pin until first pointerdown/wheel/keydown" sidesteps the entire problem: layout settling is unambiguous (no user input has happened), so we just re-pin every time.
- **`userInteractedRef` listens to `pointerdown` / `wheel` / `keydown` in capture phase.** NOT `scroll` — programmatic scrolls (our own `scrollTo`, browser clamps when doc shrinks) all fire `scroll` events with `isTrusted: true`, indistinguishable from a user gesture. `pointerdown` (in capture phase) is the unified touch+mouse+pen event and reliably fires on iOS even when scroll engages immediately.

### Swipe-Back Gesture (Shared Hook)

Two routes implement iOS-style swipe-back: `GroupContent` → home (`/`) and `PollDetail` → its containing group (`/g/<group>`). Both share `lib/useSwipeBackGesture.ts: useSwipeBackGesture({ headerRef, extraTargets?, showBackdrop, hideBackdrop, onBeforeCommit?, onCommit })` which returns `{ swipeWrapperRef, touchHandlers }` for the caller to spread onto a wrapper div.

- **Caller responsibilities:**
  - Render an opaque `position: relative; z-index: 1; min-height: 100dvh` wrapper that owns the `touch-pan-y` class and the swipe ref + touch handlers.
  - Mount a body-level backdrop host that listens for `SHOW_*_BACKDROP_EVENT` (`<HomeBackdropHost />` and `<GroupBackdropHost />` in `app/layout.tsx`).
  - Dispatch the SHOW event from the `showBackdrop` callback and HIDE from `hideBackdrop`. The destination route's mount effect dispatches HIDE again as a final cleanup (covers the commit path where the source page unmounted before snap-back/cancel could fire).
  - Call `rememberCurrentScroll(scrollKey)` inside `onBeforeCommit` (saved BEFORE navigation so re-entry restores it).
  - Do the actual navigation inside `onCommit` (`router.push(target)` matches the home-swipe pattern; routing through `slideToGroupRoot` here would layer a second animation on top of the in-flight swipe).
- **Shared transform targets**: the hook always transforms `swipeWrapperRef.current`, `headerRef.current`, and `document.getElementById('commit-badge-portal')`. Callers pass any additional body-portaled affordances (scroll-helper arrows on the group page) via `extraTargets`.
- **Commit threshold**: ≥30% viewport width OR ≥0.5 px/ms velocity. Slide finish duration is bounded `[140, 360]ms` based on remaining distance + velocity. Snap-back uses a flat 220ms `cubic-bezier(0.32, 0.72, 0, 1)`. Don't tweak these without testing across iOS Safari + Chrome.
- **`setSwipeScrollbarLock(locked)` in `lib/scrollbarLock.ts`** is the canonical toggle for `html`+`body` `overflow-x: clip` + `scrollbar-width: none`. The swipe wrapper's translateX extends content past the viewport edges; without the lock the browser surfaces a horizontal scrollbar (and on desktop, also a vertical bar). The hook calls this internally on show/hide; the destination route's mount effect also calls `setSwipeScrollbarLock(false)` as the final cleanup (covers the commit-path race where the source page unmounts before the snap-back/cancel timer fires).
- **Backdrop architecture (per route family):**
  - `<HomeBackdropHost />` renders a static `<GroupList>` snapshot (no fixed header, no own state machine).
  - `<GroupBackdropHost />` renders `<GroupContent>` itself with `overlayCardsOffset={savedScroll}` so it skips its own `window.scrollTo` (which would scroll the still-mounted PollDetail underneath). `contain: strict` on the backdrop wrapper keeps the backdrop's z-20 GroupHeader from escaping to body level and painting over PollDetail's z-20 header.
- **Two-back-paths coexistence**: PollDetail's back button uses `slideToGroupRoot` (the slide overlay), while the swipe uses `router.push` directly. This is intentional — the slide overlay's CSS-animation would fight a gesture-driven motion. The two paths are functionally equivalent (both end at `/g/<group>`); the swipe one just bypasses the overlay layer.
- **Pitfall: the swipeWrapper's `background: var(--background)` paints across its OWN box, not across any negative-margin descendants.** On the group page, the cards-wrapper escapes the template's safe-area padding via `marginLeft/Right: calc(-1 * max(0.35rem, env(safe-area-inset-*, 0px)))` so each row's left-edge yellow "awaiting" bar sits flush at the screen edge. If those negative margins live on the cards-wrapper (a child of swipeWrapper) but NOT on swipeWrapper itself, swipeWrapper's bg covers only the safe-area-padded box — leaving ~5–50px-wide unpainted strips at the left/right screen edges where the cards extend past it. During a swipe-back the HomeBackdropHost (z=0, full viewport) is now exposed in those strips beneath the (transparent) card extension, and at mid-swipe the strips drift into the home backdrop's content area — so the user sees home content peeking through a thin column between each card's leading yellow bar and the rest of the rectangle background. Fix: keep the negative margins on the swipeWrapper, NOT the cards-wrapper. The cards-wrapper inside doesn't need them because its parent is already the right width. Same rule applies to any future surface where a swipe-wrapper holds the page bg and edge-to-edge children escape its parent's padding — the bg has to follow the children, not the parent.
- **The PollDetail swipeWrapper (`/g/<id>/p/<short>`) is a SECOND instance of the same pitfall, but with a twist: it must cancel the template's `px-4` too.** Unlike the group root (which is `isGroupLikePage`, so its template inner wrapper resolves to `margin: 0` with no padding on mobile), the poll detail route is NOT group-like — `template.tsx` wraps it in `max-w-4xl mx-auto px-4 pb-6` (and `lib/slideOverlay.tsx`'s `pollDetail` kind mirrors that exactly). So the poll content sits inset by `1rem` (px-4) PLUS the outer `max(0.35rem, env(safe-area-inset-*))`. The PollDetail swipeWrapper originally had `background: var(--background)` but NO negative margins, so its background only covered that inset box — measured at `left: 21.6, right: 408.4` on a 430px viewport while the full-width fixed `GroupHeader` spanned `0 → 430`. During a swipe-back the `GroupBackdropHost` (z=0) bled through the ~21.6px strips just below the header on each side. Fix: `marginLeft/Right: calc(-1rem - max(0.35rem, env(safe-area-inset-*, 0px)))` on the swipeWrapper (cancels BOTH px-4 and safe-area so the bg reaches `0 → 430`), PLUS compensating `paddingLeft/Right: calc(1rem + max(0.35rem, env(safe-area-inset-*, 0px)))` on the inner content div so the cards DON'T move (they're rounded cards with their own margins, not edge-to-edge full-bleed rows like the group page — so unlike GroupContent, the poll page needs the content kept inset, hence the compensating padding). The `getBoundingClientRect()` of the inner div reads `left: 0` post-fix because that's its border-box; its padding insets the actual children back to 21.6px. Verification approach (no real device needed): dispatch `group-backdrop:show` + manually set `transform: translate3d(Npx,0,0)` on `.touch-pan-y` + `div.fixed.top-0.z-20` + `#commit-badge-portal` (exactly what `useSwipeBackGesture` does), then compare the swipeWrapper's vs the header's `getBoundingClientRect().left/right` — they must match.

### Scroll API Pitfalls

- **Non-scrollable headers in iOS PWA need `touch-action: none`** to prevent elastic rubber-banding. iOS WebKit allows bounce/elastic behavior from touch gestures even on content that has no scroll to offer. Adding `touch-none` (Tailwind) to fixed header bars prevents touches on them from initiating any scroll behavior. Taps (`onClick`) still work — `touch-action` only controls default browser behaviors.
- **Viewport-relative `position: fixed` works** only because `.responsive-scaling-container` has no `transform` on mobile. Any `transform` (even `scale(1)`) creates a containing block that traps fixed children. The scaling container applies `transform: scale(1.5/2)` on desktop only, via media queries.
- **Use `window.scrollTo` / `window.scrollY` for page scroll**, not per-element scroll refs. The document is the scroller — there are no inner page scroll containers. Auto-scroll patterns (e.g., group page's scroll-to-bottom on load): `window.scrollTo(0, document.documentElement.scrollHeight)`. Expand-scroll: read/write `window.scrollY`.
- **Group-page scroll behavior is documented in one place** — the "Group-page scroll strategy" comment block at the top of the scroll section in `app/g/[groupShortId]/page.tsx` (just above the initial-load `useLayoutEffect`). It covers all four coupled concerns: (1) initial-load scroll, (1b) anchor pin (re-applied from layout effect AND ResizeObserver until first user interaction), (2) tap-expand smooth-scroll, and (3) the up/down scroll-helper arrows. When changing any group-page scroll behavior, update that block — don't accumulate scattered notes here. The arrows are INDEPENDENT (both can show simultaneously). Up shows whenever any awaiting poll (open poll the viewer has neither voted on nor abstained from) is not completely in view above — i.e. wholly above OR top-clipped — and targets the oldest such poll, aligning its top flush with the bottom of the fixed header. Down shows whenever the document can scroll further down (`scrollY < scrollHeight - innerHeight - 1`), independent of awaiting polls; on tap it scrolls to the first awaiting poll wholly below or bottom-clipped (same header-flush alignment) and falls back to scrolling to the document bottom when no such poll exists. **Always rAF-coalesce the body-subtree MutationObserver** that drives visibility — every awaiting card's `getBoundingClientRect()` is read per evaluate, and a vote / expand / countdown burst would otherwise trigger N forced layouts. Pattern: `let rafId: number | null = null;` + `const schedule = () => { if (rafId !== null) return; rafId = requestAnimationFrame(evaluate); };` + clear `rafId` at the top of `evaluate`; cancel in cleanup.
- **Scroll-helper arrows suppress OFF→ON transitions while the user is mid-scroll.** If an arrow isn't visible when scrolling starts, it stays hidden until scroll has completely stopped (debounced via `SCROLL_STOPPED_DEBOUNCE_MS = 150` on every scroll event — covers iOS momentum pauses without feeling laggy after a true stop). Already-visible arrows keep updating normally so they can hide / retarget. Implemented in the visibility evaluator's `useEffect` in `app/g/[groupShortId]/GroupPage.tsx` via two closure-local mutable vars: `isScrolling` (flipped true on every scroll event, cleared by the debounce timer's callback which also re-runs `schedule()`) and a pair of `currentShowUp`/`currentShowDown` mirrors of the React state that let `evaluate()` short-circuit BEFORE the per-awaiting-card `getBoundingClientRect` scan when both arrows are hidden mid-scroll — saves ~N forced layouts per rAF tick during a flick gesture on a long group. The mirrors are kept in sync inside the `setScrollHelpers` updater (write the `nextShowUp`/`nextShowDown` you're about to commit). Don't try to reuse `userInteractedRef` for this — it's a one-way latch ("user has interacted at least once") that explicitly avoids the `scroll` event because programmatic scrolls would falsely trip it; the suppression-debounce wants the opposite signal (every scroll, programmatic or not, resets the idle timer).

### Scroll-Position Memory Across In-App Back Navigation

- **`lib/scrollMemory.ts` holds a module-level `Map<string, number>` of saved `window.scrollY` values keyed per surface** (`HOME_SCROLL_KEY` for home, `groupScrollKey(routeId)` for group pages, `pollScrollKey(pollShortId)` for poll detail pages). Saved on every nav-away point via `rememberCurrentScroll(key)` (SSR-safe wrapper around `positions.set(key, window.scrollY)`); read on remount in `useLayoutEffect` via `getRememberedScroll(key)`. Persists across client-side navigations, resets on hard reload. Entries are overwritten on every save and never expire (bounded by O(distinct surfaces visited) which is small).
- **Save points are EXPLICIT at each tap handler, NOT a scroll listener.** A previous attempt installed a window scroll listener that wrote `window.scrollY` to the map on every scroll event (gated by `userInteractedRef`). It got POISONED by Next.js's auto-scroll-to-0: when the user tapped a card, Next.js scrolled the window to 0 as part of the navigation, the listener fired with `scrollY=0`, and 0 got saved over the user's actual position. The gate didn't help because `userInteractedRef.current` was already true from the tap's pointerdown. **Save explicitly at each tap handler instead** (7 sites: `GroupCardItem.navigateToDetail`, `GroupHeader.onBack` + `onTitleClick` overrides in `GroupContent` and `PollDetail`, `GroupList.handleActivate`, `CreateGroupButton.onClick`). The handler runs synchronously BEFORE the navigation fires, so window.scrollY is the user's actual position at save time; the post-nav auto-scroll-to-0 has nothing watching to clobber the value.
- **Entry from any source resumes the last position.** `GroupList.handleActivate` does NOT clear the destination group's saved scroll on home → group navigation. The previous "clear on forward nav" behavior produced the bug "tap group from home → reset to bottom even though I just left at scroll Y" that the original implementation tried to prevent with a stale-restore guard but actually broke. With explicit save points, stale restores aren't a real concern — every legitimate save happens at a real navigation tap.
- **Next.js App Router scrolls to (0, 0) on every navigation, including `router.back()`, via a `useEffect` that fires AFTER our `useLayoutEffect`.** `GroupContent`'s initial-load `useLayoutEffect` calls `window.scrollTo(0, remembered)` but Next.js's auto-scroll then resets it to 0 ~30-40ms later. A single follow-up `useEffect + rAF` re-apply isn't enough (observed in client logs: `scrollY=216` at our re-apply, then `scrollY=0` 35ms later, sustained). Solution: a bounded rAF loop in `GroupPage.tsx` that re-applies the target each frame, exiting early after 3 consecutive stable frames (~50ms past the iOS reset), at the 800ms deadline, or on first user interaction (`userInteractedRef` set by pointerdown/wheel/keydown). Layout-change re-application is left to `applyScrollAdjustmentRef` (which already runs on every render + ResizeObserver fire), and `applyScrollAdjustmentRef` early-returns when `restoreTargetRef.current !== null` so the bottom-pin doesn't fight the rAF loop. **The poll detail page uses the same restore-loop shape** (three refs + `useLayoutEffect` + rAF tick + interaction listener) inlined in `app/g/[groupShortId]/p/[pollShortId]/page.tsx: PollDetail`. The duplication is below the abstraction threshold today (two sites, GroupContent's restore is entangled with its bottom-pin logic and a shared `userInteractedRef`); when a third caller appears, lift the simple branch into a `useScrollRestore(key)` hook that takes a fallback callback for the no-saved-position path, and migrate both sites together. Don't extract just for PollDetail and leave GroupContent's copy unchanged — that defeats the drift-prevention purpose.
- **`apiGetGroupByRouteId` must merge fetched polls into `accessiblePollsCache`.** Without this, a user who lands directly on `/g/<id>` (deep-link, share, etc.) has the per-poll caches populated but `accessiblePollsCache` stays null because `cacheAccessiblePolls` was only ever called from `apiGetMyGroups` (home page's fetcher). Then on back-nav from a poll detail, `buildGroupSyncFromCache` returns null → the overlay's `GroupContent` renders the loading spinner during the slide → window.scrollY clamps to the tiny doc-height of the loading-state page → snap on unmount. Fix: `lib/api/groups.ts: hydrateAndCache` (shared by both `apiGetMyGroups` and `apiGetGroupByRouteId`) merges the returned polls into `accessiblePollsCache` by `group_id` — replaces entries for the current group, keeps entries from other groups. The "wipe other groups when cache is null" concern flagged in CLAUDE.md applies to the `cacheAccessiblePolls(...getCached() ?? [])` pattern in submit handlers; for `hydrateAndCache` the priming-when-empty behavior is deliberate.
- **The slide overlay pre-positions the destination via cards-wrapper transform, NOT by scrolling the overlay container.** When restoring a saved scroll, `slideToGroup` / `slideToGroupRoot` / `slideToPollDetail` peek the saved value and pass it as `overlayCardsOffset` on the slide event. `SlideOverlayHost` forwards it to the destination view (`GroupContent` or `PollDetailView`) as the prop of the same name. The view applies `transform: translate3d(0, -overlayCardsOffset, 0)` to the cards-wrapper `<div>` (a sibling of the fixed header). **DO NOT set the overlay div's `scrollTop` to the target value** — per the WebKit contain:strict quirk, position:fixed children scroll with the container's content, and the GroupHeader drifts off the top of the viewport. The CSS-variable + `transform: translate3d(0, var(--overlay-scroll-top, 0px), 0)` counter-translate on the header was tried and silently failed: `getBoundingClientRect().top` reported `-Y` despite the matrix transform showing the expected `translate3d(0, Y, 0)`. Transforming the cards-wrapper instead leaves the header alone (it's outside the transformed div) and works in every browser tested. Mirror this approach for any future overlay-slide kinds that need to pre-scroll their destination.
- **Full-mount-on-restore is load-bearing for accurate `scrollHeight`.** `GroupContent`'s `mountedGroupKeys` initializer mounts EVERY card up-front when `getRememberedScroll(groupScrollKey(groupId))` returns a value. The default anchor-only mount (just the last card) renders the rest as placeholder divs of `ESTIMATED_GROUP_HEIGHT=110` each; on a 20-poll group this gives `scrollHeight ≈ 2200`, but with real card heights it's `~2600`. If the saved scroll Y > 2200, `window.scrollTo(0, Y)` clamps to 2200-innerHeight and the user lands at the wrong position. Mounting all cards upfront makes `scrollHeight` accurate from the first paint. React.memo on `GroupCardItem` keeps subsequent state updates from re-rendering siblings so the perf cost is paid once at mount.
- **Diagnostic logging for scroll-restore bugs lives in `useLayoutEffect`/`useEffect`, NOT in render-phase code.** Adding `console.warn` to `buildGroupSyncFromCache` (called from `useState` initializer) triggered React's "setState during render" error because the client log forwarder (`lib/clientLogForwarder.ts`) patches console methods and dispatches a custom event, and `CommitInfo` listens for that event with a `setState` call. The same pattern applies anywhere render-phase code paths log via the forwarder. Either log from `useEffect`/`useLayoutEffect` (post-render, safe even though the forwarder still dispatches the event), or use raw `original.apply(console, args)` to bypass the forwarder for render-phase diagnostics.

- **`window.scrollTo` from GroupContent rendered INSIDE the slide overlay is a deferred-clamp landmine.** The overlay is `position: fixed + contain: strict`, so its wrapper's `minHeight` does NOT contribute to `documentElement.scrollHeight`. When the overlay's GroupContent's useLayoutEffect runs `window.scrollTo(0, remembered)` during a restore-nav, the doc only consists of the home page (~viewport tall). iOS Safari accepts the scroll briefly, then deferred-clamps `scrollY` back to 0 a few frames later — and the clamp **persists** even after the real-route's wrapper grows the doc. Visible as a 13-30ms window where `scrollY=0` right when the overlay unmounts, only flickering when the user's saved scroll is near the doc bottom (the bubble bar + bottom polls land off-screen above the viewport). Fix: gate the layout effect on `if (overlayCardsOffset !== undefined) return;` so only the real-route instance touches document scroll. The overlay positions its cards via `overlayCardsOffset` transform — doc scroll is irrelevant for it. **General rule**: any side effect inside a component that double-mounts (once in slide overlay, once in real route) needs an overlay-detection gate. `overlayCardsOffset !== undefined` is the canonical check; if you need it from a deeper component, plumb the prop down rather than re-detecting via DOM closest().

- **Pair the overlay-skip with `router.push(href, { scroll: false })` in slideOverlay.** Next.js App Router's `router.push` fires a post-commit useEffect that scrolls window to `(0, 0)`. The destination GroupContent owns scroll restoration via its useLayoutEffect; Next.js' scroll-to-top races it and re-introduces the same scrollY=0 window. `{ scroll: false }` tells Next.js to skip its scroll-to-top on the navigation. Note this only suppresses Next.js — iOS' own deferred clamping is unaffected, hence both fixes are needed together.

- **`restoreMinHeight` must be seeded in the `useState` initializer, NOT a useLayoutEffect setState.** `useLayoutEffect` runs AFTER initial render. A pattern like "useLayoutEffect → setRestoreMinHeight(remembered + innerHeight); window.scrollTo(0, remembered)" doesn't work because (a) the setState commits on the NEXT render, so the initial render still has the default `minHeight: 100dvh`; (b) the synchronous `window.scrollTo` reads `scrollHeight` from the un-grown wrapper and gets clamped. An imperative `swipeWrapperRef.current.style.minHeight = '${X}px'` write helps but is fragile across React reconciliation. The clean fix: read `getRememberedScroll(groupScrollKey(groupId))` inside `useState(() => ...)` so the very first render commits with the grown wrapper. `restoreMinHeight` is then `setRestoreMinHeight(null)` in the rAF bail when the restore window closes.

- **Compose the deferred-clamp defense in layers** — each one closes a gap the others can't reach: (1) `useState` initializer seeds `restoreMinHeight` so `scrollHeight` is correct from first paint, (2) `useLayoutEffect` calls `scrollTo(remembered)` synchronously before browser paint, (3) `{ scroll: false }` on `router.push` prevents Next.js scroll-to-top from racing, (4) `if (overlayCardsOffset !== undefined) return;` keeps the overlay from queueing a stale deferred clamp on a still-short doc, (5) rAF loop reapplies `scrollTo(remembered)` every frame for `BOTTOM_PIN_DURATION_MS=800ms` to catch iOS' delayed clamping windows. Removing any one of these re-introduces a visible flicker class. The diagnostic playbook: instrument `[scroll-debug]` logs at each layer (layout-effect entry, rAF tick, rAF BAIL, scroll-event repin) plus a separate `[bubble-debug]` rAF sampler that reads the bubble bar's `getBoundingClientRect().top` and prefixes `O`/`R` based on whether the bar's portal target sits inside the overlay's `aria-hidden + position:fixed` ancestor — the sampler is what nails down which leg of the defense is failing. Re-add them temporarily when a regression appears; CLAUDE.md commit history has the exact snippets.

### Portal Targets and Mount-Timing Races

- **Don't use a single `setTimeout` retry to find a DOM target that's mounted by a sibling component.** `CommitInfo` (in `layout.tsx`) needs the `#commit-badge-portal` element rendered by `template.tsx` behind its own `isMounted` flag. A 100ms retry worked on the home page but raced unpredictably on `/p/<id>/` and other routes where the template's mount effect commits later — leaving the commit-age badge missing for the rest of the session. Use a `MutationObserver` on `document.body` (with `childList: true, subtree: true`) and keep it running for the component's lifetime: React can replace the portal target across navigations, leaving a stale reference pointing at a detached node, so the observer re-queries on every DOM mutation and updates state only when the node identity changes.

- **Commit-age badge is enabled on dev + latest, not prod.** `CommitInfo`'s `showBadge` is the union of two signals: the `showTimeBadge` prop (gated by `NODE_ENV === 'development'` at the layout.tsx call site, baked into the bundle) AND `showOnLatest` (a `useState` lazy initializer that reads `window.location.hostname === 'latest.whoeverwants.com'` once). Runtime detection is mandatory for the canary signal because the same Vercel build serves both `whoeverwants.com` and `latest.whoeverwants.com`. Use a lazy `useState` initializer, NOT a `useEffect` that calls `setState` — the hostname never changes during a page's lifetime, so deriving via effect adds a redundant render. The modal itself + the `openCommitInfo` event listener stay ungated, so long-press on the badge OR the page header opens it on any host that renders the badge. Adding a third tier (or a 4th hostname-literal call site — current count: `CommitInfo.tsx`, `lib/clientLogForwarder.ts: isHighVolumeHost`/`isLogForwardingEnabled`, `lib/universalLinks.ts: KNOWN_HOSTS`) is the point at which extracting a shared `lib/deploymentTier.ts` becomes worthwhile.

### Dev Server Pitfalls

- **`node_modules` is NOT installed in the Claude Code sandbox** (the dev environment Claude runs in, not the Mac dev container). Running `npx tsc --noEmit` locally surfaces `TS2307: Cannot find module 'react' / 'next/server' / '@capacitor/core' / 'react-dom' / 'next/navigation' / ...` for EVERY file in the repo, not just your changes. These errors are SPURIOUS — the actual type-check runs on Vercel + the Mac dev container, which both have a populated `node_modules`. When checking your own changes, run `npx tsc --noEmit 2>&1 | grep -E "(yourFile1|yourFile2)"` and treat module-resolution errors that ALSO appear for unmodified existing files (e.g. `app/api/git-info/route.ts: TS2307: Cannot find module 'next/server'`) as noise. The fast way to validate type correctness for your changes is to push to the branch and watch the Mac dev container's build log + the Vercel preview build. **DECIDED (do NOT auto-install at session start):** the dependency tree install isn't free (wallclock + disk) and the large majority of sessions never need local `tsc`, so paying that cost on *every* session — e.g. via a SessionStart hook — is the wrong default. There is intentionally NO `npm ci` in any session-start hook. When a session genuinely needs local type-checking (a TS-heavy refactor where the push→build round-trip is too slow a feedback loop), run `npm ci` ONCE to populate `node_modules`, then `npm run typecheck` (= `tsc --noEmit`) as many times as you like — that's the on-demand opt-in. Sessions that don't install deps keep filtering the spurious `TS2307` noise per the `grep -E` recipe above. Don't add an auto-install hook without a new explicit ask; the grep filter is the steady-state workflow.
- **Dev server rate limiting is disabled** via `DISABLE_RATE_LIMIT=1` in `dev-server-manager.sh`. Dev servers are single-user, so production rate limits (120 GET/30 POST per minute) just cause friction during development.
- **`npm run dev` spawns a process chain** (`npm` -> `next` -> `node`). Killing the parent PID doesn't reliably kill child processes holding the TCP port. After PID-based kill, always `fuser -k <port>/tcp` to clean up orphaned children — otherwise the next start gets `EADDRINUSE`.
- **Dev server shows stale commit info** when the restart fails silently. The old process keeps serving pages. Always check `dev-server-manager.sh list` for `[STOPPED]` status after a push if the commit info doesn't update.
- **App-router directory renames poison Turbopack's filesystem cache.** Renaming/deleting an `app/<route>/` directory (e.g. `app/profile/` → `app/settings/`) leaves a pinned `AppPageLoaderTree` cell in `.next/cache` that no longer resolves. Turbopack panics `Failed to write app endpoint /<old-route>/page` on every request and broadcasts an HMR event that the client converts into a full reload — producing a ~1 Hz spontaneous-refresh loop on the dev site even though the source tree is correct. Fix: wipe `.next/` inside the Mac dev container and re-upsert (`bash scripts/remote-mac.sh "docker exec whoeverwants-dev-<slug> rm -rf /repo/.next" && bash scripts/remote-mac.sh "bash /opt/scripts/dev-server-manager.sh upsert <branch>"`). Note: `git pull` does not clear `.next/` — the normal push → webhook → upsert path won't fix a poisoned cache. If you see the loop pattern after a route rename, go straight to the `.next` wipe.
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
- **"Near X" placement is state-dependent: top while voting, BELOW the card while showing results.** During voting/suggesting it anchors the search-radius bubble at the top of the ballot card (`SearchRadiusBubble`, gated on `canSubmitSuggestions`); once results are on display it reads as a footnote UNDER the results card. `QuestionBallot` computes `resultsShownAbove` (mirrors the two result-display gates: preliminary-above-ballot `hasVoted && !isEditingVote && !inSuggestionPhase && hasCompletedRanking && showPrelimResults && !isQuestionClosed && !suppressYesNoHere && !suppressBinaryRcHere`, OR closed `isQuestionClosed && !suppressYesNoHere`) and renders "Near X" at the top only when `!resultsShownAbove`. QuestionBallot **can't escape its own card wrapper** (the `POLL_SUBCARD_CLASS` div is applied by the parent), so for the below-card placement it reports `{showBelow}` via the optional `onReferenceLocationStateChange(questionId, {showBelow})` callback (mirrors the `onWrapperSubmitStateChange` pattern; effect must be declared AFTER `resultsShownAbove`/`showReferenceBelowCard` or you hit a temporal-dead-zone on the dep array). The poll detail page (`app/g/[groupShortId]/p/[pollShortId]/page.tsx`) stores the flag in a `referenceBelowMap` (stable `useRef`-wrapped setter, no-op-guarded) and renders the line as a `Fragment` sibling AFTER the card div. When the callback is absent (any future reuse without a parent slot), QuestionBallot falls back to rendering "Near X" at the bottom INSIDE its card so the context is never dropped. QuestionBallot's full results view is mounted ONLY on the poll detail page today.
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

- **Bubble bar at the bottom of the scroll** (floating fixed via `BubbleBarPanel`) is a single horizontally-scrollable row: a leading bold "+ New" button (catch-all `custom` category) followed by one button per `BUILT_IN_TYPES` entry. Tapping any bubble calls `openModalFor(category)` which seeds a fresh `emptyDraft({ category })` and opens the bottom-sheet. The bubble bar always renders on group-like pages; constants `BUBBLE_ENTRIES` and `BUBBLE_BUTTON_CLASS` live at module scope (don't recreate per render). Order matches the `TypeFieldInput` dropdown so muscle memory carries over.
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
- **Anchor selection in the rebuild MUST validate `prev.rootPollId` against the post-mutate polls.** The expression is `prev.rootPollId && polls.some(p => p.id === prev.rootPollId) ? prev.rootPollId : polls[0].id`. The naive `prev.rootPollId ?? polls[0].id` form ships the empty→first-poll path correctly (rootPollId is null then) but breaks the placeholder-swap path on a 1-poll group: after POLL_PENDING, `prev.rootPollId = placeholder.id`; POLL_HYDRATED passes `mutate.remove = placeholderId`; the post-mutate `polls` is `[realPoll]`; the `??` falls through to the truthy-but-stale placeholder id; `buildGroupFromPollDown` returns null; the rebuild bails to prev — leaving the placeholder in `group.polls`. Meanwhile `mountedGroupKeys` advances to `realPoll.id`, so the slot keyed on the placeholder id renders as the virtualization gray spacer div. Symptom: "first poll in a new group → a space appears but the poll doesn't appear until I refresh." Same trap applies to any future mutate where the removed id IS the prior anchor.
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

### Enter-Advances-Focus Policy (Create-Poll Form)

- **Pressing Enter in a single-line `<input>` inside a `<form>` whose `onSubmit` calls `preventDefault()` is otherwise a no-op.** `lib/formNavigation.ts: enterAdvancesFocus` is the shared onKeyDown handler that makes Enter behave like Tab — it walks `document.querySelectorAll` of visible focusable controls (filtered via `offsetParent !== null`) and focuses the next one. Modifier-key combos (Shift/Ctrl/Alt/Meta + Enter) pass through unchanged. Wired into Title, Context (forField), plain option `<input>` (in `OptionsInput`), and the poll-level "Your Name" field (in `CompactNameField`). `AutocompleteInput` uses the underlying `advanceFormFocus(el)` from its own `handleKeyDown` so the existing "Enter selects highlighted suggestion" behavior wins when a suggestion is highlighted, and the focus-advance fallback runs only when no suggestion is active. When adding a new single-line input to the create-poll form, add `onKeyDown={enterAdvancesFocus}`. Textareas (Notes) are intentionally NOT wired — Enter must still insert a newline.

### Always-Visible Name Field

- **`CompactNameField` is always visible.** Earlier iterations had a two-state collapsed/expanded pattern ("Your Name: [Add]" → input → null when name was set), with an internal `isEditing` flag to keep the component mounted across keystrokes. The collapsed "Add" button + the hide-when-set null-return + the wrapping `empty:hidden` divs at the 7 call sites are all gone. The component now renders the input unconditionally; the "(optional)" label hint and the input's `placeholder` text were also dropped — the field affordance plus its label is enough. When adding similar pre-vote name/identity fields in new flows, follow the same pattern: always-visible input, trim-on-blur, no collapse/expand state machine.
- **General rule on call-site conditional rendering of stateful components**: still applies. Any `{somePredicate && <Component/>}` wrapper whose predicate depends on state the component itself mutates will unmount the component on the first internal mutation, killing focus mid-keystroke. That's why we collapsed the "Add"-button state machine entirely rather than re-introducing a `{!name.trim() && <CompactNameField/>}` wrap at every call site. If you ever need conditional rendering of a stateful input, put the gate INSIDE the component (with the internal state included in the gate's input), never at the call site.
- **`CompactNameField` renders the same `flex items-center justify-between gap-3 h-12` settings-row markup the create-poll form's bottom card uses** — label-left in `text-base font-normal shrink-0`, faded-grey right-aligned input in `flex-1 min-w-0 text-base bg-transparent text-gray-500 dark:text-gray-500 text-right`. Every consumer outside `create-poll` (the 7 ballot surfaces + the settings page) wraps it in `<section className="<margin> rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">` to give it the card chrome — the `bg-gray-50 dark:bg-gray-800` shade is the codebase's standard "off-page-bg" convention (see GradientBorderButton, DayTimeWindowsInput, RankingSection's empty state). Inside `create-poll` the field sits directly in the existing bottom card with `divide-y` siblings — the bottom card's `bg-white dark:bg-gray-800` is the right shade because the create-poll modal sits on a `bg-gray-100 dark:bg-gray-900` sheet backdrop. Two different card shades for two different parent contexts; pick by what's underneath, not by which surface you're on. Don't extract the `<section>` wrapper into a shared helper — same precedent as the `<SettingsRow>` decision (8 one-line uses with varying margins, abstraction obscures more than it clarifies).

### Create-Question Form UI Patterns

- **Settings rows in the new-poll cards are `flex items-center justify-between gap-3 h-12`** (the `cursor-pointer` variant adds it for `<label>` rows that wrap a labelable form control — select, checkbox, or any input). All single-line fields in the create-poll bottom-sheet use this exact row shape: Category / Context / Title (top card) and Voting Cutoff / Suggestion-or-Availability Cutoff / Min Responses / Share Results / Allow-pre-ranking / Your Name (bottom card). Cards themselves have NO vertical padding (`px-4` only) so card height = `48px × N rows + (N-1) hairline borders`. The conditional widgets (custom date/time pickers, time-question fields, warnings) still expand below their `h-12` label row when active — those are NOT field rows, just collapsible extras. When adding a new settings field, copy the exact class string from any existing row; don't introduce `min-h-` or `py-*` variations on it. **Wrap the row in `<label className="...cursor-pointer">` (and demote any inner `<label>` to `<span>`) whenever the row's input is content-sized** — e.g. the Category row's `TypeFieldInput` in borderless mode sizes its input to text content via `size={inputSize}`, so a bare `<div>` wrap leaves the input as a narrow tap target at the row's right edge and the user has to aim at it. The `<label>` wrap makes the whole row tappable via the implicit-association rule (clicks on row whitespace fire the activation behavior of the first labelable descendant — input or button — inside the wrapped control; buttons inside the input component are labelable per spec). Apply the same fix to Context / Title / Your Name only if their inputs ever shrink to content-size; today they fill the available width with placeholder text so the tap-target gap is less acute. (Considered extracting a `<SettingsRow>` component for the ~9 occurrences but the row shape is genuinely a 1-liner — abstraction would obscure rather than clarify.)
- **Field-value text is faded-grey `text-gray-500 dark:text-gray-500`, NOT blue.** Every typed input value and tappable "current value" display in the create-poll modal + settings page uses this same symmetric grey: `CompactNameField` input, `VotingCutoffField` value, `TypeFieldInput` borderless display/input + dropdown selected indicator, `CompactMinResponsesField` input+button, `OptionsInput` compact-variant input (non-duplicate branch), `ReferenceLocationInput` clear-button label, `MinimumParticipationModal` percentage display, `app/settings/page.tsx` Theme value, and four `app/create-poll/page.tsx` sites (poll title input, suggestion-cutoff value, question Context input, Min Availability % button). Blue (`text-blue-600 dark:text-blue-400`) is reserved for: the live auto-generated title preview above the create-poll card, distance info on locations/restaurants, countdown timers, tier link icons, status labels ("Taking Suggestions", "Collecting Availability"), the home-page animated title, URL/email autolinks, and similar non-field-value affordances. Don't add a new field-value control with blue text; mirror the grey convention and the row markup from any existing site.
- **Amber "needs attention" highlight for required form buttons**: The Tailwind class stack `bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-400 dark:border-amber-500 hover:bg-amber-200 dark:hover:bg-amber-900/60` is the codebase's idiom for drawing the user's eye to a button they need to tap to resolve a validation error. Used on the `+ Time` button in `DayTimeWindowsInput.tsx` when a day has zero time windows, and on the Select Days / Add/Remove Days button in `ParticipationConditions.tsx` when `dayTimeWindows` is empty. Match this style for any new "button that needs attention" states so the UI stays consistent.
- **Derive validation highlights from source state, not error strings**: When a form element needs to highlight in response to a specific validation failure, derive the highlight boolean from the underlying state (e.g. `dayTimeWindows.length === 0`) rather than comparing `validationError === "some exact string"`. String comparison silently breaks on typos or rewording. The pattern in `ParticipationConditions.tsx: highlightDaysButton` passes a simple state-derived boolean from the parent.
- **Compact tappable-value → modal pattern**: For form fields that don't need to be adjusted often (like Minimum Participation), use a single-line `<div>` with a `<button>` showing the current value in faded grey (`text-gray-500 dark:text-gray-500`). Tapping opens a modal with the full control (slider, picker, etc.). Don't wrap the whole thing in a `<label>` — there's no form control to associate with. Example: `MinimumParticipationModal.tsx` + the compact field in `app/create-question/page.tsx` (time question block).
- **Time-question split across cards.** The create-poll modal renders four time-question-specific cards above Notes (all gated on `showTimeFields`):
  1. A **Days** card holding the always-visible inline calendar via `<DaysSelector inline currentMonth={calendarMonth} />`. The prev / month-name / next nav row sits ABOVE the card on its own line — `flex items-center justify-between` with three children gives the month label true-center while pinning the arrows to the row's left/right edges, so the arrow x-coords stay stable across any month width (no min-width pinning needed). The page owns `calendarMonth` state; `advanceCalendarMonth(delta)` wraps `shiftMonth(prev, delta)`.
  2. The **Time Windows** card sits directly under the Days card with an external "Time Windows" label, then a `divide-y` body of `borderless` `DayTimeWindowsInput` rows. Rendered only when `dayTimeWindows.length > 0`. (There used to be a "Select Days" pill button in this card's header; the inline calendar replaced it.)
  3. The **Duration** card sits under Time Windows with an external "Duration" label and a `MinMaxCounter suffix="h"` inside — each min/max input renders a faded non-selectable "h" inside the input's right edge via `CounterInput`'s `suffix` prop. (The Duration field was previously inside the top form card via `TimeQuestionFields renderDaysSection={false}`; that path is gone in create-poll, but `TimeQuestionFields` itself is still used by `QuestionBallot/TimeBallotSection`.)
  4. The **Minimum Availability** card sits between the bottom poll-settings card and Notes.
  The top form card (Category + Context) drops its `border-t + py-3` wrapper for time polls — `formHasContent` excludes `showTimeFields` because the form body is empty for time polls (Duration / Days / Time Windows all live in their own cards now).
- **`lib/useDayTimeWindowsState.ts` is the shared hook** behind both the embedded days section in `TimeQuestionFields` and the lifted Time Windows card in `app/create-poll/page.tsx`. Owns the `removed-day window cache` ref (re-adding a day after removing it restores its previous windows) and exposes `onDaysSelected` / `onWindowsChange` / `onDeleteDay` + a `reset()` for clearing the cache. **Always call `reset()` when transitioning to a fresh draft.** The page-level usage wires it into `discardAndClose`; without that, the ref — attached to the long-lived `CreateQuestionContent` instead of the per-modal-session `TimeQuestionFields` — would silently re-populate windows from a discarded draft if the user picked the same day in a fresh poll. The hook tolerates `onChange = undefined` (no-ops every handler) so consumers can call it unconditionally at the top of the component even when their `onDayTimeWindowsChange` prop is optional. Mirror this lifecycle pattern any time you lift a ref out of a per-modal component to a longer-lived parent: expose a reset and wire it into the explicit-discard path.
- **`DayTimeWindowsInput`'s `borderless` prop** drops the standalone `bg-gray-50 dark:bg-gray-800 rounded-lg border` chrome + `p-1.5` padding so the row composes cleanly inside a parent card's `divide-y` layout. Pair `borderless` with `min-h-12 py-2` on the wrapper so single-pill rows match the form's `h-12` baseline and multi-pill rows still grow. The non-borderless flavor is preserved for the voter ballot's `TimeBallotSection`, which still renders the embedded days section via `TimeQuestionFields`.
- **Pill-on-info-line → modal pattern**: `components/SearchRadiusBubble.tsx` is the shared "blue pill shows current value, tap to edit in a small modal" control. Used on the question-creation form (`ReferenceLocationInput`) AND on the voting page's "Near X" info line (`QuestionBallot`) — owning `searchRadius` state in `QuestionBallot` and forwarding it as a prop to `SuggestionVotingInterface` keeps the two surfaces in sync with a single source of truth. When adding another numeric-value-with-unit pill control, reuse this component or mirror its structure (pill uses `bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full` class stack).
- **Radius bubble on the "Near X" voting-form line is gated on `canSubmitSuggestions && isLocationLikeCategory(category)`** — it's only meaningful during suggestion collection for location questions. `reference_location_label` is always co-set with `reference_latitude`/`reference_longitude`, so checking the label is sufficient — don't re-guard on latitude.
- **Form card section headers ("Options", "Time Windows", "Notes", "Suggestions") share `block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1`** — the canonical "label above a `rounded-3xl` card" idiom. Three sites in `app/create-poll/page.tsx`, one in `components/SuggestionVotingInterface.tsx`. The Time Windows site drops `mb-1 px-1` because its parent flex row already provides them; otherwise the strings are verbatim copies. NOT abstracted into a shared component / constant — same rationale as `<SettingsRow>` (4 sites, 1-liner string, one site already varies, indirection costs more than it saves). When adding a new "card with a label above it" section, copy the exact class string from any of the four existing sites; don't introduce `text-sm` (the prior value, 14px) or any other size variation.
- **Inter-card vertical gap inside the create-poll bottom sheet is `space-y-[14.4px]`** on the `.flex-1.overflow-y-auto` scroller in `app/create-poll/page.tsx`. (Was `space-y-3` = 12px; bumped 20% for breathing room around the larger card headers above.) Half-pixel values are house style here (precedent: `text-[15.84px]`, `py-[9.6px]`, `text-[17.5px]`) — modern browsers handle subpixel margins/font-sizes correctly. Don't "tidy" half-pixel arbitrary values into the nearest standard Tailwind size unless the spec also changes — they encode exact percentage-based design specs.
- **`DaysSelector` inline mode (`inline` prop) + controlled `currentMonth`** is the pattern for placing the calendar grid in a normal layout container without modal chrome. When `inline` is set, the calendar grid renders directly (no modal/backdrop, no Apply/Cancel buffer, no body-scroll-lock); toggles fire `onChange` immediately. When `currentMonth` is also provided, the internal month-nav row is hidden and the caller takes over rendering it — the parent owns month state and the arrow buttons. Modal mode (`inline` unset, used by `QuestionBallot/TimeBallotSection` for voter availability editing) is unchanged. Calendar rows are dynamic via `Math.ceil(needed / 7) * 7` so months that wrap a 6th week (e.g. April 2028 starts Saturday with 30 days → 36 cells) aren't truncated.
- **Stable centering with edge-pinned siblings: `flex justify-between` over three children.** First child pins to start, last to end, middle gets equal free space on each side → the middle stays true-centered regardless of its content width. Used for the create-poll Days nav row (`<prev> Month YYYY <next>`). No min-width pinning needed; the arrows lock to the row edges as a layout invariant. Don't reach for `min-w-[...rem]` on the centered text when this layout already gives you stability for free.
- **`CounterInput.suffix` prop renders a non-selectable, faded unit label inside the input on the right edge.** Implementation: when `suffix` is set, the input wraps in a `relative inline-block` div and flips to `text-right pr-5`; an absolutely-positioned `<span pointer-events-none select-none aria-hidden>` carries the label on the right at the same `text-xl font-medium` size, in `text-gray-400 dark:text-gray-500`. Used by the Duration card in create-poll (`suffix="h"`). Propagates through `MinMaxCounter.suffix` to both min/max counters. When adding a new "unit suffix on a number input" need, use the prop rather than a sibling span — the absolute overlay keeps the suffix from being part of the editable value and the layout stays compact.
- **Date helpers in `lib/timeUtils.ts`:** `formatLocalDateISO(date)` is the canonical YYYY-MM-DD formatter from a `Date` (use everywhere instead of the hand-rolled `getFullYear + padStart` triple — `lib/timeUtils.ts` is the only place this should live, and DaysSelector now consumes it; other call sites in `VotingCutoffField`, `VotingCutoffConditionsModal`, `createPollHelpers`, etc. should migrate as they're touched). `formatMonthYearLabel(date)` returns "September 2026" via `toLocaleDateString`. `shiftMonth(date, delta)` returns a new Date shifted by `delta` months (positive forward, negative back) — use instead of inline `new Date(prev); next.setMonth(next.getMonth() + delta)`. All three are pure and trivially safe to share.

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
- **`VoterList` accepts `includeSelf` to keep the current user in the bubble row.** Default is `false` — the singleLine row excludes the viewer because their state is signaled by the card's golden border. The group-card respondent row passes `includeSelf={isInSuggestionPhase(...)}` for ranked-choice suggestion phase: a single-suggester poll would otherwise render `"No suggestions yet"` even though the viewer just submitted a suggestion (excluded-self collapses the row to empty). Only set `includeSelf={true}` when the card-border signal is absent (post-vote) AND the user wants their own bubble visible. Static-mode (poll-level wrapper data) and live-mode (per-question fetch) both honor the flag. **The poll detail page (`/g/<id>/p/<short>`) passes `includeSelf` unconditionally** on its bottom Respondents row — same reasoning as `/info` (the page is a canonical roster for the poll; the viewer's own vote-state lives in the ballot above, not in the bubble row). Symptom of forgetting: user submits the only suggestion → poll detail page's bottom Respondents row reads "No voters yet" because the user gets filtered out by name match against `getUserName()`. The same `includeSelf` always-on rule applies to any future "canonical roster" surface — if the layout doesn't have a separate per-card signal next to the bubble row, the viewer should appear in it.
- **When `includeSelf` is true, the viewer's bubble renders as `"You (<name>)"` and floats to the front of the row.** Identity matching mirrors the exclude-self filter — live mode by `voteId === currentUserVoteId`, static mode by case-insensitive trim against `getUserName()`. `isSelfVoter` + `labelFor` helpers in `VoterList.tsx` are the single source of truth; both the singleLine and stacked renderers consume them. Floating to position 0 is load-bearing on the singleLine path: without it, alphabetical sort can push the viewer's bubble past the right edge into the `+N` overflow, defeating the "confirm my submission landed" intent of `includeSelf` on large groups. When `includeSelf=false` (default), the viewer is filtered out before `labelFor` runs, so the `"You (...)"` substitution is a no-op for those surfaces (group-card respondent row outside suggestion phase, /info bubble graphics that don't go through this code path).
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
- **`server/services/groups.py` is the equivalent home for group-aggregation helpers (Phase B.3).** `polls_for_poll_ids(conn, poll_ids, *, include_results)` builds the `PollResponse[]` payload (with inline results, voter aggregates, response counts) from a list of poll_ids. Both `/api/questions/accessible` and `/api/groups/*` use it. `poll_ids_for_group_ids` is a thin SQL wrapper (fan a group-id set out to its poll_ids); `resolve_group_id_from_route_id(conn, route_id)` does the four-form lookup (groups.short_id → groups.id → polls.short_id → polls.id). (`group_ids_for_question_ids` was removed with the forget bridge.) Phase B.4 introduced `~`-prefixed group short_ids that resolve via the first lookup; the legacy `/g/<root-poll-short-id>` form still resolves via the same first lookup because B.1 backfilled `groups.short_id` from the root poll's short_id. The polls.short_id / polls.id fallbacks remain only for redirects from legacy URL paths.
- **`BrowserIdMiddleware` reads/mints a `X-Browser-Id` header per request (Phase B.3).** A header (not cookie) because the FE talks same-origin to the API in prod (Next.js rewrite) and direct in dev/CI; cookies would require credentialed CORS which doesn't compose with `allow_origins=["*"]`. The id is always echoed on the response (even on 4xx/5xx) so the FE can adopt server-issued ids on the very first request. `request.state.browser_id` is populated for every request; **Phase B.3 only captures, doesn't enforce** — Phase C will add `group_members` and start gating visibility on this id. Reading/setting from a router: `getattr(request.state, "browser_id", None)`.
- **FE `lib/browserIdentity.ts` is the canonical browser-id storage.** `getBrowserId()` returns the localStorage value or null. `adoptServerBrowserId(value)` is called by `_internal.ts: fetchWithBase` after every fetch — it's a first-write-wins merger so a compromised middlebox can't rewrite the id mid-session (mismatch logs a warning and keeps the existing id). Don't roll your own UUID — let the server mint and adopt the response.
- **`apiGetMyGroups(accessibleQuestionIds)` and `apiGetGroupByRouteId(routeId)` (in `lib/api/groups.ts`) replace the legacy `discoverRelatedQuestions + apiGetAccessibleQuestions` pair.** Both warm `cachePoll` and the per-question results cache so subsequent `apiGetQuestionById`/`apiGetQuestionResults` calls hit warm cache. Use these for any new "give me this group" flow; don't reach for `apiGetAccessibleQuestions` in new code (it's preserved for the legacy compatibility layer). The drop-in `getMyGroups()` wrapper in `lib/simpleQuestionQueries.ts` is what `app/page.tsx`, `app/g/[groupShortId]/page.tsx`, and `lib/useGroup.ts` consume — it adds in-flight coalescing (StrictMode-safe), accessible-id persistence (the server-discovered question_ids get added to localStorage subject to the forgotten-list filter), and accessible-cache invalidation when the set grew.
- **Catch-all fallthrough in `_compute_results()`**: When adding new question types, `server/services/questions.py: _compute_results()` has a catch-all return at the bottom returning `yes_count=None`. Any question type without an explicit handler silently falls through and the frontend interprets `None` as `0`. Always add an explicit handler for each question type.
- **Frontend TODO stubs cause silent failures**: If the backend adds a new endpoint, check whether the frontend has TODO stubs (e.g., `setParticipants([])`) that need to be connected. Stubs cause incorrect UI without errors.
- **`toQuestionResults()` in `lib/api.ts` is a manual field mapper** — when adding new fields to `QuestionResultsResponse` on the backend, you MUST also add them to `toQuestionResults()` or they'll be silently dropped. The function explicitly maps each field; unmapped fields from the API response are discarded.
- **`toQuestionResults` allocates a fresh object on every call, which defeats identity-based setState guards.** `apiGetQuestionResults` resolves via `coalesced()` — when the cache is warm, it returns the *same* reference stored by `cacheQuestionResults`; but the very first call (cache miss) builds a new object via `toQuestionResults(data)` and every subsequent *live* refetch (after invalidation) does the same. So `setQuestionResultsMap(prev => prev.get(id) === results ? prev : ...new Map(prev).set(id, results))` looks like a no-op guard but always falls through, allocating a new Map + firing a re-render on every fetch. Compare by field content (`total_votes`, `yes_count`, `no_count`, `winner`) instead of reference identity. Same pattern applies to any state-map seeded from API helpers that pass through `to*()` converters.
- **Dev server Pydantic schema caching**: Adding fields to a Pydantic `BaseModel` (like `QuestionResultsResponse`) requires a full API restart — `uvicorn` with hot-reload doesn't always pick up model schema changes. Use `dev-server-manager.sh upsert` to force a clean restart.
- **`services/groups.py: require_uuid(value, label)` is the canonical UUID-shape gate** for any path-param `{poll_id}` / `{question_id}` / `{browser_id}` / similar that gets fed into a `WHERE id = %(id)s` query. Without it, a malformed input like `NOT-A-UUID` reaches psycopg and surfaces as `psycopg.errors.InvalidTextRepresentation` → unhandled 500. The helper wraps `_is_uuid_like` and raises `HTTPException(404, f"Invalid {label}")` before the DB query runs. Three routers (`polls.py`, `questions.py`, `users.py`) call it via `from services.groups import require_uuid`. **Do NOT** re-implement a private `_require_uuid` per-router — that pattern was retired in the bug-testing pass (each copy was identical and the divergence risk dominated). New endpoints with UUID path params should import and call the shared helper. Regression suite: `server/tests/test_uuid_validation.py` parametrises 7 bad inputs across every covered endpoint.

### Local API for the Vitest API-backed tests

- **The 56 "API-backed" Vitest tests under `tests/__tests__/{ballot-logic,ranked-choice,integration,...}`** soft-skip via `if (!apiUp) skip()` when `tests/helpers/database.js: isApiAvailable()` can't reach `http://localhost:8000/health`. To run them all (zero skips), stand up a local API + DB:
  1. `service postgresql start` (creates DB at `localhost:5432`).
  2. Create the `whoeverwants` user + DB if missing: `su - postgres -c "psql -c \"CREATE USER whoeverwants WITH PASSWORD 'whoeverwants' SUPERUSER;\""` then `... CREATE DATABASE ... OWNER whoeverwants`.
  3. Apply all migrations: `for f in database/migrations/*_up.sql; do PGPASSWORD=whoeverwants psql -U whoeverwants -h localhost -d whoeverwants -f "$f" -q; done`.
  4. Start the API: `cd server && DATABASE_URL='postgresql://whoeverwants:whoeverwants@localhost:5432/whoeverwants' DISABLE_RATE_LIMIT=1 nohup uv run uvicorn main:app --host 127.0.0.1 --port 8000 > /tmp/local_api.log 2>&1 &`
  5. `TEST_API_URL=http://127.0.0.1:8000/api/questions npx vitest run` — all 225 tests pass, zero skips.
  Sandbox sessions often have postgres stopped at start; the API will boot and `/health` returns "degraded" until you start postgres, so check both before running tests. Same local stack runs `server/tests` with `DATABASE_URL=...` set, no port 8000 needed.

### Auto-Created Follow-Up Questions & Creator Secrets

- **Auto-created questions share the parent's `creator_secret`**, but the browser only stores secrets for questions it created directly. When navigating to an auto-created follow-up question (e.g., preferences question from a suggestion question), the browser must propagate the parent's secret to the child. Do this both on navigation (in the close handler) and on page load (check `question.follow_up_to` and propagate if the parent's secret is known).
- **Use `recordQuestionCreation(questionId, creatorSecret)` from `lib/browserQuestionAccess.ts`** to persist a poll's creator secret on create. It now only stores the secret (poll-ownership authorization) — there's no accessible-question list to register into anymore, since `group_members` (written server-side) is the single source of visibility truth.
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

The `screenshot.sh` script automates the full pipeline: Playwright (on the droplet, which has it pre-installed) hits the public Mac-mini dev URL → base64 transfer to local `/tmp` for Claude assessment → serve into the Mac dev container's `/repo/public/screenshots/` so the PNG is reachable at `https://<slug>.dev.whoeverwants.com/screenshots/<name>.png`.

```bash
# Take a screenshot and serve it (uses the dev server's branch slug, not a port)
bash scripts/screenshot.sh take <slug> <path> <name> [--width W] [--height H] [--wait MS] [--no-serve]

# Examples (slug = the branch's dev server slug, e.g. claude-my-branch):
bash scripts/screenshot.sh take claude-my-branch / home-before
bash scripts/screenshot.sh take claude-my-branch /g/abc123 group-after --width 430 --height 932

# Serve a previously taken screenshot to a Mac dev server
bash scripts/screenshot.sh serve my-screenshot claude-my-branch

# Print comparison URLs
bash scripts/screenshot.sh compare before-name after-name claude-my-branch
```

The `take` action's first positional was previously a port (`localhost:<port>` on the droplet). That form is gone — dev servers live on the Mac mini now, so the slug + public URL is the only valid input. The serve path writes through `remote-mac.sh` + `docker exec` into the dev container, so a single `take` invocation works end-to-end without ever touching the droplet's filesystem.

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

### Overlay-Slide Navigation (group / info / edit-title / back)

The View Transitions API path is still used for any other in-app navigation (home↔settings, group→home back). **The in-group sub-route navigations and home→group taps use a different mechanism** — overlay-slide — because the View Transitions API gates animation start on the destination route being committed + `data-page-ready`. Even with a warm cache that adds ~300ms of `router.push` + snapshot work before the first frame of the slide can move. Overlay-slide makes the slide begin on the next RAF.

Transitions covered by overlay-slide:
- Home → group (`slideToGroup` from `GroupList`)
- Group → /info (`slideToGroupInfo` from `GroupHeader.onTitleClick`)
- /info → /edit-title (`slideToGroupEditTitle` from the Edit button)
- /info → group root (back, `slideToGroupRoot`)
- /edit-title → /info (back, `slideToGroupInfo` with `direction: 'back'`)
- Home new group button → empty group (`slideToNewGroup` from `CreateGroupButton` in `app/template.tsx`)

- **`lib/slideOverlay.tsx`** exports a `<SlideOverlayHost/>` (renamed from `GroupSlideOverlayHost` once the host went generic) + four typed helpers: `slideToGroup`, `slideToGroupInfo`, `slideToGroupEditTitle`, `slideToGroupRoot`. The host portal-mounts the destination view directly to `document.body` with `position: fixed; inset: 0; transform: translate3d(±100% → 0)` over 350ms (sign depends on `direction`); `router.push` (or `router.back()` when `useHistoryBack`) fires from inside an effect once `phase==='shown'` so URL/history catch up while the slide plays.
- **`SlideToGroupDetail` carries a discriminated `SlideOverlayKind` union** (`'group' | 'groupInfo' | 'groupEditTitle'`) plus `direction: 'forward' | 'back'` and `useHistoryBack: boolean`. Host's `renderForKind(kind)` switches on `kind.type` to mount the right view component. Adding a new kind: extend the union in `lib/eventChannels.ts`, export a prop-driven `<Kind>View` from the page's route file, add the case in `renderForKind`, add a `slideToKind(...)` helper.
- **Prop-driven page views (e.g. `GroupInfoView`, `GroupEditTitleView`)** are exposed alongside the route's default export. The overlay mounts these directly via props because the URL is still the source page during the slide — `useParams()`-driven inner components would resolve to the wrong id. Mirrors the existing `GroupContent` / `GroupPageInner` split in `app/g/[groupShortId]/GroupPage.tsx`.
- **`<SlideOverlayHost />` MUST be mounted in `app/layout.tsx`, NOT `app/template.tsx`.** Template instances new on every navigation per Next.js semantics, so the overlay's state would be reset to null the moment `router.push` commits — the overlay vanishes mid-slide, exposing the source page underneath. Layout persists across routes.
- **Back direction (translate3d(-100%, 0, 0) → 0) is not iOS-accurate but reads correctly.** Real iOS back animates the SOURCE off to the right, exposing the destination underneath. Our overlay always animates the DESTINATION (we can't easily capture the source as an animated layer), so back just enters from the left. Visually distinct from forward; users perceive it as "going back" regardless.
- **`useHistoryBack: true` calls `router.back()` so the in-app history stack pops** (matches `navigateBackWithTransition`'s prior behavior). Pass `useHistoryBack: hasAppHistory()` so direct URL landings without in-app history fall back to `router.push(href)` instead. The `href` field still needs to match the destination's pathname (without query string) so the unmount-timing branch (`urlMatches`) fires when `router.back` lands on a URL with `?p=…`.
- **Per-kind inner wrapper class must match template.tsx's wrapper for that route.** Group routes get `max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4` (no bottom padding — the floating `BubbleBarPanel` owns that and the cards-wrapper inside reserves its measured height via the `--bubble-bar-panel-height` CSS var); info/edit-title get `max-w-4xl mx-auto px-4 pb-6`. The two layouts differ — without matching template's wrapper exactly, the inner page's own `max-w-4xl mx-auto px-4` is the only padding the overlay applies and content shifts inward on unmount as template's additional `px-4` kicks in (the original symptom: members list "shifts right slightly" after slide in). The shared safe-area horizontal padding wrapper lifts out of the per-kind ternary; only the inner className differs. Historical: both the slide overlay and `GroupBackdropHost` previously added `paddingBottom: '0.5rem'` for group kind to match template's now-retired 0.5rem buffer for the in-flow bubble bar — dropped when the bar became position-fixed (otherwise the handoff would shift content 8px).
- **Double-rAF is load-bearing for the enter→shown transition.** Single rAF can land in the same paint pass as the React commit that mounted the overlay (with `transform: translate3d(100%, 0, 0)` + `transition: none`), so the browser never sees an "enter" frame — the transition gets skipped and the overlay snaps directly to translate3d(0). Two rAFs guarantee a paint commit at translate3d(100%) before the transform changes. Same idea as the FLIP pattern.
- **`GroupContent` inside the overlay must avoid global side effects that mutate browser history.** The "sync `?p=` to expanded card" effect in `GroupPage.tsx` (`replaceState` to update the URL query) was firing while the overlay was still on the source page (`pathname='/'`), writing `?p=<short>` into the home history entry. Back-nav then landed on `/?p=<short>` instead of `/`. Gate via `if (!window.location.pathname.startsWith('/g/')) return;` so the effect is a no-op in the overlay's transient mount window. Any future `replaceState`/`pushState` call inside `GroupContent` needs the same guard.
- **Mirror template.tsx's wrappers inside the overlay.** Both kinds share the outer safe-area horizontal padding (`paddingLeft/Right: max(0.35rem, env(safe-area-inset-*))`). The inner wrapper differs per kind — see the "per-kind inner wrapper class" point above. The destination's wrappers live in `app/template.tsx:244-310`. Pixel-perfect alignment is required for a seamless handoff. **If template.tsx's wrappers ever change, audit `lib/slideOverlay.tsx` too.**
- **Destination view mounts twice per slide** (once in overlay, once in the real route after router.push commits). API calls are deduped by the `coalesced()` helper in `lib/api/_internal.ts` for the helpers that wrap with it; `apiGetGroupByRouteId` is NOT currently coalesced, so a cache miss does fire two network round-trips (cache hit is the common case and short-circuits via `useGroup`'s synchronous-init). The two instances coexist for ~SLIDE_DURATION_MS+30 = 380ms after pathname flips, then the overlay unmounts via a single ref-tracked timer (one per slide; cleared on new slide events so a pending unmount can't null out the next slide's state mid-flight).
- **`key={kind.groupId}` on the rendered view** is required so that switching to a different group's destination while a slide is in flight remounts the component with fresh `useState`/`useGroup` initial values. Without the key, switching group ids on the same instance would keep the previous group's cached state (since `useGroup`'s initializer only runs once).
- **Inherit the Geist font via `font-[family-name:var(--font-geist-sans)]` on the overlay's outer div.** The portal target is `document.body`, which only declares the `--font-geist-sans` CSS variable (via `GeistSans.variable` on the body className); the actual `font-family` rule lives on an inner wrapper inside `<ResponsiveScaling>` that the overlay doesn't share. Without this, overlay text renders in body's default Arial/Helvetica fallback and the user sees character spacing change the instant the overlay unmounts.
- **DO NOT use `overlay.scrollTop` to align cards with the header.** The overlay's `contain: strict` (+ its `transform: translate3d`) makes `position: fixed` descendants behave as absolute-positioned inside the overlay — they scroll WITH the overlay's scrollTop. Setting `scrollTop=8` to align the first card flush with the GroupHeader yanks the header itself 8px above the viewport top; the user sees "the top bar shifts down" when the overlay unmounts and the header drops back to its real `top: 0`. The group page's overlay slide-in lets the real route's initial-scroll effect handle landing position post-handoff.
- **Pitfall: `position: fixed` inside `contain: strict` + `overflow: auto` IS subject to the container's scroll.** Per the empirical behavior in Chromium / WebKit, fixed-positioned children of an element with `contain: strict` or `contain: paint` get a new containing block (the contained element) AND scroll with that element's scrollable content. This contradicts the naive reading of "position:fixed never scrolls", but it's how the spec interacts with the new containing block. Any time you add `contain: strict`/`paint` to a scroll container with fixed-positioned children inside, expect them to scroll with the container.
- **Pitfall: overlay-slide unmount cleanups must NOT nuke shared body attributes the destination still needs.** The handoff briefly mounts two component instances for the same destination: one in the overlay portal (instance A), one in the real route (instance B). Both run their `useEffect`s on mount. ~380ms later the overlay unmounts and A's cleanup fires — even though B is still mounted and the user is still on the destination URL. If A's cleanup unconditionally clears a body attribute that the next user action reads (e.g. `body.data-group-id`, which `app/create-poll/page.tsx: handleSubmitClick` reads to attach new polls to the current group), the attribute goes missing and the next submit silently does the wrong thing. Concrete failure mode found: user created a group → /info → /edit-title → back to /g/<id> via slide-back → tap a category bubble → submit; poll attached to a freshly-minted group instead of the current one because `body.data-group-id` was nulled by the overlay's unmount. Fix shape: **drop the cleanup** rather than ref-count or value-match. Other entry/exit paths (the new mount's set effect, dedicated defensive `removeAttribute` on adjacent routes like `/g/page.tsx`) cover every transition that actually matters; leaving the attribute stale on /home or /settings is harmless because neither has a submit path that reads it. Adjacent rule: whenever you add a new body attribute that any submit/action reads, audit every overlay-slide kind that mounts a destination using it — same trap appears unless the cleanup is omitted there too. Also: as a side benefit, dropping the cleanup eliminates the microsecond `attr=null` window that the 5s `apiGetGroupByRouteId` refresh used to open every tick (cleanup-then-set).
- **Pitfall: testing font / position differences requires reading computed styles, not just bounding rects.** A probe that only measures `getBoundingClientRect().top` for an `h3` will silently report identical positions between overlay and real route when the issue is actually that the OVERLAY's `h3` is a different element from the REAL ROUTE's `h3` rendered in the background (the home page's cards leak in until the route commits). Always check `inOverlay` membership via `closest('div[aria-hidden="true"][style*="position: fixed"]')` AND check `getComputedStyle(el).fontFamily` to catch the font case.
- **`'newGroup'` is a "caller owns navigation" kind.** `slideToNewGroup()` (in `lib/slideOverlay.tsx`) dispatches with `href: '/g'` + `kind: { type: 'newGroup' }`; the host renders `<EmptyPlaceholder inOverlay />` (exported from `app/g/page.tsx`) for that kind but **skips the auto-`router.push`** so the new group button caller can fire its own `router.push('/g/<short_id>')` once `apiCreateGroup` resolves. Unmount predicate also has a per-kind branch: matches any group root view via `isGroupRootView(current)` (instead of strict-equal to `state.href`) since the final URL is dynamic between `/g/<short_id>` (success) and `/g` (failure). Pattern to follow when adding another "create-then-navigate" kind: extend `SlideOverlayKind`, add the case in `renderForKind`, gate the auto-push effect, and pick a per-kind URL-matcher.
- **Header chrome must match destination for clean handoff.** The new group button's overlay started with a bare `<GroupHeader title="New Group">` while the real `/g/<short_id>` route mounts `GroupHeader` with the participant avatar + tappable title — when the overlay unmounted, the header visibly populated. `EmptyPlaceholder({inOverlay})` now mirrors the destination's chrome (`participantNames: []`, `anonymousCount: 0`, no-op `onTitleClick`). `usePageReady` is skipped when `inOverlay` (the underlying route is still the source page, so writing `data-page-ready=/g` would lie to other in-flight view-transitions). Rule: any new "caller owns navigation" kind needs its overlay placeholder to render the SAME header chrome the destination will, not just the title — even if the buttons need empty-routeId / no-op handlers during the transient overlay window. (Earlier this rule mentioned the share button in the rightSlot; that's been retired — the share button now lives on the info page hero, not the group header.)
- **Placeholder copy lives in `lib/groupUtils.ts: EMPTY_GROUP_HINT`.** Both the overlay's `EmptyPlaceholder` and the real route's `GroupContent` (gated on `group.isEmpty`) render it. Don't duplicate the string — wording changes propagate via the constant.
- **The "caller owns navigation" handoff must also pre-populate the destination's synchronous cache reads.** A subtle bug shipped with the initial `newGroup` overlay-slide: the slide rendered fine, but the destination route mounted on a cold cache (`apiCreateGroup` returned a `GroupSummary`, not a `Poll`, so `getCachedAccessiblePolls()` had no entry for the new group). `GroupPageInner` therefore rendered its "Loading group..." spinner during the ~hundreds-of-ms `apiGetGroupByRouteId` + `apiGetGroupSummary` chain — and the overlay unmounted after 380ms onto that spinner, producing a visible "page disappears, then reappears". Fix: `apiCreateGroup` writes the summary to a new `groupSummary{ById,ByShortId}` LRU cache in `lib/questionCache.ts` (60s TTL, MAX_ENTRIES bounded, same shape as the polls cache). `buildGroupSyncFromCache` falls through to `buildEmptyGroup(summary)` when no polls match but a summary is cached, and `GroupPageInner` initializes `isEmptyGroup` synchronously from the same lookup. `apiGetGroupSummary` short-circuits on cache hit so the destination's `fetchGroup` fallback doesn't fire a redundant round-trip for the freshly-cached summary. General rule: whenever an overlay-slide kind is "caller owns navigation", audit every synchronous cache read the destination makes — if any return null because the caller's API response didn't seed them, that's a spinner waiting to flash. `apiUpdateGroupTitle` + `invalidateGroupPolls` (image upload/delete) both call `invalidateGroupSummary` alongside their existing poll-cache invalidations so the summary cache can't go stale on wrapper-field changes.
- **The bubble bar's `#draft-poll-portal` target needs identical effective width in both places.** The persistent `<CreateQuestionContent>` finds every match via `querySelectorAll` and portals into all of them (so the bar exists in BOTH the overlay's portal AND the real-route's portal during the slide). The bar's `flex flex-wrap justify-center` packs differently if the two portal containers have different widths, producing a visible "bubbles rearrange" on overlay handoff. Symptom found: `EmptyPlaceholder` wrapped its portal in `<div className="px-4">` while `GroupContent` had no horizontal padding around its portal — 32px width difference, bubbles wrapped to a different row count. Fix: keep the portal target free of horizontal padding in BOTH renderers; move any padding onto the sibling `<p>` / message. Same rule applies whenever you add a new overlay-slide destination that hosts a portal target shared with a persistent component.
- **The slide overlay (z-60, opaque background) hides everything portaled to body-level at lower z-index throughout the slide.** The scroll-helper arrows on `GroupContent` portal to `#floating-fab-portal` (body-level) at z-40, so during a group-kind slide they sat under the overlay's opaque white/black background and only became visible after the overlay unmounted (~410ms in) — surfacing to users as "arrows only appear AFTER the transition". Fix: `SlideOverlayHost` exports a `useIsSlideOverlayGroupActive()` hook + dispatches `SLIDE_OVERLAY_GROUP_ACTIVE_EVENT` when its `state.kind.type === 'group' || 'newGroup'` flips; the arrows read the hook and switch from z-40 to z-70 (above z-60) while a group-kind overlay is mounted. Only `group`/`newGroup` kinds elevate — slides FROM group to a subroute (`groupInfo`, `groupEditTitle`, `pollDetail`, `pollInfo`) keep arrows at z-40 so the incoming overlay still covers them naturally as it slides over them. Don't try to render the arrows INSIDE the overlay (so they "slide in with it") — the overlay's instance of `GroupContent` computes `scrollHelpers.showUp/showDown` from `window.scrollY` and `getBoundingClientRect()` which return the OUTER document's coordinates, not the overlay's; the scrollHelpers state stays `{showUp: false, showDown: false}` and no arrows ever draw inside the overlay. The pattern (module-level boolean + change-detecting writer + `useState`-lazy-init + window-event hook) follows `lib/useMyUserImageUrl.ts`'s precedent. Apply this anytime a body-level portal target needs to "follow the slide" — bump z-index above the overlay while the relevant overlay kind is active.
- **`scripts/bench-group-nav.mjs`** is the focused bench for this path (targets the current `/g/<groupShortId>` canonical route; the legacy `scripts/bench-navigation.mjs` still references retired `/p/<id>` paths). Baseline (view-transitions) vs overlay-slide on local prod build, warm cache, 10 runs:
  ```
  metric                   baseline (view-trans)   overlay-slide
  click → first frame       9ms                    14-15ms (1 RAF)
  click → URL flip          300ms p50 / 982ms p90   37ms p50 / 66ms p90    (8× faster)
  ready after URL flip      0ms                    13ms p50
  click → transition done   813ms p50 / 1489ms p90  48ms p50 / 340ms p90    (15× faster)
  CSS slide duration        520ms                  350ms (tunable in `SLIDE_DURATION_MS`)
  ```
  User perception: motion begins ~15ms after tap instead of ~300ms.

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
- **Mutations must invalidate the cache.** `invalidateQuestion(id)` and `invalidatePoll(id)` clear all per-entity caches. Call after every successful vote, close, reopen, cutoff, edit, etc.
- **Field-level vs shape-level invalidation is a load-bearing distinction.** `invalidateQuestion` / `invalidatePoll` are FIELD-LEVEL — they drop per-entity caches but DO NOT touch `accessiblePollsCache`. The accessible-polls list is the "which polls exist in which group" shape, which a vote / close / reopen / cutoff / edit / title-update / image-update cannot change. Embedded fields go briefly stale; the 5s group-page refresh + `QUESTION_VOTES_CHANGED_EVENT` listener correct them within seconds, and the 60s TTL bounds worst-case staleness. **SHAPE-LEVEL** changes — forget, leave-group, discovery, failed-create placeholder cleanup — MUST also call `invalidateAccessibleQuestions()` (or surgically rewrite the list via `updateAccessiblePollsIfFresh`). Without that explicit call, `buildGroupSyncFromCache` keeps rebuilding the group with the dead entry until the TTL expires. Symptom of forgetting: stale list serves the next render but is "narrower than reality" or "wider than reality" depending on which way you missed. Earlier `invalidateQuestion` nulled `accessiblePollsCache` as a side effect — that masked missing explicit calls but also broke back-nav scroll restoration (every vote on a poll detail page wiped the accessible cache, so the return to the group mounted with `initialGroup = null` and only the anchor card was pre-mounted, leaving `scrollHeight` short and the restored `window.scrollTo(0, savedY)` clamped to a wrong value). Regression test: `tests/__tests__/question-cache-invariant.test.ts` pins the invariant. When adding a new mutation, ask: "does this change WHICH polls/questions are in the group?" — if yes, pair `invalidatePoll` with `invalidateAccessibleQuestions`.
- **`getMyGroups()` is membership-only and stateless on localStorage.** It fires `apiGetMyGroups()` (no args) + `apiGetMyEmptyGroups()` in parallel and returns the server's member-group response directly. There's no localStorage accessible/forgotten list, no discovery-persist step, and no cache-freshness gate keyed on a question-id list — `group_members` (server-side) is the single source of truth. The accessible-polls cache (`accessiblePollsCache`) is still populated as a synchronous-render warm cache by `hydrateAndCache` in `lib/api/groups.ts`, but it's derived from the server response, not from a localStorage list. "Forget a group" = leave the group (`apiLeaveGroup`), which also invalidates the accessible cache (via `forgetQuestion`'s `invalidateAccessibleQuestions()`).
- **Coalesce concurrent API calls** with `coalesced()` in `lib/api.ts`. React StrictMode double-mounts effects in dev, causing two simultaneous calls to the same endpoint. `getMyGroups` uses an in-flight promise (`myGroupsInFlight`) to dedupe.

### Production build testing on the Mac dev server

- To test with a real production bundle instead of `next dev`, build + start inside the Mac dev container. The container's FE port (3000 internal) is already wired through Caddy to `https://<slug>.dev.whoeverwants.com`, so swap out `next dev` for `next start` in place:
  ```bash
  bash scripts/remote-mac.sh "docker exec whoeverwants-dev-<slug> sh -c 'pkill -f \"next dev\" || true; rm -rf /repo/.next && cd /repo && PYTHON_API_URL=http://localhost:8000 npm run build && nohup npx next start -p 3000 > /repo/nextjs-prod.log 2>&1 &'" / 600
  ```
- **Patch `next.config.ts` first** — as mentioned above, production mode ignores `PYTHON_API_URL`. Add an early return at the top of `getApiRewriteDestination()`: `if (process.env.PYTHON_API_URL) return process.env.PYTHON_API_URL;`
- **The next git push will clobber the build** — the webhook calls `dev-server-manager.sh upsert` which runs `git pull` (resetting `next.config.ts` patch) and starts `next dev` again. For extended testing, be prepared to re-apply the patch and rebuild after each push.

### Client-side rendering from cache pattern

- **Destination pages that are navigated to frequently should initialize state synchronously from `questionCache`.** Example (`app/g/[groupShortId]/page.tsx`, `app/group/[groupId]/page.tsx`): the `useState` initializer reads `getCachedQuestionById` / `getCachedQuestionByShortId` and uses the result directly. No loading spinner if cache hit.
- **Call `loadVotedQuestions()` exactly once** for both `votedQuestionIds` and `abstainedQuestionIds` state init. It parses localStorage each call — easy to accidentally call twice in adjacent `useState` initializers.
- **`usePageTitle` dispatches a `pageTitleChange` event** that the template listens for. On first render the template's `questionPageTitle` state is empty; if the page is the target of a view transition, the `<h1>` is missing from the initial snapshot. Fix: in `template.tsx`, initialize `questionPageTitle` synchronously by parsing the pathname and looking up the cached question's title.
