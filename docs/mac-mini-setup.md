# Mac Mini Dev Server Setup

## Status

**Foundation infrastructure complete; dev-server-manager port is the remaining work.**

This document captures the architecture and reproduction steps for migrating the dev-server side of WhoeverWants from the DigitalOcean droplet to a Mac mini at home. The Mac is the new control plane for per-author dev servers; the droplet keeps the production API.

What's working today:
- Colima VM as Claude's sandbox
- Per-hostname HTTPS via home-router port forwarding + Caddy + Let's Encrypt
- Self-healing public IP via DDNS into Route 53
- `cmd-api` container — Claude can drive the Mac via HTTPS, same model as the droplet
- `webhook` container — receives GitHub push events, HMAC-verifies, routes to dev-server-manager
- Postgres 16 container with persistent volume

What's NOT yet ported (see `docs/mac-mini-next-steps.md`):
- `dev-server-manager.sh` — the script that actually provisions per-author dev servers
- Wildcard `*.dev.whoeverwants.com` cutover from droplet IP to home IP
- GitHub webhook URL change

## Architecture

```
Internet
  │
  ▼  DNS (Route 53 — DDNS-managed home IP record + per-service CNAMEs)
Home router (port-forwards 80 + 443 → Mac LAN IP)
  │
  ▼
Mac mini host
  ├─ macOS Application Firewall (Caddy in allowlist)
  ├─ Caddy (Homebrew, system LaunchDaemon)
  │     • Listens on 0.0.0.0:80 + 0.0.0.0:443
  │     • Per-hostname Let's Encrypt certs (HTTP-01)
  │     • Reverse-proxies to Mac localhost ports (where Colima publishes container ports)
  ├─ Colima daemon (Apple Virtualization Framework)
  │   └─ Linux ARM64 VM ── Claude's sandbox ── isolated from Mac filesystem
  │       ├─ docker-compose stack at /Users/<you>/devbox/docker-compose.yml
  │       │   ├─ cmd-api      — published 127.0.0.1:9090 — bearer-token auth
  │       │   ├─ webhook      — published 127.0.0.1:9091 — HMAC-verified
  │       │   ├─ postgres     — internal only (no published port)
  │       │   └─ nginx-test   — published 127.0.0.1:8080 — placeholder
  │       └─ Docker socket mounted into cmd-api & webhook (so they can spawn dev-server containers)
  ├─ DDNS launchd job (5-min interval, AWS Route 53 UPSERT)
  └─ Other LaunchAgents (iOS GH runner, Ollama, etc.) — independent
```

**Key isolation boundary**: cmd-api lives in the VM. It can spawn/manage VM containers (via Docker socket) but cannot touch the Mac filesystem. The Mac host runs only Colima + Caddy + DDNS + the user's pre-existing services. To update infrastructure config (Caddyfile, docker-compose.yml, .env), edits happen on the Mac filesystem at `~/devbox/`.

## Prerequisites

| Requirement | Notes |
|---|---|
| Apple Silicon Mac mini (M1+) | Tested on M4, 32 GB RAM, macOS 26 |
| Free disk ≥ 100 GB | VM allocated 80 GB |
| Real public IP from ISP, not CGNAT | Verify by comparing `curl ifconfig.co` with router WAN IP |
| ISP doesn't block port 80/443 inbound | Verify with `curl https://ifconfig.co/port/443?ip=<your-ip>` after enabling a test listener |
| Home router with port forwarding + DHCP reservation for Mac | Most consumer routers support both |
| AWS account with the `whoeverwants.com` Route 53 hosted zone | Pre-existing |
| Homebrew installed | `brew --version` |

## Reproduction

The companion script is `scripts/provision-mac-mini.sh`. It encodes the steps that *can* be scripted; manual steps (router config, AWS console, etc.) are called out below.

### 1. Mac baseline (one-time)

```bash
# Application firewall + stealth mode
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on

# FileVault — disk encryption. Save the recovery key prompted out somewhere safe.
sudo fdesetup enable
```

### 2. Install tooling

```bash
brew install colima docker docker-compose caddy awscli
mkdir -p ~/.docker/cli-plugins
ln -sfn /opt/homebrew/opt/docker-compose/bin/docker-compose ~/.docker/cli-plugins/docker-compose
```

### 3. Colima VM

```bash
colima start --profile devbox \
  --arch aarch64 --vm-type vz \
  --cpu 6 --memory 12 --disk 80 \
  --mount-type virtiofs --ssh-agent

docker context use colima-devbox
docker run --rm hello-world  # smoke
```

### 4. AWS IAM user for Route 53 (manual + CLI)

In the AWS console, create an IAM user (`mac-devbox-ddns`) with `AmazonRoute53FullAccess`. Generate an access key. On the Mac:

```bash
aws configure   # paste Access Key ID + Secret; region us-east-1; output json
aws sts get-caller-identity   # smoke
ZONE=$(printf '%s.%s' whoeverwants com)
aws route53 list-hosted-zones-by-name --dns-name "$ZONE" \
  --query 'HostedZones[*].[Id,Name]' --output text
# → /hostedzone/Z000095423MM09UF7IBWG  whoeverwants.com.
```

Note the hosted zone ID for later steps.

### 5. Initial DNS record + DDNS

Create an "anchor" A record that DDNS will keep in sync with the home IP. Other hostnames will CNAME to this:

```bash
HOST=$(printf 'mac-test.dev.%s.%s' whoeverwants com)
aws route53 change-resource-record-sets \
    --hosted-zone-id Z000095423MM09UF7IBWG \
    --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$HOST\",\"Type\":\"A\",\"TTL\":60,\"ResourceRecords\":[{\"Value\":\"$(curl -s ifconfig.co)\"}]}}]}"
```

Install the DDNS script + LaunchAgent (full source in `scripts/mac-mini/ddns.sh` and `scripts/mac-mini/com.devbox.ddns.plist`):

```bash
mkdir -p ~/devbox ~/Library/Logs ~/Library/LaunchAgents
cp scripts/mac-mini/ddns.sh ~/devbox/ddns.sh
chmod +x ~/devbox/ddns.sh
cp scripts/mac-mini/com.devbox.ddns.plist ~/Library/LaunchAgents/com.devbox.ddns.plist
launchctl load ~/Library/LaunchAgents/com.devbox.ddns.plist
launchctl list | grep ddns   # confirm loaded
```

### 6. Router port forwarding (manual)

Log into your router admin (typically `http://192.168.1.1`). Add **two** port-forward rules:

| External | Internal IP | Internal port | Protocol |
|---|---|---|---|
| 80 | `<Mac LAN IP>` | 80 | TCP |
| 443 | `<Mac LAN IP>` | 443 | TCP |

Get your Mac's LAN IP via `ifconfig en1 | grep "inet " | grep -v 127.0.0.1`. Set a DHCP reservation for the Mac so its LAN IP doesn't rotate.

Verify after both rules are saved:

```bash
curl -s "https://ifconfig.co/port/80?ip=$(curl -s ifconfig.co)"
curl -s "https://ifconfig.co/port/443?ip=$(curl -s ifconfig.co)"
# Both should show "reachable":true (when something IS listening) or "reachable":false (otherwise)
```

### 7. Caddy + Application Firewall fix

```bash
# Initial Caddyfile — start with one site for the anchor hostname
HOST=$(printf 'mac-test.dev.%s.%s' whoeverwants com)
sudo tee /opt/homebrew/etc/Caddyfile <<EOF
$HOST {
    bind 0.0.0.0 ::
    reverse_proxy localhost:8080
}
EOF

# Application Firewall fix — Caddy is brew-installed (unsigned), the firewall blocks
# inbound to it by default and there's no UI prompt for daemons. The fix is to add it
# explicitly to the allowlist AND restart the service afterwards (the restart is what
# actually unblocks).
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /opt/homebrew/opt/caddy/bin/caddy
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp /opt/homebrew/opt/caddy/bin/caddy

sudo brew services start caddy
```

`sudo` is required for `brew services start` so the LaunchDaemon runs as root and can bind ports < 1024.

### 8. devbox docker-compose stack

Generate per-secret values, write the compose file, build & start everything. Full templates in `scripts/mac-mini/`.

```bash
mkdir -p ~/devbox/cmd-api ~/devbox/webhook
cp scripts/mac-mini/cmd-api.py     ~/devbox/cmd-api/
cp scripts/mac-mini/Dockerfile.cmd-api ~/devbox/cmd-api/Dockerfile
cp scripts/mac-mini/webhook.py     ~/devbox/webhook/
cp scripts/mac-mini/Dockerfile.webhook ~/devbox/webhook/Dockerfile
cp scripts/mac-mini/docker-compose.yml ~/devbox/docker-compose.yml

# Generate secrets (NEVER commit these)
{
  echo "CMD_API_TOKEN=$(openssl rand -hex 32)"
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  echo "GITHUB_WEBHOOK_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
} > ~/devbox/.env
chmod 600 ~/devbox/.env

cd ~/devbox && docker compose up -d --build
docker compose ps   # nginx-test, cmd-api, postgres, webhook all "Up"
```

### 9. DNS + Caddy entries for cmd-api and webhook

```bash
ZONE_ID=Z000095423MM09UF7IBWG
ANCHOR=$(printf 'mac-test.dev.%s.%s' whoeverwants com)
for SUB in cmd-api webhook; do
  HOST=$(printf '%s.dev.%s.%s' "$SUB" whoeverwants com)
  aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$HOST\",\"Type\":\"CNAME\",\"TTL\":60,\"ResourceRecords\":[{\"Value\":\"$ANCHOR\"}]}}]}"
done

# Update Caddyfile to add the additional site blocks
HOST1=$(printf 'mac-test.dev.%s.%s' whoeverwants com)
HOST2=$(printf 'cmd-api.dev.%s.%s' whoeverwants com)
HOST3=$(printf 'webhook.dev.%s.%s' whoeverwants com)
sudo tee /opt/homebrew/etc/Caddyfile <<EOF
$HOST1 { bind 0.0.0.0 :: ; reverse_proxy localhost:8080 }
$HOST2 { bind 0.0.0.0 :: ; reverse_proxy localhost:9090 }
$HOST3 { bind 0.0.0.0 :: ; reverse_proxy localhost:9091 }
EOF
sudo brew services restart caddy
sleep 45  # cert provisioning
```

### 10. Verify externally

```bash
# Test from anywhere external — phone on cellular, another machine, this:
curl -sv https://cmd-api.dev.whoeverwants.com/   # 403 (no auth) → cert is valid
curl -sv https://webhook.dev.whoeverwants.com/health   # {"status":"ok"}
```

Then test cmd-api with the bearer token:

```bash
TOKEN=$(grep CMD_API_TOKEN ~/devbox/.env | cut -d= -f2)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"cmd":"hostname; uname -a; docker ps"}' \
  https://cmd-api.dev.whoeverwants.com/
```

Output should be JSON with `exit_code: 0` and the cmd-api container's hostname/uname plus a list of running containers.

## Important pitfalls (learned the hard way)

- **Cloudflare Tunnel free tier ≠ subdomain zones.** We started with Cloudflare Tunnel as the public-ingress mechanism but discovered that Cloudflare's "Published application routes" feature requires the zone to be *active* on Cloudflare — meaning the apex domain's NS records must point at Cloudflare. Subdomain delegation isn't supported on free tier (Enterprise only). Pivoting to direct port-forwarding ended up being simpler.
- **macOS Application Firewall silently blocks unsigned daemons from accepting inbound connections.** Caddy via brew is unsigned. The firewall doesn't prompt for daemons launched via launchd, it just drops connections at the kernel layer. TCP handshake completes (something accepts SYN) but actual data packets get dropped. Symptoms: `nc -l 80` (system binary) works; Caddy doesn't. Fix: `socketfilterfw --add` + `--unblockapp` + restart Caddy. The `--add` alone wasn't enough — the restart is what cleared the broken state.
- **Let's Encrypt multi-perspective validation needs all five validators to succeed.** Earlier rate-limit failures were caused by the App-Firewall block, not L.E. policies. Once the firewall fix landed, HTTP-01 worked first try.
- **Hairpin NAT on home routers tests TCP only.** `ifconfig.co/port/N` reachability checks just complete TCP handshakes. They do NOT prove that HTTP requests would actually flow end-to-end. Use a real GET (e.g., `curl` from an external machine) to verify the full path.
- **Caddy on macOS reports IPv4 listeners as IPv6 in lsof** when bound via `bind 0.0.0.0 ::`. Looks weird but works. Don't waste time trying to "fix" it.
- **chat-client autolinking corrupts heredoc bodies.** Anything that looks like a hostname (`foo.com`, `log.info`, `subprocess.run`) gets wrapped in `<>` markdown autolinks during copy-paste, which breaks shell parsing and Python syntax. Workaround: build hostnames at runtime via `printf '%s.%s' x y`. For Python, use sed-fix `s/<\([a-z_]*\)\.\([a-z_]*\)>/\1.\2/g` after pasting if needed.
- **Mac VM filesystem is intentionally NOT mounted.** cmd-api in the VM cannot edit `~/devbox/` files on the Mac. All config edits happen on the Mac side; cmd-api handles runtime operations only. This is the deliberate isolation.

## Operational reference

| Concern | Where |
|---|---|
| Compose stack | `~/devbox/docker-compose.yml` |
| Secrets | `~/devbox/.env` (mode 600, never commit) |
| Caddy config | `/opt/homebrew/etc/Caddyfile` |
| Caddy logs | `/opt/homebrew/var/log/caddy.log` |
| Caddy data (certs etc.) | `/opt/homebrew/var/lib/caddy/` |
| DDNS script | `~/devbox/ddns.sh` |
| DDNS LaunchAgent | `~/Library/LaunchAgents/com.devbox.ddns.plist` |
| DDNS logs | `~/Library/Logs/ddns.log` |
| Container logs | `docker compose logs -f <service>` |
| Restart Caddy | `sudo brew services restart caddy` |
| Restart a service | `cd ~/devbox && docker compose restart <service>` |

## Calling cmd-api from elsewhere

Same pattern as `scripts/remote.sh` for the droplet. Set in your shell:

```bash
export MAC_API_URL=https://cmd-api.dev.whoeverwants.com
export MAC_API_TOKEN=<from ~/devbox/.env CMD_API_TOKEN>
```

Then any HTTPS POST works:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $MAC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cmd":"hostname; docker ps"}' \
  "$MAC_API_URL/"
```

## See also

- `scripts/mac-mini/` — production source files (cmd-api, webhook, ddns, Dockerfiles, etc.)
- `scripts/provision-mac-mini.sh` — partial automation script
- `docs/mac-mini-next-steps.md` — remaining migration work + open architectural decisions
- `docs/droplet-setup.md` — the predecessor system; some patterns are shared
