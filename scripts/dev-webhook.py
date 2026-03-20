#!/usr/bin/env python3
"""
GitHub webhook handler for per-user dev servers.

Receives push events from GitHub, extracts the commit author email,
and triggers dev-server-manager.sh to create or update the dev server
for that author.

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


def trigger_upsert(email: str, branch: str):
    """Run dev-server-manager.sh upsert in background."""
    log.info(f"Triggering upsert: email={email}, branch={branch}")
    try:
        result = subprocess.run(
            ["bash", MANAGER_SCRIPT, "upsert", email, branch],
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout for npm ci + build
        )
        if result.returncode == 0:
            log.info(f"Upsert succeeded for {email}: {result.stdout[-200:] if result.stdout else '(no output)'}")
        else:
            log.error(f"Upsert failed for {email}: {result.stderr[-500:] if result.stderr else '(no stderr)'}")
    except subprocess.TimeoutExpired:
        log.error(f"Upsert timed out for {email}")
    except Exception as e:
        log.error(f"Upsert error for {email}: {e}")


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

        # Extract author emails
        emails = extract_author_emails(payload)
        if not emails:
            log.info(f"No non-bot author emails in push to {branch}")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status": "no authors"}')
            return

        log.info(f"Push to {branch} by {emails}")

        # Respond immediately, process in background
        self.send_response(202)
        self.end_headers()
        self.wfile.write(json.dumps({
            "status": "accepted",
            "branch": branch,
            "authors": list(emails),
        }).encode())

        # Trigger upsert for each author in background threads
        for email in emails:
            t = threading.Thread(target=trigger_upsert, args=(email, branch))
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
