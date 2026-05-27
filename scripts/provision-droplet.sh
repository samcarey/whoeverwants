#!/bin/bash
# Provision a fresh Ubuntu 24.04 droplet for WhoeverWants.
#
# This script is designed to run ON the droplet itself (e.g., via SSH or paste).
# It installs all dependencies, sets up the command API, Caddy, Docker,
# clones the repo, starts services, applies database migrations, and configures
# production hardening (log rotation, DB backups, health checks).
#
# Usage:
#   ssh root@<DROPLET_IP> 'bash -s' < scripts/provision-droplet.sh <API_TOKEN>
#   # or, if already on the droplet:
#   bash provision-droplet.sh <API_TOKEN>
#
# After running, set these in your local environment:
#   export DROPLET_API_URL=https://<IP-DASHED>.sslip.io
#   export DROPLET_API_TOKEN=<API_TOKEN>

set -euo pipefail

API_TOKEN="${1:?Usage: provision-droplet.sh <API_TOKEN>}"
DROPLET_IP=$(hostname -I | awk '{print $1}')
DROPLET_IP_DASHED=$(echo "$DROPLET_IP" | tr '.' '-')

# DROPLET_LABEL selects between deployment tiers. Same provision script for both:
#   ""       (default) → production: api.whoeverwants.com, hooks.api.whoeverwants.com
#   "latest"           → pre-prod canary: api.latest.whoeverwants.com, hooks.api.latest.whoeverwants.com
# Both tiers run identical software; only the public hostnames Caddy serves differ.
DROPLET_LABEL="${DROPLET_LABEL:-}"
case "$DROPLET_LABEL" in
  "")
    API_DOMAIN="api.whoeverwants.com"
    HOOKS_DOMAIN="hooks.api.whoeverwants.com"
    HOSTNAME_VALUE="whoeverwants"
    ;;
  latest)
    API_DOMAIN="api.latest.whoeverwants.com"
    HOOKS_DOMAIN="hooks.api.latest.whoeverwants.com"
    HOSTNAME_VALUE="latest"
    ;;
  *)
    echo "ERROR: DROPLET_LABEL='$DROPLET_LABEL' is not recognized (use '' or 'latest')" >&2
    exit 1
    ;;
esac

echo "=== Provisioning WhoeverWants droplet ==="
echo "Label: ${DROPLET_LABEL:-(prod)}"
echo "IP: $DROPLET_IP"
echo "sslip.io domain: ${DROPLET_IP_DASHED}.sslip.io"
echo "API domain: $API_DOMAIN"
echo "Hooks domain: $HOOKS_DOMAIN"
echo ""

# Set hostname so console / logs make the tier obvious.
hostnamectl set-hostname "$HOSTNAME_VALUE" || true

# Persist the deployment label so dev-webhook.py + other tooling can branch on it.
echo "${DROPLET_LABEL}" > /etc/droplet-label
chmod 644 /etc/droplet-label

# ── 1. System updates ────────────────────────────────────────────────
echo "=== 1a/13 System updates ==="
apt-get update -qq
# Skip upgrade when there's nothing to do — re-running the provision script on
# an already-set-up droplet is otherwise dominated by a no-op apt-get upgrade.
if apt list --upgradable 2>/dev/null | grep -q upgradable; then
  apt-get upgrade -y -qq
else
  echo "System packages already up to date"
fi

# ── 1b. Firewall (UFW) ───────────────────────────────────────────────
echo "=== 1b/13 Configuring firewall ==="
apt-get install -y -qq ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Caddy)
ufw allow 443/tcp   # HTTPS (Caddy)
ufw --force enable
echo "Firewall enabled:"
ufw status

# ── 1c. SSH hardening ────────────────────────────────────────────────
echo "=== 1c/13 Hardening SSH ==="
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# ── 2. Install Docker ────────────────────────────────────────────────
echo "=== 2/13 Installing Docker ==="
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
else
  echo "Docker already installed: $(docker --version)"
fi

# ── 3. Install Caddy ─────────────────────────────────────────────────
echo "=== 3/13 Installing Caddy ==="
if ! command -v caddy &>/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y caddy
else
  echo "Caddy already installed: $(caddy version)"
fi

# ── 4. Command execution API ─────────────────────────────────────────
echo "=== 4/13 Setting up command execution API (with logging + rate limiting) ==="
cat > /opt/cmd-api.py <<'PYEOF'
from http.server import HTTPServer, BaseHTTPRequestHandler
from collections import defaultdict
import json, subprocess, os, datetime, time, sys

SECRET = os.environ.get("API_SECRET", "")

# Rate limiting: max 60 requests/minute per IP
REQUEST_LOG = defaultdict(list)
MAX_REQUESTS_PER_MINUTE = 60

def _check_rate_limit(ip):
    now = time.time()
    REQUEST_LOG[ip] = [t for t in REQUEST_LOG[ip] if now - t < 60]
    if len(REQUEST_LOG[ip]) >= MAX_REQUESTS_PER_MINUTE:
        return True
    REQUEST_LOG[ip].append(now)
    return False

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        timestamp = datetime.datetime.now().isoformat()
        client_ip = self.client_address[0]

        # Rate limit check
        if _check_rate_limit(client_ip):
            print(f"[{timestamp}] RATE LIMITED {client_ip}", flush=True)
            self.send_response(429)
            self.send_header("Retry-After", "60")
            self.end_headers()
            self.wfile.write(b"rate limited")
            return

        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {SECRET}":
            print(f"[{timestamp}] AUTH FAILURE from {client_ip}", flush=True)
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"forbidden")
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        cmd = body.get("cmd", "echo no command")
        cwd = body.get("cwd", "/root")
        timeout = body.get("timeout", 120)
        print(f"[{timestamp}] {client_ip} CMD: {cmd[:200]}", flush=True)
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
        timestamp = datetime.datetime.now().isoformat()
        client_ip = self.client_address[0]
        print(f"[{timestamp}] {client_ip} {format % args}", flush=True)

HTTPServer(("127.0.0.1", 9090), Handler).serve_forever()
PYEOF

cat > /etc/systemd/system/cmd-api.service <<EOF
[Unit]
Description=Command Runner API
After=network.target
[Service]
Type=simple
Environment=API_SECRET=${API_TOKEN}
ExecStart=/usr/bin/python3 /opt/cmd-api.py
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now cmd-api

# ── 5. Install Node.js (for per-user dev servers) ────────────────────
echo "=== 5a/15 Installing Node.js ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  echo "Node.js installed: $(node --version)"
else
  echo "Node.js already installed: $(node --version)"
fi

# ── 5b. Install uv (Python package manager, needed by dev servers) ──
echo "=== 5b/15 Installing uv ==="
if ! command -v /root/.local/bin/uv &>/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  echo "uv installed: $(/root/.local/bin/uv --version)"
else
  echo "uv already installed: $(/root/.local/bin/uv --version)"
fi

# ── 6. Add swap ──────────────────────────────────────────────────────
echo "=== 6/15 Configuring swap ==="
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "2GB swap created (1/2)"
else
  echo "Swapfile 1 already configured"
fi
if [ ! -f /swapfile2 ]; then
  fallocate -l 2G /swapfile2
  chmod 600 /swapfile2
  mkswap /swapfile2
  swapon /swapfile2
  echo '/swapfile2 none swap sw 0 0' >> /etc/fstab
  echo "2GB swap created (2/2, total 4GB)"
else
  echo "Swapfile 2 already configured"
fi

# ── 7. Configure Caddy ───────────────────────────────────────────────
# Frontend is hosted on Vercel. Droplet serves the API + dev servers.
echo "=== 7/15 Configuring Caddy ==="
mkdir -p /etc/caddy/previews /etc/caddy/dev-servers
cat > /etc/caddy/Caddyfile <<EOF
${DROPLET_IP_DASHED}.sslip.io {
	reverse_proxy 127.0.0.1:9090
}

${API_DOMAIN} {
	# CORS lives on the FastAPI side (Starlette CORSMiddleware with
	# allow_origins=["*"], allow_headers=["*"], expose_headers=["X-Browser-Id"],
	# and the default Access-Control-Max-Age: 600 preflight cache).
	# Intercepting OPTIONS at Caddy with a hand-maintained allow list
	# silently desyncs from FastAPI (X-Browser-Id was missing here for
	# weeks, blocking the cross-origin browser→API switch). Let FastAPI
	# own CORS end-to-end — the localhost reverse_proxy is fast enough.
	reverse_proxy 127.0.0.1:8000
}

${HOOKS_DOMAIN} {
	reverse_proxy 127.0.0.1:9091
}

import /etc/caddy/previews/*.caddy
import /etc/caddy/dev-servers/*.caddy
EOF

systemctl restart caddy

# ── 8. Clone repo and start Docker services ──────────────────────────
# Note: The FastAPI container uses uv for Python dependency management.
# uv is installed inside the Docker image (see server/Dockerfile).
# Dependencies are defined in server/pyproject.toml and locked in server/uv.lock.
# No manual Python package installation is needed on the host.
echo "=== 8/15 Cloning repo and starting Docker services ==="
if [ ! -d /root/whoeverwants ]; then
  git clone https://github.com/samcarey/whoeverwants.git /root/whoeverwants
else
  echo "Repo already exists, pulling latest"
  cd /root/whoeverwants && git pull
fi

cd /root/whoeverwants

# docker-compose.yml's `api` service references `.env.api` via env_file. This
# file is gitignored (it holds external-API secrets: TMDB / RAWG / Yelp keys)
# so a fresh clone doesn't include it. Create an empty placeholder so `docker
# compose up` doesn't bail out with "env file not found"; populate the real
# keys via `scripts/remote*.sh` afterward.
if [ ! -f .env.api ]; then
  cat > .env.api <<'ENVEOF'
# Place external-API secrets here, one KEY=value per line. See CLAUDE.md.
# This file is gitignored; populate via scripts/remote*.sh after provisioning.
#
# REQUIRED for transactional email (sign-in magic links + recovery-email
# confirmation links). Without RESEND_API_KEY, send_email() silently falls
# back to logging the link to stdout and the FE shows "This server isn't
# configured to send real emails" — i.e. no email is ever delivered.
#   RESEND_API_KEY=re_...                          # Resend send-only key
#   RESEND_FROM_EMAIL=noreply@contact.whoeverwants.com   # on a Resend-verified domain
# After editing this file, reload env with: docker compose up -d --force-recreate api
ENVEOF
  chmod 600 .env.api
  echo "Created placeholder .env.api (no API keys)."
fi

docker compose up -d --build

# Wait for database to be ready
echo "Waiting for database..."
for i in $(seq 1 30); do
  if docker exec whoeverwants-db-1 pg_isready -U whoeverwants &>/dev/null; then
    echo "Database ready"
    break
  fi
  sleep 1
done

# ── 9. Apply database migrations ─────────────────────────────────────
echo "=== 9/15 Applying database migrations ==="

docker exec -i whoeverwants-db-1 psql -U whoeverwants -q <<'SQL'
CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
SQL

applied=0
for f in database/migrations/*_up.sql; do
  filename=$(basename "$f")
  [ "$filename" = "000_populate_tracking_table_up.sql" ] && continue
  already=$(docker exec -i whoeverwants-db-1 psql -U whoeverwants -Atq \
    -c "SELECT COUNT(*) FROM _migrations WHERE filename = '$filename'")
  [ "$already" -gt 0 ] && continue
  echo "  Applying: $filename"
  docker exec -i whoeverwants-db-1 psql -U whoeverwants -q < "$f" 2>&1 || true
  docker exec -i whoeverwants-db-1 psql -U whoeverwants -q \
    -c "INSERT INTO _migrations (filename) VALUES ('$filename') ON CONFLICT DO NOTHING"
  applied=$((applied + 1))
done
echo "Applied $applied migrations"

# ── 10. Production hardening ─────────────────────────────────────────
echo "=== 10/15 Production hardening (logs, backups, health checks) ==="

# --- Log rotation ---
cat > /etc/logrotate.d/whoeverwants <<'EOF'
/var/log/whoeverwants-*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 root root
}
EOF

# Also configure journald max size for systemd service logs
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/whoeverwants.conf <<'EOF'
[Journal]
SystemMaxUse=500M
MaxRetentionSec=30day
EOF
systemctl restart systemd-journald 2>/dev/null || true

# --- Database backups (daily at 3 AM) ---
chmod +x /root/whoeverwants/scripts/backup-db.sh
mkdir -p /var/backups/whoeverwants
(crontab -l 2>/dev/null | grep -v 'backup-db.sh' || true; \
 echo "0 3 * * * /root/whoeverwants/scripts/backup-db.sh >> /var/log/whoeverwants-backup.log 2>&1") | crontab -

# --- Health checks (every 5 minutes) ---
chmod +x /root/whoeverwants/scripts/health-check.sh
(crontab -l 2>/dev/null | grep -v 'health-check.sh' || true; \
 echo "*/5 * * * * /root/whoeverwants/scripts/health-check.sh >> /var/log/whoeverwants-health.log 2>&1") | crontab -

# --- Preview environment auto-cleanup (daily at 4 AM) ---
chmod +x /root/whoeverwants/scripts/preview-manager.sh
mkdir -p /root/previews /etc/caddy/previews
(crontab -l 2>/dev/null | grep -v 'preview-manager.sh' || true; \
 echo "0 4 * * * /root/whoeverwants/scripts/preview-manager.sh cleanup 7 >> /var/log/whoeverwants-preview-cleanup.log 2>&1") | crontab -

# --- Dev server auto-cleanup (daily at 4:30 AM) ---
chmod +x /root/whoeverwants/scripts/dev-server-manager.sh
mkdir -p /root/dev-servers /etc/caddy/dev-servers
(crontab -l 2>/dev/null | grep -v 'dev-server-manager.sh' || true; \
 echo "30 4 * * * /root/whoeverwants/scripts/dev-server-manager.sh cleanup 7 >> /var/log/whoeverwants-dev-cleanup.log 2>&1") | crontab -

# --- Notification tick (every minute) ---
# Server-local cron drives the deadline-based poll-closed + phase-transition
# pushes. The app computes "closed"/"prephase over" lazily on read; nothing
# else acts on deadlines passing, so without this the only notifications that
# fire are the inline ones from explicit close/cutoff/create. Bearer-secret
# gated; the secret lives in .env.api so the cron and the API container share
# one value. Generated here if absent — the API container must be (re)created
# afterward (`docker compose up -d --force-recreate api`) to read the new env.
chmod +x /root/whoeverwants/scripts/notification-tick.sh
touch /root/whoeverwants/.env.api
if ! grep -q '^INTERNAL_TICK_SECRET=' /root/whoeverwants/.env.api 2>/dev/null; then
  echo "INTERNAL_TICK_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')" >> /root/whoeverwants/.env.api
fi
(crontab -l 2>/dev/null | grep -v 'notification-tick.sh' || true; \
 echo "* * * * * /root/whoeverwants/scripts/notification-tick.sh >> /var/log/whoeverwants-notification-tick.log 2>&1") | crontab -

echo "Cron jobs installed:"
crontab -l

# ── 11. Dev webhook service ──────────────────────────────────────────
echo "=== 11/15 Setting up dev webhook service ==="

# Generate webhook secret if it doesn't exist
if [ ! -f /etc/dev-webhook-secret ]; then
  python3 -c "import secrets; print(secrets.token_urlsafe(32))" > /etc/dev-webhook-secret
  chmod 600 /etc/dev-webhook-secret
  echo "Generated webhook secret (save for GitHub webhook config)"
fi

cat > /etc/systemd/system/dev-webhook.service <<'EOF'
[Unit]
Description=GitHub Webhook Handler for Dev Servers
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /root/whoeverwants/scripts/dev-webhook.py
Restart=always
RestartSec=5
WorkingDirectory=/root/whoeverwants

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now dev-webhook

# ── 12. Dev server revive on boot ────────────────────────────────────
echo "=== 12/15 Setting up dev server boot revive ==="

cat > /etc/systemd/system/dev-servers-revive.service <<'EOF'
[Unit]
Description=Revive dev servers after reboot
After=network.target docker.service caddy.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=/root/whoeverwants/scripts/dev-server-manager.sh revive
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dev-servers-revive

# ── 13. Verify services ─────────────────────────────────────────────
echo ""
echo "=== 13/15 Verifying services ==="

echo "Health check:"
curl -s http://localhost:8000/health
echo ""

echo "Dev webhook:"
curl -s http://localhost:9091/health || echo "(will start after first request)"
echo ""

echo "Tables:"
docker exec -i whoeverwants-db-1 psql -U whoeverwants -c '\dt'

# ── 14. Verify security hardening ───────────────────────────────────
echo ""
echo "=== 14/15 Verifying security hardening ==="

echo "Firewall status:"
ufw status

echo ""
echo "SSH hardening:"
grep -E "^(PermitRootLogin|PasswordAuthentication)" /etc/ssh/sshd_config

# ── 15. Summary ──────────────────────────────────────────────────────
echo ""
echo "=== 15/15 Provisioning complete ==="
echo ""
echo "Set these environment variables in your Claude Code session:"
echo "  export DROPLET_API_URL=https://${DROPLET_IP_DASHED}.sslip.io"
echo "  export DROPLET_API_TOKEN=<token>"
echo ""
echo "Webhook secret (for GitHub webhook config):"
cat /etc/dev-webhook-secret
echo ""
echo "DNS records needed:"
echo "  ${API_DOMAIN}    A  ${DROPLET_IP}"
echo "  ${HOOKS_DOMAIN}  A  ${DROPLET_IP}"
if [ -z "$DROPLET_LABEL" ]; then
  echo "  *.dev.whoeverwants.com  A  ${DROPLET_IP}  (legacy; dev servers now run on Mac mini)"
fi
echo ""
echo "GitHub webhook URL:"
echo "  https://${HOOKS_DOMAIN}/github"
echo ""
echo "IMPORTANT: Never commit the API token or webhook secret to git."
