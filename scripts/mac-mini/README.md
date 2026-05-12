# scripts/mac-mini/

Production source files for the Mac mini Colima-VM dev box. See `docs/mac-mini-setup.md` for the reproduction walkthrough that uses them.

| File | Lives at on Mac | Purpose |
|---|---|---|
| `cmd-api.py` | `~/devbox/cmd-api/cmd-api.py` | Bearer-token-auth HTTP server that runs shell commands inside the cmd-api container. Mounted Docker socket = Claude/CI can manage VM containers. Mirrors `/opt/cmd-api.py` on the droplet. |
| `webhook.py` | `~/devbox/webhook/webhook.py` | GitHub push-event webhook receiver. HMAC-verifies, parses commits, dispatches to dev-server-manager (when ported). |
| `Dockerfile.cmd-api` | `~/devbox/cmd-api/Dockerfile` | Minimal Python + docker-cli + git + bash for cmd-api. |
| `Dockerfile.webhook` | `~/devbox/webhook/Dockerfile` | Same base; will eventually invoke dev-server-manager. |
| `docker-compose.yml` | `~/devbox/docker-compose.yml` | The whole stack: nginx-test + cmd-api + postgres + webhook + shared `devbox-net`. |
| `ddns.sh` | `~/devbox/ddns.sh` | Polls public IP, UPSERTs Route 53 A record if changed. |
| `com.devbox.ddns.plist` | `~/Library/LaunchAgents/com.devbox.ddns.plist` | LaunchAgent running ddns.sh every 5 min (300s). |
| `Caddyfile` | `/opt/homebrew/etc/Caddyfile` | Caddy site blocks. Per-author blocks land here later (or get replaced by a wildcard + in-VM router). |

**Not committed**: `.env` in `~/devbox/` containing `CMD_API_TOKEN`, `POSTGRES_PASSWORD`, `GITHUB_WEBHOOK_SECRET`. Generated fresh per-machine via `openssl rand -hex 32` (cmd-api), `openssl rand -hex 24` (postgres), `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'` (webhook).
