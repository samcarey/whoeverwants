#!/usr/bin/env python3
"""
GitHub webhook handler for the Mac mini Colima VM.

Listens on 0.0.0.0:9091 inside its container; Caddy on the Mac terminates TLS at
webhook.dev.whoeverwants.com and reverse-proxies here. HMAC-SHA256 signature
verification, JSON push event parsing, dispatches to dev-server-manager (when
MANAGER_CMD is set) in a background thread.

Adapted from scripts/dev-webhook.py (the droplet's version). Differences:
- Binds 0.0.0.0 (Docker port-publishing requires this; the droplet ran on the
  host network so 127.0.0.1 was fine)
- Secret comes from GITHUB_WEBHOOK_SECRET env var (no /etc/dev-webhook-secret)
- MANAGER_CMD env points at /opt/scripts/dev-server-manager.sh (mounted from
  ~/devbox/scripts/ on Mac); when unset, trigger_upsert logs a no-op
- Production-deploy logic removed (production stays on the droplet)
"""
import hashlib, hmac, http.server, json, logging, os, subprocess, sys, threading

PORT = 9091
SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET", "").encode()
MANAGER_CMD = os.environ.get("MANAGER_CMD", "")
IGNORE_PATTERNS = ["@anthropic.com", "noreply@github.com", "actions@github.com"]

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


def is_ignored(email):
    el = email.lower()
    return any(p in el for p in IGNORE_PATTERNS)


def extract_emails(payload):
    emails = set()
    for c in payload.get("commits", []):
        e = c.get("author", {}).get("email", "")
        if e and not is_ignored(e):
            emails.add(e)
    head = payload.get("head_commit", {})
    if head:
        e = head.get("author", {}).get("email", "")
        if e and not is_ignored(e):
            emails.add(e)
    return emails


def get_branch(payload):
    ref = payload.get("ref", "")
    return ref[len("refs/heads/"):] if ref.startswith("refs/heads/") else None


def trigger_upsert(email, branch):
    if not MANAGER_CMD:
        log.info(f"NO-OP (MANAGER_CMD unset): would upsert email={email} branch={branch}")
        return
    log.info(f"Triggering upsert: email={email} branch={branch}")
    try:
        r = subprocess.run(
            ["bash", MANAGER_CMD, "upsert", email, branch],
            capture_output=True, text=True, timeout=600,
        )
        if r.returncode == 0:
            log.info(f"Upsert OK for {email}: {r.stdout[-200:]}")
        else:
            log.error(f"Upsert FAIL for {email}: {r.stderr[-500:]}")
    except subprocess.TimeoutExpired:
        log.error(f"Upsert timed out for {email}")
    except Exception as e:
        log.error(f"Upsert error for {email}: {e}")


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
        if ev != "push":
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "ignored"}')
            return
        try:
            p = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400)
            return
        branch = get_branch(p)
        if not branch:
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "no branch"}')
            return
        if p.get("deleted"):
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "deleted"}')
            return
        emails = extract_emails(p)
        if not emails:
            self.send_response(200); self.end_headers()
            self.wfile.write(b'{"status": "no authors"}')
            return
        log.info(f"Push to {branch} by {emails}")
        self.send_response(202); self.end_headers()
        self.wfile.write(json.dumps({
            "status": "accepted", "branch": branch, "authors": list(emails),
        }).encode())
        for e in emails:
            threading.Thread(target=trigger_upsert, args=(e, branch), daemon=True).start()

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
