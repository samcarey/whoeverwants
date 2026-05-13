#!/usr/bin/env python3
"""
GitHub webhook handler for the WhoeverWants droplets.

One service runs on both the prod droplet and the "latest" (pre-prod canary)
droplet. Behavior is gated by the deployment label in /etc/droplet-label:

  label = "latest" → push to main triggers a deploy from main HEAD;
                     release events are ignored.
  label = ""       → release events (action="published") trigger a deploy
                     pinned to the released tag's commit;
                     push to main is ignored.

In both cases:
- Non-main pushes are ignored (dev servers now run on the Mac mini, which
  has its own webhook).
- Deleted branches are ignored.
- Ping events return pong.

Runs as a systemd service, listening on port 9091. Caddy proxies the
public hooks.* hostname to 127.0.0.1:9091.

Security: Verifies GitHub webhook signatures (HMAC-SHA256).
"""

import hashlib
import hmac
import http.server
import json
import logging
import os
import subprocess
import sys
import threading

PORT = 9091
SECRET_FILE = "/etc/dev-webhook-secret"
LABEL_FILE = "/etc/droplet-label"
REPO_DIR = "/root/whoeverwants"
DEPLOY_LOCK = "/tmp/production-deploy.lock"

# Claude/bot email patterns to ignore
IGNORE_PATTERNS = [
    "@anthropic.com",
    "noreply@github.com",
    "actions@github.com",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("/var/log/dev-webhook.log"),
    ],
)
log = logging.getLogger("dev-webhook")


def load_secret() -> bytes:
    """Load the webhook secret from file."""
    try:
        with open(SECRET_FILE, "r") as f:
            return f.read().strip().encode()
    except FileNotFoundError:
        log.error(f"Webhook secret file not found: {SECRET_FILE}")
        log.error("Generate one with: python3 -c \"import secrets; print(secrets.token_urlsafe(32))\" > /etc/dev-webhook-secret")
        sys.exit(1)


SECRET = load_secret()


def load_droplet_label() -> str:
    """Read /etc/droplet-label. Empty / missing → prod. 'latest' → pre-prod canary."""
    try:
        with open(LABEL_FILE, "r") as f:
            label = f.read().strip()
    except FileNotFoundError:
        return ""
    if label not in ("", "latest"):
        log.warning(f"Unknown droplet label {label!r}; treating as prod")
        return ""
    return label


DROPLET_LABEL = load_droplet_label()
log.info(f"Droplet label: {DROPLET_LABEL!r} ({'latest canary' if DROPLET_LABEL == 'latest' else 'production'})")


def verify_signature(payload: bytes, signature: str) -> bool:
    """Verify GitHub webhook HMAC-SHA256 signature."""
    if not signature.startswith("sha256="):
        return False
    expected = hmac.new(SECRET, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)


def is_ignored_email(email: str) -> bool:
    """Check if an email should be ignored."""
    email_lower = email.lower()
    for pattern in IGNORE_PATTERNS:
        if pattern in email_lower:
            return True
    return False


def extract_author_emails(payload: dict) -> set[str]:
    """Extract unique non-bot author emails from a push event."""
    emails = set()

    # Get author emails from all commits in the push
    for commit in payload.get("commits", []):
        author = commit.get("author", {})
        email = author.get("email", "")
        if email and not is_ignored_email(email):
            emails.add(email)

    # Also check head_commit
    head = payload.get("head_commit", {})
    if head:
        author = head.get("author", {})
        email = author.get("email", "")
        if email and not is_ignored_email(email):
            emails.add(email)

    return emails


def get_branch(payload: dict) -> str | None:
    """Extract branch name from push event ref."""
    ref = payload.get("ref", "")
    if ref.startswith("refs/heads/"):
        return ref[len("refs/heads/"):]
    return None


def deploy_production(tag: str | None = None):
    """Pull and rebuild the backend.

    tag=None  → fast-forward `main` (latest-canary behavior).
    tag=<v*>  → fetch tags and `git checkout <tag>` so the deploy is pinned
                to the exact released commit (prod release behavior).
    """
    import fcntl

    label = "release" if tag else "main"
    log.info(f"=== Deploy triggered (label={DROPLET_LABEL or 'prod'}, source={label}, tag={tag}) ===")

    # Acquire lock to prevent concurrent deploys
    try:
        lock_fd = open(DEPLOY_LOCK, "w")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (IOError, OSError):
        log.info("Deploy already in progress, skipping")
        return

    try:
        # 1. Update the working tree to the deploy target.
        if tag is None:
            log.info("--- Pulling latest main ---")
            result = subprocess.run(
                ["git", "pull", "origin", "main"],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode != 0:
                log.error(f"Git pull failed: {result.stderr}")
                return
            log.info(f"Git pull: {result.stdout.strip()}")
            if "Already up to date" in result.stdout:
                log.info("No changes, skipping rebuild")
                return
        else:
            log.info(f"--- Fetching tags and checking out {tag} ---")
            fetch = subprocess.run(
                ["git", "fetch", "--tags", "--force", "origin"],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                timeout=60,
            )
            if fetch.returncode != 0:
                log.error(f"Git fetch failed: {fetch.stderr}")
                return
            checkout = subprocess.run(
                ["git", "checkout", "--force", f"tags/{tag}"],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                timeout=60,
            )
            if checkout.returncode != 0:
                log.error(f"Git checkout {tag} failed: {checkout.stderr}")
                return
            log.info(f"Checked out tag {tag}")

        # 2. Check if server/ files changed (optimize: skip rebuild if only frontend changed)
        # Always rebuild to be safe — Docker layer caching makes no-op rebuilds fast
        log.info("--- Rebuilding and restarting Docker services ---")
        result = subprocess.run(
            ["docker", "compose", "up", "-d", "--build"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout for build
        )
        if result.returncode != 0:
            log.error(f"Docker compose build failed: {result.stderr[-500:]}")
            return
        log.info(f"Docker compose: {result.stderr.strip()[-300:]}")

        # 3. Apply any new database migrations
        log.info("--- Checking for new migrations ---")
        migrations_dir = os.path.join(REPO_DIR, "database", "migrations")
        result = subprocess.run(
            ["bash", os.path.join(REPO_DIR, "scripts", "apply-migrations.sh"),
             "whoeverwants", migrations_dir],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            log.warning(f"Migration check: {result.stderr[-300:]}")
        else:
            log.info(f"Migrations: {result.stdout.strip()[-200:]}")

        # 4. Verify health
        import urllib.request
        try:
            resp = urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=10)
            if resp.status == 200:
                log.info(f"=== Deploy complete (label={DROPLET_LABEL or 'prod'}, source={label}) — health OK ===")
            else:
                log.error(f"Health check returned {resp.status}")
        except Exception as e:
            log.error(f"Health check failed: {e}")

    except subprocess.TimeoutExpired as e:
        log.error(f"Deploy timed out: {e}")
    except Exception as e:
        log.error(f"Deploy error: {e}")
    finally:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            lock_fd.close()
        except Exception:
            pass



class WebhookHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/github":
            self.send_error(404)
            return

        # Read body
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 10 * 1024 * 1024:  # 10MB limit
            self.send_error(413, "Payload too large")
            return
        body = self.rfile.read(content_length)

        # Verify signature
        signature = self.headers.get("X-Hub-Signature-256", "")
        if not verify_signature(body, signature):
            log.warning(f"Invalid signature from {self.client_address[0]}")
            self.send_error(403, "Invalid signature")
            return

        # Parse event
        event = self.headers.get("X-GitHub-Event", "")
        if event == "ping":
            log.info("Received ping event")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status": "pong"}')
            return

        # Parse JSON body once (push and release events both use JSON).
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        # ── Release events (prod tier only) ──────────────────────────
        if event == "release":
            if DROPLET_LABEL == "latest":
                log.info("Release event ignored on latest tier")
                self.send_response(200); self.end_headers()
                self.wfile.write(b'{"status": "release ignored on latest"}')
                return
            action = payload.get("action", "")
            if action != "published":
                log.info(f"Release event with action={action!r}, ignoring (only 'published' triggers deploy)")
                self.send_response(200); self.end_headers()
                self.wfile.write(b'{"status": "release action ignored"}')
                return
            release = payload.get("release", {}) or {}
            if release.get("draft") or release.get("prerelease"):
                log.info("Release is draft/prerelease, ignoring")
                self.send_response(200); self.end_headers()
                self.wfile.write(b'{"status": "draft/prerelease ignored"}')
                return
            tag = release.get("tag_name") or ""
            if not tag:
                log.warning("Release published event has no tag_name; ignoring")
                self.send_response(400); self.end_headers()
                self.wfile.write(b'{"status": "no tag_name"}')
                return
            log.info(f"Release published: tag={tag}")
            self.send_response(202); self.end_headers()
            self.wfile.write(json.dumps({
                "status": "accepted",
                "action": "production_deploy",
                "tag": tag,
            }).encode())
            t = threading.Thread(target=deploy_production, kwargs={"tag": tag})
            t.daemon = True
            t.start()
            return

        if event != "push":
            log.info(f"Ignoring event type: {event}")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status": "ignored"}')
            return

        branch = get_branch(payload)
        if not branch:
            log.info("Push event without branch ref, ignoring")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status": "no branch"}')
            return

        # Skip deleted branches
        if payload.get("deleted", False):
            log.info(f"Branch {branch} deleted, ignoring")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status": "branch deleted"}')
            return

        # Extract author emails (for logging only; we no longer spawn dev
        # servers from the droplet — those run on the Mac mini).
        emails = extract_author_emails(payload)
        log.info(f"Push to {branch} by {emails or '(no non-bot authors)'}")

        # Respond immediately, process in background
        self.send_response(202)
        self.end_headers()

        # Push to main → deploy ONLY on the latest tier. Prod waits for a
        # release event instead.
        if branch == "main":
            if DROPLET_LABEL == "latest":
                self.wfile.write(json.dumps({
                    "status": "accepted",
                    "branch": branch,
                    "action": "latest_deploy",
                }).encode())
                t = threading.Thread(target=deploy_production)
                t.daemon = True
                t.start()
                return
            self.wfile.write(json.dumps({
                "status": "ignored",
                "branch": branch,
                "reason": "prod tier deploys on release event, not push to main",
            }).encode())
            return

        # Non-main pushes: dev servers live on the Mac mini now; nothing to do.
        self.wfile.write(json.dumps({
            "status": "accepted",
            "branch": branch,
            "action": "ignored (dev servers run on Mac mini)",
        }).encode())

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status": "ok"}')
            return
        self.send_error(404)

    def log_message(self, format, *args):
        # Suppress default access log, we use our own logging
        pass


def main():
    server = http.server.HTTPServer(("127.0.0.1", PORT), WebhookHandler)
    log.info(f"Dev webhook handler listening on 127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
