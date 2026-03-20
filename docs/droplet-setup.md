# Droplet Setup Guide

This document describes how to provision a new DigitalOcean droplet for WhoeverWants from scratch. The droplet serves only the **API** (Python/FastAPI + PostgreSQL). The **frontend** is hosted on Vercel.

**Last verified**: 2026-03-19

---

## 1. Create Droplet

Create a DigitalOcean droplet with these specs:

| Setting | Value |
|---------|-------|
| Image | Ubuntu 24.04 LTS |
| Plan | Basic $6/mo (1 vCPU, 1GB RAM, 24GB SSD) |
| Region | Any (current: NYC) |
| Auth | **SSH key only** (no password auth) |
| Hostname | `whoeverwants` |

Note the IP address (e.g., `142.93.60.29`).

---

## 2. DNS Requirements

| Record | Type | Value | Purpose |
|--------|------|-------|---------|
| `api.whoeverwants.com` | A | `<droplet IP>` | Production API |
| `*.api.whoeverwants.com` | A | `<droplet IP>` | Preview API environments |
| `whoeverwants.com` | CNAME | `cname.vercel-dns.com` (or Vercel IP) | Production frontend |

The wildcard `*.api.whoeverwants.com` record enables per-branch preview API instances (e.g., `fix-voting-abc123.api.whoeverwants.com`).

The sslip.io subdomain (`<ip-dashed>.sslip.io`) works automatically with no DNS configuration.

---

## 3. Provision the Server

### Automated Setup

From the development environment (where you have this repo checked out):

```bash
# Set the droplet IP and desired API token
export DROPLET_IP="142.93.60.29"
export NEW_API_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"

# SSH into the droplet and run the provisioning script
ssh root@$DROPLET_IP 'bash -s' < scripts/provision-droplet.sh "$NEW_API_TOKEN"
```

After provisioning completes, set the environment variables for `scripts/remote.sh`:

```bash
export DROPLET_API_URL="https://${DROPLET_IP//./-}.sslip.io"
export DROPLET_API_TOKEN="$NEW_API_TOKEN"
```

### Manual Steps

If you prefer to set up manually, SSH into the droplet and follow the steps in `scripts/provision-droplet.sh` (11 steps).

---

## Architecture Diagram

```
Internet
  │
  ├── whoeverwants.com ──────────► Vercel (Next.js frontend, CDN, auto-TLS)
  │                                   │
  │                                   └── /api/polls* calls ──► api.whoeverwants.com
  │
  ├── api.whoeverwants.com:443 ──► Caddy ──► localhost:8000 ──► FastAPI (Docker: api)
  │                                              │ rate limiting (120 GET, 30 POST per IP/min)
  │
  ├── *.api.whoeverwants.com:443 ► Caddy ──► localhost:800X ──► Preview FastAPI containers
  │                                              │ per-branch preview environments
  │
  ├── <ip>.sslip.io:443 ────────► Caddy ──► localhost:9090 ──► cmd-api.py (systemd)
  │
  │                              PostgreSQL (Docker: db)
  │                              localhost:5432
  │                                ├── whoeverwants (production database)
  │                                └── preview_* (per-branch preview databases)
  │                                │
  │                              pg_dump backup ──► /var/backups/whoeverwants/ (14-day retention)
  │
  └── :22 ──► SSH (backup access)

Cron jobs:
  - 3:00 AM daily  ──► backup-db.sh (pg_dump + rotate)
  - Every 5 min    ──► health-check.sh (service checks + auto-recovery)
  - 4:00 AM daily  ──► preview-manager.sh cleanup (destroy previews >7 days old)
```

### Services Summary

| Service | How it runs | Port | Purpose |
|---------|------------|------|---------|
| Caddy | systemd (`caddy.service`) | 80, 443 | HTTPS reverse proxy, auto-TLS via Let's Encrypt |
| cmd-api.py | systemd (`cmd-api.service`) | 9090 (localhost) | Remote command execution for Claude Code |
| FastAPI | Docker Compose (`api`) | 8000 (localhost) | Application API (with rate limiting) |
| PostgreSQL | Docker Compose (`db`) | 5432 (localhost) | Database |

### Cron Jobs

| Schedule | Script | Purpose |
|----------|--------|---------|
| `0 3 * * *` | `scripts/backup-db.sh` | Daily DB backup (pg_dump, gzip, 14-day retention) |
| `0 4 * * *` | `scripts/preview-manager.sh cleanup` | Destroy preview environments older than 7 days |
| `*/5 * * * *` | `scripts/health-check.sh` | Service health checks with auto-recovery |

### Key Files on Droplet

| Path | Description |
|------|-------------|
| `/opt/cmd-api.py` | Remote command execution API (stdlib Python) |
| `/etc/systemd/system/cmd-api.service` | Systemd unit for cmd-api |
| `/etc/caddy/Caddyfile` | Caddy reverse proxy config |
| `/etc/logrotate.d/whoeverwants` | Log rotation config (14-day retention) |
| `/etc/systemd/journald.conf.d/whoeverwants.conf` | Journald size limits (500MB max) |
| `/swapfile` | 2GB swap file |
| `/var/backups/whoeverwants/` | Database backup directory |
| `/var/log/whoeverwants-backup.log` | Backup script log |
| `/var/log/whoeverwants-health.log` | Health check log |
| `/root/whoeverwants/` | Repository clone |
| `/root/whoeverwants/docker-compose.yml` | Docker Compose config (db + api only) |
| `/root/whoeverwants/server/` | FastAPI application source (uses uv for dependency management) |
| `/root/whoeverwants/database/migrations/` | SQL migration files |
| `/root/previews/` | Git worktrees for preview environments |
| `/etc/caddy/previews/` | Per-preview Caddy config fragments |

---

## Preview Environments

Per-branch preview environments provide isolated API + database instances for testing.

### How It Works

- Each preview gets a separate Postgres database and FastAPI Docker container
- Caddy routes `<slug>.api.whoeverwants.com` to the preview's container
- Vercel automatically deploys a preview frontend for each branch push
- The frontend derives the API URL from the branch name (convention-based)

### Managing Previews

```bash
# Create a preview for a branch
bash scripts/remote.sh "bash /root/whoeverwants/scripts/preview-manager.sh create claude/my-feature-xyz" /root 300

# List active previews
bash scripts/remote.sh "bash /root/whoeverwants/scripts/preview-manager.sh list"

# Destroy a specific preview
bash scripts/remote.sh "bash /root/whoeverwants/scripts/preview-manager.sh destroy my-feature-xyz"

# Destroy all previews
bash scripts/remote.sh "bash /root/whoeverwants/scripts/preview-manager.sh destroy-all"
```

### Convenience Wrapper

From the development environment:
```bash
# Deploy preview for current branch (pushes to GitHub + creates API on droplet)
bash scripts/deploy-preview.sh
```

### Resource Usage

Each preview uses ~70MB RAM (FastAPI container ~60MB + DB overhead ~10MB). The 1GB droplet can comfortably run production + 4-5 previews. Previews older than 7 days are automatically cleaned up.

---

## 4. Verify

```bash
# From local environment, using scripts/remote.sh:
bash scripts/remote.sh "curl -s http://localhost:8000/health"
# Expected: {"status":"ok","database":"connected"}

bash scripts/remote.sh "docker compose ps" /root/whoeverwants
# Expected: db and api containers running

bash scripts/remote.sh "docker exec -i whoeverwants-db-1 psql -U whoeverwants -c '\dt'"
# Expected: _migrations, polls, ranked_choice_rounds, votes tables

bash scripts/remote.sh "crontab -l"
# Expected: backup-db.sh (daily 3AM) and health-check.sh (every 5min)

bash scripts/remote.sh "ufw status"
# Expected: 22, 80, 443 allowed — everything else denied
```

---

## Security Notes

- **Firewall**: UFW enabled — only ports 22 (SSH), 80 (HTTP), 443 (HTTPS) are open.
- **SSH**: Password authentication disabled, root login only via SSH key.
- **cmd-api**: Protected by bearer token + TLS + rate limiting (60 req/min per IP). All requests logged.
- **Token handling**: The API token must NEVER be committed to git. Store only in environment variables.
- All services except Caddy (ports 80/443) and SSH (port 22) bind to localhost only.
- Caddy handles TLS provisioning and renewal via Let's Encrypt.
- FastAPI includes rate limiting: 120 reads/min and 30 writes/min per IP.
- CORS restricted to `https://whoeverwants.com` and `http://localhost:3000`.

---

## Rate Limiting

### FastAPI (Application API)

| Operation | Limit | Window |
|-----------|-------|--------|
| GET requests | 120/IP | 1 minute |
| POST/PUT/DELETE requests | 30/IP | 1 minute |

### cmd-api (Command Execution API)

| Operation | Limit | Window |
|-----------|-------|--------|
| All POST requests | 60/IP | 1 minute |

---

## Troubleshooting

```bash
# Check all services
bash scripts/remote.sh "systemctl status cmd-api caddy docker"

# View API logs
bash scripts/remote.sh "docker compose logs --tail 50 api" /root/whoeverwants

# View database logs
bash scripts/remote.sh "docker compose logs --tail 50 db" /root/whoeverwants

# View health check log
bash scripts/remote.sh "tail -20 /var/log/whoeverwants-health.log"

# View backup log
bash scripts/remote.sh "tail -20 /var/log/whoeverwants-backup.log"

# List backups
bash scripts/remote.sh "ls -lh /var/backups/whoeverwants/"

# Restart everything
bash scripts/remote.sh "systemctl restart caddy cmd-api && docker compose restart" /root/whoeverwants

# Check disk/memory
bash scripts/remote.sh "df -h / && free -h"
```
