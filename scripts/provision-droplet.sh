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

echo "=== Provisioning WhoeverWants droplet ==="
echo "IP: $DROPLET_IP"
echo "sslip.io domain: ${DROPLET_IP_DASHED}.sslip.io"
echo ""

# ── 1. System updates ────────────────────────────────────────────────
echo "=== 1a/13 System updates ==="
apt-get update -qq
apt-get upgrade -y -qq

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
echo "=== 5/15 Installing Node.js ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  echo "Node.js installed: $(node --version)"
else
  echo "Node.js already installed: $(node --version)"
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

api.whoeverwants.com {
	@options method OPTIONS
	handle @options {
		header Access-Control-Allow-Origin *
		header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
		header Access-Control-Allow-Headers "Content-Type, Authorization"
		respond 204
	}

	reverse_proxy 127.0.0.1:8000
}

hooks.api.whoeverwants.com {
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
echo "  *.dev.whoeverwants.com  A  ${DROPLET_IP}"
echo ""
echo "GitHub webhook URL:"
echo "  https://hooks.api.whoeverwants.com/github"
echo ""
echo "IMPORTANT: Never commit the API token or webhook secret to git."
