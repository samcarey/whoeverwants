#!/usr/bin/env python3
"""
GitHub webhook handler for the Mac mini Colima VM.

Listens on 0.0.0.0:9091 inside its container; Caddy on the Mac terminates TLS at
webhook.dev.whoeverwants.com and reverse-proxies here. HMAC-SHA256 signature
verification, JSON event parsing, dispatches to dev-server-manager (when
MANAGER_CMD is set) in a background thread.

Adapted from scripts/dev-webhook.py (the droplet's version). Differences:
- Binds 0.0.0.0 (Docker port-publishing requires this; the droplet ran on the
  host network so 127.0.0.1 was fine)
- Secret comes from GITHUB_WEBHOOK_SECRET env var (no /etc/dev-webhook-secret)
- MANAGER_CMD env points at /opt/scripts/dev-server-manager.sh (mounted from
  ~/devbox/scripts/ on Mac); when unset, dispatch logs a no-op
- Production-deploy logic removed (production stays on the droplet)

Key keying decision: dev servers are PER BRANCH (not per author). Authors are
ignored entirely. Push to <branch> -> `upsert <branch>`. Branch delete (via
`delete` event OR a `push` payload with deleted=true) -> `destroy <branch>`.
The 'main' branch is skipped on both paths (the manager also enforces this).
"""
import hashlib, hmac, http.server, json, logging, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

PORT = 9091
SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET", "").encode()
MANAGER_CMD = os.environ.get("MANAGER_CMD", "")
SKIP_BRANCHES = {"main"}

# Bound concurrent manager invocations so a flurry of pushes can't spawn dozens
# of 600s subprocess.run() handlers. Per-slug serialization still happens via
# flock inside dev-server-manager.sh.
DISPATCH_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="dispatch")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("webhook")

if not SECRET:
    log.error("GITHUB_WEBHOOK_SECRET not set")
    sys.exit(1)


def verify_signature(payload, signature):
    if not signature.startswith("sha256="):
        return False
    expected = hmac.new(SECRET, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)


def get_branch(payload):
    ref = payload.get("ref", "")
    return ref[len("refs/heads/"):] if ref.startswith("refs/heads/") else None


def run_manager(action, branch):
    """Run `dev-server-manager.sh <action> <branch>` in a worker thread."""
    if not MANAGER_CMD:
        log.info(f"NO-OP (MANAGER_CMD unset): would {action} branch={branch}")
        return
    log.info(f"Triggering {action}: branch={branch}")
    try:
        r = subprocess.run(
            ["bash", MANAGER_CMD, action, branch],
            capture_output=True, text=True, timeout=600,
        )
        if r.returncode == 0:
            log.info(f"{action} OK for {branch}: {r.stdout[-200:]}")
        else:
            log.error(f"{action} FAIL for {branch}: {r.stderr[-500:]}")
    except subprocess.TimeoutExpired:
        log.error(f"{action} timed out for {branch}")
    except Exception as e:
        log.error(f"{action} error for {branch}: {e}")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/github":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length", 0))
        if n > 10 * 1024 * 1024:
            self.send_error(413)
            return
        body = self.rfile.read(n)
        sig = self.headers.get("X-Hub-Signature-256", "")
        if not verify_signature(body, sig):
            log.warning(f"Bad signature from {self.client_address[0]}")
            self.send_error(403)
            return
        ev = self.headers.get("X-GitHub-Event", "")
        if ev == "ping":
            log.info("ping")
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "pong"}')
            return
        try:
            p = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400)
            return

        if ev == "push":
            self._handle_push(p)
            return
        if ev == "delete":
            self._handle_delete(p)
            return

        self.send_response(200); self.end_headers()
        self.wfile.write(b'{"status": "ignored"}')

    def _handle_push(self, p):
        branch = get_branch(p)
        if not branch:
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "no branch"}')
            return
        if branch in SKIP_BRANCHES:
            log.info(f"Push to skipped branch {branch}; ignoring")
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "skipped branch"}')
            return
        # `push` with deleted=true fires when a branch is deleted via `git push
        # --delete`; GitHub also sends a separate `delete` event. Handle both.
        if p.get("deleted"):
            log.info(f"Push payload signals deletion of branch {branch}; destroying")
            self.send_response(202); self.end_headers()
            self.wfile.write(json.dumps({
                "status": "accepted", "action": "destroy", "branch": branch,
            }).encode())
            DISPATCH_POOL.submit(run_manager, "destroy", branch)
            return
        log.info(f"Push to {branch}")
        self.send_response(202); self.end_headers()
        self.wfile.write(json.dumps({
            "status": "accepted", "action": "upsert", "branch": branch,
        }).encode())
        DISPATCH_POOL.submit(run_manager, "upsert", branch)

    def _handle_delete(self, p):
        # GitHub `delete` event fires for branch + tag deletions; we only care
        # about branches. `ref` is the branch name (no refs/heads/ prefix).
        if p.get("ref_type") != "branch":
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "ignored (not a branch)"}')
            return
        branch = p.get("ref", "")
        if not branch:
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "no branch"}')
            return
        if branch in SKIP_BRANCHES:
            log.info(f"Delete event for skipped branch {branch}; ignoring")
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "skipped branch"}')
            return
        log.info(f"Delete event for branch {branch}")
        self.send_response(202); self.end_headers()
        self.wfile.write(json.dumps({
            "status": "accepted", "action": "destroy", "branch": branch,
        }).encode())
        DISPATCH_POOL.submit(run_manager, "destroy", branch)

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "ok"}')
            return
        self.send_error(404)

    def log_message(self, fmt, *args):
        pass


def main():
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    log.info(f"Webhook listening on 0.0.0.0:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
