# Security Incident Recovery Plan

**Date**: 2026-03-19
**Incident**: Kinsing cryptominer malware via compromised command execution API token
**Status**: Droplet actively compromised, malware running as root with rootkit

---

## Root Cause

The bearer token for the command execution API was accidentally committed to the **public** GitHub repo in commit `fa805e7` (Mar 18, 23:10 UTC). It was removed one minute later in `9cfeef1`, but automated GitHub credential scanners captured it. The attacker used the token ~15 hours later (Mar 19, 14:15 UTC) to POST commands to the API, gaining full root shell access.

## What Was Compromised

- **Kinsing binary** running as PID 172390 (cryptominer)
- **Rootkit** (`/etc/data/libsystem.so`) loaded via `/etc/ld.so.preload` — hides malware from `ps`, `ls`, etc.
- **Persistence** via `bot.service` (systemd) and crontab manipulation
- **SSH killed** by the malware to block competing access
- The entire droplet filesystem is untrustworthy

## What Was NOT Compromised

- The GitHub repo itself (no malicious commits)
- The database data (Postgres was running in Docker, but data integrity is uncertain)
- The domain `whoeverwants.com` DNS
- Any user accounts (there are none — anonymous app)

---

## Recovery Plan

### Phase 1: Backup Database (Before Destroying Droplet)

The droplet is compromised but the database container may still have valid data. Extract a backup before nuking:

```bash
# Try to get a database dump via the command API (token still works)
bash scripts/remote.sh "docker exec whoeverwants-db-1 pg_dump -U whoeverwants whoeverwants" /root 120 > /tmp/db-backup-pre-nuke.sql

# Also grab the most recent automated backup if it exists
bash scripts/remote.sh "ls -la /var/backups/whoeverwants/" /root
# Then fetch the latest:
bash scripts/remote.sh "cat /var/backups/whoeverwants/$(bash scripts/remote.sh 'ls -t /var/backups/whoeverwants/ | head -1' /root)" /root > /tmp/db-backup-automated.sql.gz
```

**Verify the backup is sane** (check for expected tables, row counts, no suspicious entries):
```bash
grep -c "^COPY" /tmp/db-backup-pre-nuke.sql
# Should see COPY statements for: polls, votes, ranked_choice_rounds, _migrations, poll_access
```

> **IMPORTANT**: Treat this backup as potentially tainted. Review it before restoring. The attacker had root access and could have modified database contents.

### Phase 2: Destroy the Compromised Droplet

The rootkit makes in-place cleanup unreliable. **Nuke and reprovision.**

1. Go to DigitalOcean control panel
2. **Destroy** the droplet at `157.245.129.162`
3. **Create a new droplet** with the same specs:
   - Ubuntu 24.04 LTS
   - Basic $6/mo (1 vCPU, 1GB RAM, 24GB SSD)
   - Region: NYC (or any)
   - Auth: **SSH key only** (no password auth)
   - Hostname: `whoeverwants`
4. Note the **new IP address**

### Phase 3: Generate New Token

```bash
# Generate a new strong token (run locally)
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

**Store this token ONLY in**:
- Claude Code environment variables (via Anthropic's secrets management)
- The droplet's systemd service file (written during provisioning)

**NEVER**:
- Commit it to git (any file, including CLAUDE.md, .env, etc.)
- Store it in any file tracked by git
- Put it in shell history on shared systems

### Phase 4: Harden the Provisioning Script

Before reprovisioning, update `scripts/provision-droplet.sh` with these security improvements:

#### 4a. Enable UFW Firewall
Add after system updates:
```bash
# ── Firewall ──
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Caddy)
ufw allow 443/tcp   # HTTPS (Caddy)
ufw --force enable
```

This blocks port 31790 (kinsing's listener) and any other unexpected ports.

#### 4b. Disable SSH Password Auth
Add after firewall setup:
```bash
# ── SSH hardening ──
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

#### 4c. Add Request Logging to cmd-api.py
Replace the `log_message` override with actual logging:
```python
import datetime

def log_message(self, format, *args):
    timestamp = datetime.datetime.now().isoformat()
    client_ip = self.client_address[0]
    print(f"[{timestamp}] {client_ip} {format % args}")
```

Also add a log line for auth failures:
```python
if auth != f"Bearer {SECRET}":
    timestamp = datetime.datetime.now().isoformat()
    client_ip = self.client_address[0]
    print(f"[{timestamp}] AUTH FAILURE from {client_ip}")
    self.send_response(403)
    ...
```

#### 4d. Add Rate Limiting to cmd-api.py
Add a simple rate limiter (e.g., max 60 requests/minute per IP) to slow down abuse even if the token leaks:
```python
from collections import defaultdict
import time

REQUEST_LOG = defaultdict(list)
MAX_REQUESTS_PER_MINUTE = 60

def _rate_limited(self):
    ip = self.client_address[0]
    now = time.time()
    REQUEST_LOG[ip] = [t for t in REQUEST_LOG[ip] if now - t < 60]
    if len(REQUEST_LOG[ip]) >= MAX_REQUESTS_PER_MINUTE:
        return True
    REQUEST_LOG[ip].append(now)
    return False
```

#### 4e. Restrict cmd-api to Non-Root User (Optional but Recommended)
Run the command API as a dedicated user with limited sudo permissions rather than root. This limits blast radius if the token is compromised again. However, this adds complexity (sudo rules for docker, systemctl, git, etc.) — evaluate whether worth it for your use case.

### Phase 5: Update DNS

After creating the new droplet:

1. Update the `whoeverwants.com` A record to point to the **new IP**
2. Wait for DNS propagation (check with `dig whoeverwants.com`)

### Phase 6: Provision the New Droplet

```bash
# Set variables
export DROPLET_IP="<NEW_IP>"
export NEW_API_TOKEN="<token from Phase 3>"

# Provision (after applying Phase 4 changes to the script)
ssh root@$DROPLET_IP 'bash -s' < scripts/provision-droplet.sh "$NEW_API_TOKEN"
```

### Phase 7: Restore Database (If Needed)

If the backup from Phase 1 passes review:

```bash
# Update remote.sh env vars first
export DROPLET_API_URL="https://<NEW_IP_DASHED>.sslip.io"
export DROPLET_API_TOKEN="$NEW_API_TOKEN"

# Copy backup to droplet and restore
# (You'll need to push the backup file via git or scp since remote.sh only runs commands)
# Option: pipe it through the API
cat /tmp/db-backup-pre-nuke.sql | bash scripts/remote.sh "docker exec -i whoeverwants-db-1 psql -U whoeverwants whoeverwants" /root 120
```

If the backup is suspect or empty, skip this step — the app works fine with an empty database (anonymous polls, no persistent user data).

### Phase 8: Update Environment Variables

Update the Claude Code environment with:
- `DROPLET_API_URL=https://<NEW_IP_DASHED>.sslip.io`
- `DROPLET_API_TOKEN=<new token>`

Update `CLAUDE.md` droplet IP reference (the IP table) — but **NEVER put the token in any committed file**.

### Phase 9: Verify

```bash
# Health check
bash scripts/remote.sh "curl -s http://localhost:8000/health"
# Expected: {"status":"ok","database":"connected"}

# Frontend
bash scripts/remote.sh "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/"
# Expected: 200

# Docker services
bash scripts/remote.sh "docker compose ps" /root/whoeverwants

# Firewall
bash scripts/remote.sh "ufw status"
# Expected: 22, 80, 443 allowed — everything else denied

# SSH hardening
bash scripts/remote.sh "grep PasswordAuthentication /etc/ssh/sshd_config"
# Expected: PasswordAuthentication no

# Public access
curl -s -o /dev/null -w '%{http_code}' https://whoeverwants.com/
# Expected: 200 (after DNS propagation)
```

### Phase 10: Invalidate Old Token in Git History

The old token is in git history (commit `fa805e7`). Since it's already been used by attackers, and the old droplet will be destroyed, the token is effectively dead. However, for hygiene:

1. The old droplet is destroyed → token has nothing to authenticate against
2. The new droplet has a new token → old token is useless
3. No need to rewrite git history (disruptive and the token is harmless once the old droplet is gone)

---

## Security Improvements Summary

| Before | After |
|--------|-------|
| No firewall (UFW disabled, iptables ACCEPT-all) | UFW enabled: only 22, 80, 443 open |
| SSH password auth enabled, root login allowed | SSH key-only, password auth disabled |
| cmd-api: no request logging | cmd-api: logs all requests with timestamp and IP |
| cmd-api: no rate limiting | cmd-api: 60 req/min per IP rate limit |
| Token stored in CLAUDE.md (committed to public repo) | Token stored only in env vars and systemd service file |
| No intrusion detection | Request logging enables post-hoc analysis |

## Files to Modify

1. **`scripts/provision-droplet.sh`** — Add firewall, SSH hardening, improved cmd-api
2. **`docs/droplet-setup.md`** — Document new security measures
3. **`CLAUDE.md`** — Update droplet IP, add security rules about token handling
4. **`scripts/remote.sh`** — No changes needed (reads from env vars already)

## Estimated Downtime

- `whoeverwants.com` will be down from droplet destruction until new droplet is provisioned and DNS propagates
- Typical total: 30-60 minutes (provisioning ~15 min, DNS propagation ~15-30 min)
- If DNS TTL is high, consider lowering it before the migration

---

## Checklist

- [ ] Back up database from compromised droplet
- [ ] Review backup for integrity/tampering
- [ ] Destroy old droplet (157.245.129.162)
- [ ] Create new droplet (SSH key auth only)
- [ ] Generate new API token
- [ ] Update provision script with security hardening (firewall, SSH, logging, rate limiting)
- [ ] Update droplet-setup.md
- [ ] Update CLAUDE.md with new IP (NOT the token)
- [ ] Provision new droplet
- [ ] Update DNS A record for whoeverwants.com
- [ ] Restore database (if backup is clean)
- [ ] Set new env vars in Claude Code
- [ ] Run full verification suite
- [ ] Confirm whoeverwants.com is live
