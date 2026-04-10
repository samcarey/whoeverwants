#!/usr/bin/env python3
"""
GitHub webhook handler for the WhoeverWants droplet.

Handles two types of push events:
1. Push to `main` → auto-deploy production backend (git pull + docker compose rebuild)
2. Push to any other branch → update per-branch dev server (standalone build)

Runs as a systemd service on the droplet, listening on port 9091.
Caddy proxies hooks.api.whoeverwants.com -> localhost:9091.

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
MANAGER_SCRIPT = "/root/whoeverwants/scripts/dev-server-manager.sh"
REPO_DIR = "/root/whoeverwants"
DEPLOY_LOCK = "/tmp/production-deploy.lock"

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


def verify_signature(payload: bytes, signature: str) -> bool:
    """Verify GitHub webhook HMAC-SHA256 signature."""
    if not signature.startswith("sha256="):
        return False
    expected = hmac.new(SECRET, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)


# Email patterns to ignore for redirect mapping
IGNORE_EMAIL_PATTERNS = [
    "@anthropic.com",
    "noreply@github.com",
    "actions@github.com",
]


def is_ignored_email(email: str) -> bool:
    """Check if an email should be ignored for redirect mapping."""
    email_lower = email.lower()
    return any(pattern in email_lower for pattern in IGNORE_EMAIL_PATTERNS)


def extract_author_emails(payload: dict) -> set[str]:
    """Extract unique non-bot author emails from a push event."""
    emails = set()
    for commit in payload.get("commits", []):
        email = commit.get("author", {}).get("email", "")
        if email and not is_ignored_email(email):
            emails.add(email)
    head = payload.get("head_commit") or {}
    email = head.get("author", {}).get("email", "")
    if email and not is_ignored_email(email):
        emails.add(email)
    return emails


def get_branch(payload: dict) -> str | None:
    """Extract branch name from push event ref."""
    ref = payload.get("ref", "")
    if ref.startswith("refs/heads/"):
        return ref[len("refs/heads/"):]
    return None


def trigger_upsert(branch: str, emails: set[str]):
    """Run dev-server-manager.sh upsert for a branch, then set up email redirects."""
    log.info(f"Triggering upsert: branch={branch}")
    try:
        result = subprocess.run(
            ["bash", MANAGER_SCRIPT, "upsert", branch],
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout for npm ci + build
        )
        if result.returncode == 0:
            log.info(f"Upsert succeeded for {branch}: {result.stdout[-200:] if result.stdout else '(no output)'}")
        else:
            log.error(f"Upsert failed for {branch}: {result.stderr[-500:] if result.stderr else '(no stderr)'}")
    except subprocess.TimeoutExpired:
        log.error(f"Upsert timed out for {branch}")
        return
    except Exception as e:
        log.error(f"Upsert error for {branch}: {e}")
        return

    # Set up email-slug -> branch-slug redirects for backward compatibility
    for email in emails:
        try:
            result = subprocess.run(
                ["bash", MANAGER_SCRIPT, "redirect", email, branch],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode != 0:
                log.warning(f"Redirect setup failed for {email}: {result.stderr[-200:]}")
        except Exception as e:
            log.warning(f"Redirect error for {email}: {e}")


def deploy_production():
    """Pull latest main and rebuild production backend."""
    import fcntl

    log.info("=== Production deploy triggered (push to main) ===")

    # Acquire lock to prevent concurrent deploys
    try:
        lock_fd = open(DEPLOY_LOCK, "w")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (IOError, OSError):
        log.info("Production deploy already in progress, skipping")
        return

    try:
        # 1. Fetch and reset to origin/main (avoids diverged branch issues)
        log.info("--- Fetching latest main ---")
        result = subprocess.run(
            ["git", "fetch", "origin", "main"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            log.error(f"Git fetch failed: {result.stderr}")
            return

        # Check if there are new commits
        result = subprocess.run(
            ["git", "rev-parse", "HEAD", "origin/main"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
        )
        commits = result.stdout.strip().split("\n")
        if len(commits) == 2 and commits[0] == commits[1]:
            log.info("No changes, skipping rebuild")
            return

        log.info("--- Resetting to origin/main ---")
        result = subprocess.run(
            ["git", "checkout", "main"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
        )
        result = subprocess.run(
            ["git", "reset", "--hard", "origin/main"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            log.error(f"Git reset failed: {result.stderr}")
            return
        log.info(f"Reset to: {result.stdout.strip()}")

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

        # 4. Restart webhook service if the webhook script itself changed
        # (The service reads the script at startup, so changes require a restart)
        log.info("--- Restarting webhook service to pick up script changes ---")
        subprocess.run(
            ["systemctl", "restart", "dev-webhook"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        # Note: after restart, this thread is killed. Health check happens in new process.

        # 5. Verify health
        import urllib.request
        try:
            resp = urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=10)
            if resp.status == 200:
                log.info("=== Production deploy complete — health check OK ===")
            else:
                log.error(f"Health check returned {resp.status}")
        except Exception as e:
            log.error(f"Health check failed: {e}")

    except subprocess.TimeoutExpired as e:
        log.error(f"Production deploy timed out: {e}")
    except Exception as e:
        log.error(f"Production deploy error: {e}")
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

        if event != "push":
            log.info(f"Ignoring event type: {event}")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status": "ignored"}')
            return

        # Parse push event
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
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

        # Extract author emails for redirect mapping
        emails = extract_author_emails(payload)
        log.info(f"Push to {branch} by {emails or '(no authors)'}")

        # Respond immediately, process in background
        self.send_response(202)
        self.end_headers()

        # Push to main → deploy production backend
        if branch == "main":
            self.wfile.write(json.dumps({
                "status": "accepted",
                "branch": branch,
                "action": "production_deploy",
            }).encode())
            t = threading.Thread(target=deploy_production)
            t.daemon = True
            t.start()
            return

        self.wfile.write(json.dumps({
            "status": "accepted",
            "branch": branch,
            "authors": list(emails),
        }).encode())

        # Trigger upsert + email redirects in background
        t = threading.Thread(target=trigger_upsert, args=(branch, emails))
        t.daemon = True
        t.start()

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
