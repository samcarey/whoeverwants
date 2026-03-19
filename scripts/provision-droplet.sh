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

# ── 5. Add swap (required for Node.js builds on 1GB droplets) ────────
echo "=== 5/13 Configuring swap ==="
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "2GB swap created"
else
  echo "Swap already configured"
fi

# ── 6. Install Node.js ───────────────────────────────────────────────
echo "=== 6/13 Installing Node.js ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "Node.js already installed: $(node --version)"
fi

# ── 7. Configure Caddy ───────────────────────────────────────────────
echo "=== 7/13 Configuring Caddy ==="
cat > /etc/caddy/Caddyfile <<EOF
${DROPLET_IP_DASHED}.sslip.io {
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
EOF

systemctl restart caddy

# ── 8. Clone repo and start Docker services ──────────────────────────
# Note: The FastAPI container uses uv for Python dependency management.
# uv is installed inside the Docker image (see server/Dockerfile).
# Dependencies are defined in server/pyproject.toml and locked in server/uv.lock.
# No manual Python package installation is needed on the host.
echo "=== 8/13 Cloning repo and starting Docker services ==="
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
echo "=== 9/13 Applying database migrations ==="

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

# ── 10. Build and start Next.js frontend ─────────────────────────────
echo "=== 10/13 Building Next.js frontend ==="
cd /root/whoeverwants
npm ci
NEXT_OUTPUT=standalone NODE_ENV=production npx next build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

cat > /etc/systemd/system/whoeverwants-web.service <<'EOF'
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
StandardOutput=journal
StandardError=journal
SyslogIdentifier=whoeverwants-web

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now whoeverwants-web

# ── 11. Production hardening ─────────────────────────────────────────
echo "=== 11/13 Production hardening (logs, backups, health checks) ==="

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

echo "Cron jobs installed:"
crontab -l

# ── 12. Verify services ──────────────────────────────────────────────
echo ""
echo "=== 12/13 Verifying services ==="

echo "Health check:"
curl -s http://localhost:8000/health
echo ""

echo "Frontend:"
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3000/
echo ""

echo "Tables:"
docker exec -i whoeverwants-db-1 psql -U whoeverwants -c '\dt'

# ── 13. Verify security hardening ────────────────────────────────────
echo ""
echo "=== 13/13 Verifying security hardening ==="

echo "Firewall status:"
ufw status

echo ""
echo "SSH hardening:"
grep -E "^(PermitRootLogin|PasswordAuthentication)" /etc/ssh/sshd_config

echo ""
echo "=== Provisioning complete ==="
echo ""
echo "Set these environment variables in your Claude Code session:"
echo "  export DROPLET_API_URL=https://${DROPLET_IP_DASHED}.sslip.io"
echo "  export DROPLET_API_TOKEN=<token>"
echo ""
echo "IMPORTANT: Never commit the API token to git."
