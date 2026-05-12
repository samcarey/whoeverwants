# Mac Mini Migration — Remaining Work

The infrastructure foundation in `docs/mac-mini-setup.md` is complete. The remaining work is to actually use it for per-author dev servers (replacing the droplet's dev side) and decommission the droplet's dev pieces.

## 1. Port `dev-server-manager.sh`

The droplet's `scripts/dev-server-manager.sh` is 854 lines designed for a **process-based model**:
- Each author's dev server runs as TWO processes on the droplet: `next dev` + `uv run uvicorn`
- Ports 3001-3005 (frontend) + 8001-8005 (API) allocated dynamically
- Per-author Caddy config snippet generated and `import`-ed by main Caddy
- Per-author Postgres database in the shared instance
- Process lifecycle tracked via PID files at `/root/dev-servers/<slug>/.api.pid`

For the Mac VM, we need to decide how to host these dev servers. **This decision was deferred.** Three live options:

### Option A — Per-author container with both processes inside (recommended baseline)
One Docker container per author. Image has Node + uv + git + bash. Container starts: clone repo, checkout branch, `npm ci`, `uv sync`, run `next dev` + `uv run uvicorn` as background processes.

**Pros**: closest mental model to the droplet's process orchestration; single container per author is easy to reason about.
**Cons**: container is a "fat" container (~1 GB image); restarting the API process means restarting both processes.

### Option B — Two containers per author (frontend + API split)
Each author = a `docker-compose-per-author` project with two services. Frontend image is `node:20-alpine` + bind-mount of repo; API image is `python:3.12` + uv. Compose project name = author slug.

**Pros**: clean separation; can rebuild frontend without touching API; easier debugging.
**Cons**: significant rewrite of dev-server-manager; bookkeeping for two containers per author.

### Option C — Process-based directly inside the Colima VM (closest to droplet)
Don't containerize per-author dev servers at all. Install Node + uv inside the Colima VM root filesystem, run dev servers as processes there. Manage with `dev-server-manager.sh` ported with minimal changes — most of the original script still applies.

**Pros**: lowest-friction port (smallest diff from existing script).
**Cons**: compromises the "VM = container host only" cleanliness; one rogue dev server can affect the others (no per-process resource isolation).

### Routing strategy (independent of A/B/C)

In all three options, Caddy needs to reach each per-author dev server by hostname. Two paths:

#### Routing 1 — Per-author Caddyfile snippet (closest to droplet)
`dev-server-manager` writes `/opt/homebrew/etc/Caddyfile.d/<slug>.caddy` and signals Caddy reload. Caddyfile imports the directory.

**Friction**: dev-server-manager runs in the VM, but the Caddyfile lives on the Mac. Either (a) cmd-api proxies the file write to the Mac (requires a "write file on Mac" hatch we deliberately don't have), (b) move Caddy into the VM (rewires port forwarding), or (c) Colima-mount `~/devbox/caddy.d/` from Mac into the VM as RW.

#### Routing 2 — Wildcard + sub-proxy (recommended for cleanliness)
Mac Caddy has one `*.dev.whoeverwants.com` site block reverse-proxying to a single VM-side proxy (Traefik). Traefik watches Docker for containers labeled `traefik.http.routers.<slug>.rule=Host(\`<slug>.dev.whoeverwants.com\`)` and routes accordingly. dev-server-manager just spawns containers with the right labels — no Caddyfile editing needed.

**Pros**: zero Caddyfile churn; dev-server-manager stays VM-side; dynamic discovery.
**Cons**: one more container (Traefik); needs wildcard cert (HTTP-01 won't work for unknown hostnames; need DNS-01 below).

### TLS strategy

#### Per-host HTTP-01 (current approach)
Caddy auto-acquires a per-hostname Let's Encrypt cert on first request. Works for known hostnames in Caddyfile.

**Constraint**: Let's Encrypt rate limit is 50 certs per registered domain per week. With ~5 active dev servers churning across feature branches, this is comfortable. For 50+ hostnames or rapid churn, would hit the limit.

#### Wildcard cert via DNS-01 (needed for Routing 2)
Single cert for `*.dev.whoeverwants.com`. Caddy needs the `caddy-dns/route53` plugin which isn't in the default brew distribution.

```bash
brew install xcaddy
xcaddy build --with github.com/caddy-dns/route53
sudo mv caddy /opt/homebrew/opt/caddy/bin/caddy
sudo brew services restart caddy
```

Then in Caddyfile:
```
*.dev.whoeverwants.com {
    tls {
        dns route53 {
            access_key_id {env.AWS_ACCESS_KEY_ID}
            secret_access_key {env.AWS_SECRET_ACCESS_KEY}
        }
    }
    reverse_proxy localhost:9092  # Traefik
}
```

Caddy uses Route 53 API for DNS-01 challenge; the existing `mac-devbox-ddns` IAM user already has the needed permissions.

### Suggested first step

Build the simplest thing that works end-to-end for a single author, then iterate. Suggest:

1. **Option A** (single container per author) + **Routing 1** with a one-shot manual Caddyfile entry per author for the FIRST dev server. Just to prove the container model works.
2. Once one author's dev server provisions and serves correctly, add automation (signal-based reload via Caddy admin API, OR move to Routing 2 + Traefik + wildcard cert).

## 2. Wildcard A record cutover

Currently:
- `*.dev.whoeverwants.com` → `142.93.60.29` (droplet)
- `mac-test.dev.whoeverwants.com` → `65.28.10.210` (Mac, via DDNS)
- `cmd-api.dev.whoeverwants.com` CNAME → mac-test
- `webhook.dev.whoeverwants.com` CNAME → mac-test

Cutover plan (after dev-server-manager is working and end-to-end-tested with a single author):
1. Pre-create per-author CNAMEs in Route 53 for any active dev users (CNAME `<slug>.dev.whoeverwants.com` → mac-test). Avoids relying on the wildcard during transition.
2. Update DDNS script (`scripts/mac-mini/ddns.sh`) to update the wildcard `*.dev.whoeverwants.com` A record alongside `mac-test.dev.whoeverwants.com`. Two `aws route53 change-resource-record-sets` calls.
3. **OR** retire the droplet wildcard A record and have everything CNAME to mac-test.

Recommended: keep `*.dev.whoeverwants.com` as a wildcard A record managed by DDNS (so any new ad-hoc dev server URL works without manual DNS edits).

## 3. GitHub webhook URL change

Currently the GitHub repo webhook points at `hooks.api.whoeverwants.com` (droplet). Once the Mac webhook receiver is end-to-end with a working dev-server-manager:

1. In GitHub: `samcarey/whoeverwants` → Settings → Webhooks → edit existing webhook
2. Change Payload URL from `https://hooks.api.whoeverwants.com/github` to `https://webhook.dev.whoeverwants.com/github`
3. Update the secret to match `~/devbox/.env`'s `GITHUB_WEBHOOK_SECRET` on the Mac
4. Click "Redeliver" on a recent push to test, verify Mac webhook logs receive it

## 4. Droplet decommission

After 2+ weeks of stable Mac dev server operation:

1. On droplet: `systemctl disable --now dev-webhook` and `rm /etc/systemd/system/dev-webhook.service`
2. On droplet: `dev-server-manager.sh destroy-all`, then disable the service
3. Drop the wildcard A record at Route 53 (or leave it pointing at Mac via DDNS — covered in §2)
4. Production API stays on droplet — leave that infrastructure alone

The droplet's `cmd-api`, `caddy`, and prod API should remain running indefinitely. The Mac is replacing only the dev-server side.

## 5. Optional — Move Caddy into the VM

**Why consider this**: simplifies dev-server-manager (Caddyfile edits stay VM-side). Eliminates the cross-boundary friction in Routing 1.

**Why we kept Caddy on Mac initially**: less rewiring. Mac firewall is the only thing that needs to know about ports 80/443; moving Caddy into VM means the Mac forwards 80/443 to the VM (via Colima), the VM Caddy listens on those, and the firewall fix transfers to whichever process now binds them on Mac (probably the colima/qemu/vz process).

If/when this is done:
1. Stop Caddy on Mac: `sudo brew services stop caddy`
2. Remove Caddy from Application Firewall allowlist (`socketfilterfw --remove`)
3. Add a `caddy` service to `~/devbox/docker-compose.yml` with `ports: ["0.0.0.0:80:80", "0.0.0.0:443:443"]`
4. Ensure Colima publishes those ports to all Mac interfaces (default for non-127.0.0.1-prefixed publishes — verify with `lsof -i :80`)
5. Move `/opt/homebrew/etc/Caddyfile` into a Caddy compose volume

## 6. Optional — Tighten DDNS IAM scope

The `mac-devbox-ddns` user currently has `AmazonRoute53FullAccess`. Tighter scope:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["route53:ListHostedZonesByName", "route53:GetChange"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["route53:ListResourceRecordSets", "route53:ChangeResourceRecordSets"],
      "Resource": "arn:aws:route53:::hostedzone/Z000095423MM09UF7IBWG"
    }
  ]
}
```

Worth doing once the migration is stable; not blocking.
