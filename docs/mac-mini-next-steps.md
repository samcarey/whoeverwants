# Mac Mini Migration — Status

**Status: complete.** Per-author dev servers now run on the Mac mini; the
droplet keeps the production API. This document is the historical record of
the deferred architectural decisions and how they were resolved.

For the current architecture, see `docs/mac-mini-setup.md` and the
"Mac Mini Dev Box" section of `CLAUDE.md`.

## Resolution summary

| Original question | Decision |
|---|---|
| §1. Hosting model — A/B/C? | **Option A** (one container per author). Each developer gets a single `whoeverwants-dev-<slug>` container running Next.js + uvicorn together via `tini`. Image: `whoeverwants-devserver:latest` (built once from `scripts/mac-mini/Dockerfile.devserver`). |
| §1. Routing — 1 or 2? | **Routing 1** (per-author Caddyfile snippet) bridged by a colima mount. `dev-server-manager.sh` writes to `/host-caddy.d/` inside cmd-api or webhook; the directory is bind-mounted from `~/devbox/caddy.d/` (which Colima auto-mounts via the default `/Users` mount). A 5-second-interval LaunchAgent (`com.devbox.caddy-watch.plist`) on the Mac polls the directory and runs `caddy reload` when content changes. No DNS-01 wildcard cert needed — per-host HTTP-01 still works fine at our scale. |
| §1. Caddy on Mac or in VM? | Stayed on Mac. Cross-boundary friction handled via the colima auto-mount of `/Users`. |
| §2. Wildcard A record | DDNS now manages both `mac-test.dev.whoeverwants.com` and the `*.dev.whoeverwants.com` wildcard in a single batched `change-resource-record-sets` call. See `scripts/mac-mini/ddns.sh`. |
| §3. GitHub webhook URL | Switched to `https://webhook.dev.whoeverwants.com/github`. The webhook container has MANAGER_CMD wired to `/opt/scripts/dev-server-manager.sh` (mounted from `~/devbox/scripts/`). |
| §4. Droplet decommission | Dev-side services (`dev-webhook` systemd unit, dev-server-manager) disabled on the droplet. Production API (`docker compose` stack at `/root/whoeverwants`) and the prod cmd-api remain. |
| §5. Caddy into VM (optional) | Deferred. Not needed — the colima `/Users` auto-mount + caddy-watch LaunchAgent gave us snippet-file flow without moving Caddy. |
| §6. Tighten DDNS IAM scope (optional) | Deferred. Still uses `AmazonRoute53FullAccess`. |

## Implementation notes

- **Why Option A over C (process-in-VM)?** Process-based would have been a smaller diff to `scripts/dev-server-manager.sh`, but per-author Docker containers give clean lifecycle, port management via Docker (not pidfiles), per-author resource isolation, and a single `docker ps` view of everything that exists. The per-author Docker volume (`whoeverwants-dev-repo-<slug>`) preserves node_modules / .venv / .next across restarts so re-upserts are fast.
- **Image build:** the `devserver-image` service in `docker-compose.yml` uses the `build-only` profile (entrypoint `/bin/true`) so it never starts as a service — it exists only to give `docker compose build devserver-image` a target. Initial build takes ~30s; subsequent rebuilds are near-instant via layer cache. Trigger a rebuild after changing the Dockerfile or entrypoint.
- **Migration application:** the droplet had a sibling `apply-migrations.sh` script that the dev-server-manager invoked. On the Mac, that logic is inlined into `dev-server-manager.sh:apply_dev_migrations` — fewer moving parts, one less file to mount. It still walks `*_up.sql` in `/repo/database/migrations`, skipping `000_*` and anything already in `_migrations`, applying via `docker exec devbox-postgres-1 psql`.
- **Eviction:** instead of reading meta files like the droplet, the Mac version reads `updated_at` from Docker container labels (set at upsert time). `MAX_DEV_SERVERS=5`.

## What's intentionally left as-is

- The droplet's `cmd-api.api.whoeverwants.com`, prod API container, prod Caddyfile, and production webhook flow (push to `main` → droplet rebuild) all stay on the droplet. None of this migrated.
- The IAM user's `AmazonRoute53FullAccess` policy. Tightening to the specific zone is documented in the original §6 but not blocking.
