#!/bin/bash
# Provision a fresh Ubuntu 24.04 droplet for WhoeverWants.
#
# This script is designed to run ON the droplet itself (e.g., via SSH or paste).
# It installs all dependencies, sets up the command API, Caddy, Docker,
# clones the repo, starts services, and applies database migrations.
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
echo "=== 1/7 System updates ==="
apt-get update -qq
apt-get upgrade -y -qq

# ── 2. Install Docker ────────────────────────────────────────────────
echo "=== 2/7 Installing Docker ==="
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
else
  echo "Docker already installed: $(docker --version)"
fi

# ── 3. Install Caddy ─────────────────────────────────────────────────
echo "=== 3/7 Installing Caddy ==="
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
echo "=== 4/7 Setting up command execution API ==="
cat > /opt/cmd-api.py <<'PYEOF'
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

# ── 5. Configure Caddy ───────────────────────────────────────────────
echo "=== 5/7 Configuring Caddy ==="
cat > /etc/caddy/Caddyfile <<EOF
${DROPLET_IP_DASHED}.sslip.io {
    reverse_proxy 127.0.0.1:9090
}

whoeverwants.com {
    reverse_proxy 127.0.0.1:8000
}
EOF

systemctl restart caddy

# ── 6. Clone repo and start services ─────────────────────────────────
# Note: The FastAPI container uses uv for Python dependency management.
# uv is installed inside the Docker image (see server/Dockerfile).
# Dependencies are defined in server/pyproject.toml and locked in server/uv.lock.
# No manual Python package installation is needed on the host.
echo "=== 6/7 Cloning repo and starting Docker services ==="
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

# ── 7. Apply database migrations ─────────────────────────────────────
echo "=== 7/7 Applying database migrations ==="

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

# ── Verify ────────────────────────────────────────────────────────────
echo ""
echo "=== Provisioning complete ==="
echo ""
echo "Health check:"
curl -s http://localhost:8000/health
echo ""
echo ""
echo "Tables:"
docker exec -i whoeverwants-db-1 psql -U whoeverwants -c '\dt'
echo ""
echo "Set these environment variables in your Claude Code session:"
echo "  export DROPLET_API_URL=https://${DROPLET_IP_DASHED}.sslip.io"
echo "  export DROPLET_API_TOKEN=${API_TOKEN}"
