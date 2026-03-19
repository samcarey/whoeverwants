# Preview Environments Plan

## Goals

1. **Production**: highly available, fast, unchanged at `whoeverwants.com`
2. **On-demand preview environments**: spun up per branch, publicly reachable, start with a copy of prod DB
3. **Claude Code web integration**: push to branch → trigger build → get a URL
4. **Easy discovery & cleanup**: list all previews, tear down individually or in bulk

---

## Architecture

### DNS & Routing

- **Production**: `whoeverwants.com` → existing setup (unchanged)
- **Previews**: `<slug>.preview.whoeverwants.com` → same droplet IP
- **Wildcard DNS**: `*.preview.whoeverwants.com` A record → `142.93.60.29`
- **Caddy**: per-subdomain TLS certs (auto-provisioned on first request), dynamic routing per preview

The `<slug>` is derived from the branch name (e.g., `claude/fix-voting-bug-abc123` → `fix-voting-bug-abc123`).

### Per-Preview Stack

Each preview gets:

| Component | Implementation | Resource Cost |
|-----------|---------------|---------------|
| Database | Separate Postgres **database** in the shared Docker Postgres container | ~5-10MB per empty clone |
| FastAPI | Separate Docker container, unique port (9001, 9002, ...) | ~50-80MB RAM |
| Next.js | Separate Node process, unique port (4001, 4002, ...) | ~100-150MB RAM |

**Why shared Postgres?** Spinning up separate Postgres containers per preview wastes RAM. One Postgres instance can host many databases cheaply. Each preview DB is created via `createdb` + `pg_dump`/`pg_restore` from production.

### Droplet Sizing

Current: 1GB RAM ($6/mo) — barely fits production alone (needed 2GB swap for builds).

**Recommended upgrade**: **4GB RAM ($24/mo)**. This comfortably runs production + 3-4 concurrent previews + has room for builds. The 2GB tier ($12/mo) works for 1-2 previews but builds may still need swap.

---

## Preview Manager

A new script on the droplet: `scripts/preview-manager.sh`. Provides these operations:

### `preview create <branch-name>`

1. `git fetch origin <branch>`
2. `git worktree add /root/previews/<slug> origin/<branch>`
3. `createdb preview_<slug>` in the shared Postgres
4. `pg_dump whoeverwants | psql preview_<slug>` (copy prod data)
5. Apply any new migrations from the branch's `database/migrations/` that aren't in prod
6. Build the FastAPI image: `docker build -t preview-api-<slug> /root/previews/<slug>/server`
7. Start FastAPI container: `docker run -d --name preview-api-<slug> --network whoeverwants_default -e DATABASE_URL=...preview_<slug> -p <api-port>:8000`
8. Build Next.js: `cd /root/previews/<slug> && npm ci && npm run build`
9. Start Next.js: `NODE_ENV=production PORT=<web-port> node .next/standalone/server.js`  (managed as a systemd transient unit or backgrounded with PID tracking)
10. Regenerate Caddyfile with new preview block, `caddy reload`
11. Write metadata to `/root/previews/<slug>/.preview-meta.json`: `{branch, slug, created_at, api_port, web_port, creator}`

### `preview list`

Reads all `.preview-meta.json` files, outputs:

```
SLUG                    BRANCH                           CREATED              URL
fix-voting-abc123       claude/fix-voting-bug-abc123     2026-03-19 14:00     https://fix-voting-abc123.preview.whoeverwants.com
new-feature-def456      claude/new-feature-def456        2026-03-19 15:30     https://new-feature-def456.preview.whoeverwants.com
```

### `preview destroy <slug>`

1. Stop & remove FastAPI container
2. Kill Next.js process (via saved PID or systemd stop)
3. `dropdb preview_<slug>`
4. Regenerate Caddyfile without this preview, `caddy reload`
5. `git worktree remove /root/previews/<slug>`

### `preview destroy-all`

Iterates all previews and destroys each.

---

## Caddy Configuration

Template-based Caddyfile regeneration. Each `create`/`destroy` rebuilds the file from:

**Base template** (always present):
```
whoeverwants.com {
  handle /api/polls*  { reverse_proxy 127.0.0.1:8000 }
  handle /health      { reverse_proxy 127.0.0.1:8000 }
  handle              { reverse_proxy 127.0.0.1:3000 }
}

<sslip-domain> {
  reverse_proxy 127.0.0.1:9090
}
```

**Per-preview blocks** (generated from `.preview-meta.json`):
```
fix-voting-abc123.preview.whoeverwants.com {
  handle /api/polls*  { reverse_proxy 127.0.0.1:9001 }
  handle              { reverse_proxy 127.0.0.1:4001 }
}
```

No wildcard TLS cert needed — Caddy auto-provisions individual Let's Encrypt certs per subdomain via HTTP challenge. Only downside: ~5s delay on first HTTPS request to a new preview while the cert is issued.

---

## Port Allocation

Derive ports from a counter file `/root/previews/.next-port` (starts at 1):

| Preview # | FastAPI Port | Next.js Port |
|-----------|-------------|-------------|
| 1         | 9001        | 4001        |
| 2         | 9002        | 4002        |
| 3         | 9003        | 4003        |

On destroy, scan existing previews to find the lowest available slot for reuse.

---

## Database Cloning

```bash
# Create database for preview
docker exec whoeverwants-db-1 createdb -U whoeverwants "preview_${SLUG}"

# Copy production data
docker exec whoeverwants-db-1 bash -c \
  "pg_dump -U whoeverwants whoeverwants | psql -U whoeverwants preview_${SLUG}"

# Apply new migrations from the branch (ones not yet in prod)
for migration in /root/previews/${SLUG}/database/migrations/*_up.sql; do
  name=$(basename "$migration")
  # Check if already applied (exists in _migrations table of the cloned DB)
  exists=$(docker exec whoeverwants-db-1 psql -U whoeverwants -d "preview_${SLUG}" \
    -tAc "SELECT 1 FROM _migrations WHERE name='$name'" 2>/dev/null)
  if [ -z "$exists" ]; then
    docker exec -i whoeverwants-db-1 psql -U whoeverwants -d "preview_${SLUG}" < "$migration"
    docker exec whoeverwants-db-1 psql -U whoeverwants -d "preview_${SLUG}" \
      -c "INSERT INTO _migrations (name) VALUES ('$name')"
  fi
done
```

---

## Claude Code Web Session Workflow

### Option A: Manual trigger (recommended to start)

A Claude Code session pushes its branch, then triggers a preview:

```bash
# Push the branch
git push -u origin claude/my-feature-xyz

# Create preview on droplet
bash scripts/remote.sh "bash /root/whoeverwants/scripts/preview-manager.sh create claude/my-feature-xyz" /root 300
```

The script outputs:
```
✓ Preview ready: https://my-feature-xyz.preview.whoeverwants.com
```

### Option B: Convenience wrapper

`scripts/deploy-preview.sh` (runs locally in Claude Code sandbox):

```bash
#!/bin/bash
BRANCH=$(git branch --show-current)
echo "Pushing $BRANCH and deploying preview..."
git push -u origin "$BRANCH"
bash scripts/remote.sh \
  "bash /root/whoeverwants/scripts/preview-manager.sh create $BRANCH" /root 300
```

### Option C: Add CLAUDE.md instruction

Add to CLAUDE.md:
> When you want the user to test your changes in a browser, push your branch and run `bash scripts/deploy-preview.sh` to create a preview environment. Share the resulting URL with the user.

---

## Auto-Cleanup

Add a cron job to destroy previews older than N days:

```bash
# /etc/cron.daily/cleanup-previews
#!/bin/bash
DAYS=7
for meta in /root/previews/*/.preview-meta.json; do
  created=$(jq -r .created_at "$meta")
  age_days=$(( ($(date +%s) - $(date -d "$created" +%s)) / 86400 ))
  if [ "$age_days" -gt "$DAYS" ]; then
    slug=$(jq -r .slug "$meta")
    bash /root/whoeverwants/scripts/preview-manager.sh destroy "$slug"
  fi
done
```

---

## Production Improvements

For "highly available and fast" (orthogonal to previews):

| Improvement | Effort | Impact |
|-------------|--------|--------|
| **Cloudflare free tier** in front of Caddy | Low | CDN caching for static assets, DDoS protection, faster global access |
| **Zero-downtime deploys** | Medium | Build new standalone, swap systemd unit, no dropped requests |
| **DigitalOcean weekly snapshots** | Low ($1/mo) | Full-droplet backup beyond daily pg_dump |
| **Uptime monitoring** (UptimeRobot free) | Low | External alerting if site goes down |

---

## Implementation Order

1. **Upgrade droplet** to 4GB RAM
2. **Set up wildcard DNS**: `*.preview.whoeverwants.com` A record → droplet IP
3. **Write `preview-manager.sh`**: create / list / destroy / destroy-all
4. **Write Caddyfile template generator**: regenerates config with preview blocks
5. **Write `deploy-preview.sh`**: local convenience wrapper
6. **Test end-to-end**: create preview from a test branch, verify full stack works
7. **Add auto-cleanup cron**: destroy previews older than 7 days
8. **Update CLAUDE.md**: document the workflow
9. **Update `provision-droplet.sh`**: include preview infrastructure in fresh setup
10. **Optional**: Cloudflare CDN, uptime monitoring

---

## Cost Summary

| Item | Cost |
|------|------|
| Droplet upgrade to 4GB | +$18/mo ($24 total) |
| Wildcard DNS | Free (A record) |
| Per-preview SSL certs | Free (Let's Encrypt via Caddy) |
| Storage per preview | ~200-500MB (DB clone + build artifacts) |
| Auto-cleanup | Free (cron job) |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| RAM exhaustion with many previews | Hard limit of 4 concurrent previews. Auto-destroy oldest if limit hit. |
| Disk fills with build artifacts | Auto-cleanup cron (7-day TTL). Each preview ~200-500MB. Monitor with health check. |
| Build OOM during Next.js compile | 4GB droplet + 2GB swap = 6GB total. Serialize builds (one at a time). |
| Stale previews accumulate | `preview list` for discovery + cron auto-cleanup + `destroy-all` for manual sweep. |
| Caddy reload briefly drops connections | Caddy does graceful reloads — no downtime. |
| Preview DB leaks production data | Previews are publicly reachable but obscure URLs. Acceptable for a polling app with no sensitive data. Add basic auth if needed later. |
