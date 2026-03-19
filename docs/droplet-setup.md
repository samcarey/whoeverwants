# Droplet Setup Guide

This document describes how to provision a new DigitalOcean droplet for WhoeverWants from scratch. Following these steps produces an identical server to the current production droplet.

**Last verified**: 2026-03-19

---

## 1. Create Droplet

Create a DigitalOcean droplet with these specs:

| Setting | Value |
|---------|-------|
| Image | Ubuntu 24.04 LTS |
| Plan | Basic $6/mo (1 vCPU, 1GB RAM, 24GB SSD) |
| Region | Any (current: NYC) |
| Auth | SSH key or password |
| Hostname | `whoeverwants` |

Note the IP address (e.g., `157.245.129.162`).

---

## 2. Provision the Server

You can either run the automated script or follow the manual steps below.

### Automated Setup

From the development environment (where you have this repo checked out):

```bash
# Set the droplet IP and desired API token
export DROPLET_IP="157.245.129.162"
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

If you prefer to set up manually, SSH into the droplet and follow these steps:

#### 2a. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

#### 2b. Install Caddy

```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
```

#### 2c. Set Up Command Execution API

Create `/opt/cmd-api.py`:

```python
from http.server import HTTPServer, BaseHTTPRequestHandler
import json, subprocess, os

SECRET = os.environ.get("API_SECRET", "")

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {SECRET}":
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"forbidden")
            return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        cmd = body.get("cmd", "echo no command")
        cwd = body.get("cwd", "/root")
        timeout = body.get("timeout", 120)
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, cwd=cwd)
            resp = {"exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
        except subprocess.TimeoutExpired:
            resp = {"exit_code": -1, "stdout": "", "stderr": "timeout"}
        except Exception as e:
            resp = {"exit_code": -1, "stdout": "", "stderr": str(e)}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(resp).encode())
    def log_message(self, format, *args):
        pass

HTTPServer(("127.0.0.1", 9090), Handler).serve_forever()
```

Create `/etc/systemd/system/cmd-api.service`:

```ini
[Unit]
Description=Command Runner API
After=network.target
[Service]
Type=simple
Environment=API_SECRET=<YOUR_TOKEN_HERE>
ExecStart=/usr/bin/python3 /opt/cmd-api.py
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable --now cmd-api
```

#### 2d. Add Swap (Required for 1GB droplets)

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

#### 2e. Install Node.js

Next.js runs natively (not in Docker) to avoid OOM during build on 1GB droplets.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

#### 2f. Configure Caddy

Write `/etc/caddy/Caddyfile` (replace `DROPLET_IP` with actual IP, dots replaced by dashes):

```
<DROPLET_IP_DASHED>.sslip.io {
	reverse_proxy 127.0.0.1:9090
}

whoeverwants.com {
	handle /api/polls {
		reverse_proxy 127.0.0.1:8000
	}
	handle /api/polls/* {
		reverse_proxy 127.0.0.1:8000
	}
	handle /health {
		reverse_proxy 127.0.0.1:8000
	}
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
```

Restart Caddy:

```bash
systemctl restart caddy
```

#### 2g. Clone Repo and Start Backend Services

The Python API uses **uv** for dependency management inside its Docker container. No manual uv installation is needed on the droplet — it's installed automatically in the Dockerfile. Dependencies are defined in `server/pyproject.toml` and locked in `server/uv.lock`.

```bash
git clone https://github.com/samcarey/whoeverwants.git /root/whoeverwants
cd /root/whoeverwants
docker compose up -d --build
```

#### 2h. Build and Start Next.js Frontend

```bash
cd /root/whoeverwants
npm ci
NEXT_OUTPUT=standalone NODE_ENV=production npm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
```

Create `/etc/systemd/system/whoeverwants-web.service`:

```ini
[Unit]
Description=WhoeverWants Next.js Frontend
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=/root/whoeverwants/.next/standalone
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable --now whoeverwants-web
```

#### 2f. Apply Database Migrations

```bash
cd /root/whoeverwants

# Create tracking table
docker exec -i whoeverwants-db-1 psql -U whoeverwants -c "
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
"

# Apply all migrations
for f in database/migrations/*_up.sql; do
  filename=$(basename "$f")
  [ "$filename" = "000_populate_tracking_table_up.sql" ] && continue
  already=$(docker exec -i whoeverwants-db-1 psql -U whoeverwants -Atq \
    -c "SELECT COUNT(*) FROM _migrations WHERE filename = '$filename'")
  [ "$already" -gt 0 ] && continue
  echo "Applying: $filename"
  docker exec -i whoeverwants-db-1 psql -U whoeverwants -q < "$f"
  docker exec -i whoeverwants-db-1 psql -U whoeverwants -q \
    -c "INSERT INTO _migrations (filename) VALUES ('$filename')"
done
```

---

## 3. Verify

```bash
# From local environment, using scripts/remote.sh:
bash scripts/remote.sh "curl -s http://localhost:8000/health"
# Expected: {"status":"ok","database":"connected"}

bash scripts/remote.sh "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/"
# Expected: 200

bash scripts/remote.sh "docker compose ps" /root/whoeverwants
# Expected: db and api containers running

bash scripts/remote.sh "systemctl status whoeverwants-web --no-pager"
# Expected: active (running)

bash scripts/remote.sh "docker exec -i whoeverwants-db-1 psql -U whoeverwants -c '\dt'"
# Expected: _migrations, polls, ranked_choice_rounds, votes tables
```

---

## Architecture Diagram

```
Internet
  │
  ├── whoeverwants.com:443 ──► Caddy ──┬── /api/polls* ──► localhost:8000 ──► FastAPI (Docker: api)
  │                                     │                                        │
  │                                     └── /* ──────────► localhost:3000 ──► Next.js (systemd)
  │                                                                              │
  ├── <ip>.sslip.io:443 ────► Caddy ──► localhost:9090 ──► cmd-api.py (systemd)
  │                                                            │
  │                                                     PostgreSQL (Docker: db)
  │                                                     localhost:5432
  └── :22 ──► SSH (backup access)
```

### Services Summary

| Service | How it runs | Port | Purpose |
|---------|------------|------|---------|
| Caddy | systemd (`caddy.service`) | 80, 443 | HTTPS reverse proxy, auto-TLS via Let's Encrypt |
| cmd-api.py | systemd (`cmd-api.service`) | 9090 (localhost) | Remote command execution for Claude Code |
| Next.js | systemd (`whoeverwants-web.service`) | 3000 (localhost) | Frontend (standalone build) |
| FastAPI | Docker Compose (`api`) | 8000 (localhost) | Application API |
| PostgreSQL | Docker Compose (`db`) | 5432 (localhost) | Database |

### Key Files on Droplet

| Path | Description |
|------|-------------|
| `/opt/cmd-api.py` | Remote command execution API (stdlib Python) |
| `/etc/systemd/system/cmd-api.service` | Systemd unit for cmd-api |
| `/etc/systemd/system/whoeverwants-web.service` | Systemd unit for Next.js frontend |
| `/etc/caddy/Caddyfile` | Caddy reverse proxy config |
| `/swapfile` | 2GB swap file (required for Node.js builds on 1GB droplet) |
| `/root/whoeverwants/` | Repository clone |
| `/root/whoeverwants/.next/standalone/` | Next.js production build |
| `/root/whoeverwants/docker-compose.yml` | Docker Compose config (db + api only) |
| `/root/whoeverwants/server/` | FastAPI application source (uses uv for dependency management) |
| `/root/whoeverwants/database/migrations/` | SQL migration files |

---

## DNS Requirements

For `whoeverwants.com` to work, the domain's DNS must have an A record pointing to the droplet's IP address. The sslip.io subdomain (`<ip-dashed>.sslip.io`) works automatically with no DNS configuration.

---

## Security Notes

- The command API runs as root with `shell=True` — full system access. Protected by bearer token + TLS only.
- All services except Caddy (ports 80/443) and SSH (port 22) bind to localhost only.
- The API token should be a strong random string (32+ bytes, URL-safe base64).
- Caddy handles TLS certificate provisioning and renewal automatically via Let's Encrypt.

---

## Troubleshooting

```bash
# Check all services
bash scripts/remote.sh "systemctl status cmd-api caddy docker"

# View API logs
bash scripts/remote.sh "docker compose logs --tail 50 api" /root/whoeverwants

# View database logs
bash scripts/remote.sh "docker compose logs --tail 50 db" /root/whoeverwants

# Restart everything
bash scripts/remote.sh "systemctl restart caddy cmd-api && docker compose restart" /root/whoeverwants

# Check disk space
bash scripts/remote.sh "df -h /"

# Check memory
bash scripts/remote.sh "free -h"
```
