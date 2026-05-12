#!/usr/bin/env python3
"""
Command-execution HTTP server for the Mac mini Colima VM.

Listens on 0.0.0.0:9090 inside its container; Caddy on the Mac terminates TLS at
cmd-api.dev.whoeverwants.com and reverse-proxies here. Bearer-token auth, per-IP
rate limit (60/min), and a JSON request/response shape mirroring the droplet's
/opt/cmd-api.py for compatibility with scripts/remote.sh.

Request:  POST / with Authorization: Bearer <token>
          Body: {"cmd": "...", "cwd": "/root", "timeout": 120}
Response: 200 with {"exit_code": int, "stdout": str, "stderr": str}
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
from collections import defaultdict
import json, subprocess, os, datetime, time

SECRET = os.environ.get("API_SECRET", "")

REQUEST_LOG = defaultdict(list)
MAX_REQUESTS_PER_MINUTE = 60


def _check_rate_limit(ip):
    now = time.time()
    REQUEST_LOG[ip] = [t for t in REQUEST_LOG[ip] if now - t < 60]
    if len(REQUEST_LOG[ip]) >= MAX_REQUESTS_PER_MINUTE:
        return True
    REQUEST_LOG[ip].append(now)
    return False


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        timestamp = datetime.datetime.now().isoformat()
        client_ip = self.client_address[0]

        if _check_rate_limit(client_ip):
            print(f"[{timestamp}] RATE LIMITED {client_ip}", flush=True)
            self.send_response(429)
            self.send_header("Retry-After", "60")
            self.end_headers()
            self.wfile.write(b"rate limited")
            return

        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {SECRET}":
            print(f"[{timestamp}] AUTH FAILURE from {client_ip}", flush=True)
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"forbidden")
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        cmd = body.get("cmd", "echo no command")
        cwd = body.get("cwd", "/root")
        timeout = body.get("timeout", 120)
        print(f"[{timestamp}] {client_ip} CMD: {cmd[:200]}", flush=True)
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                timeout=timeout, cwd=cwd,
            )
            resp = {
                "exit_code": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        except subprocess.TimeoutExpired:
            resp = {"exit_code": -1, "stdout": "", "stderr": "timeout"}
        except Exception as e:
            resp = {"exit_code": -1, "stdout": "", "stderr": str(e)}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(resp).encode())

    def log_message(self, format, *args):
        timestamp = datetime.datetime.now().isoformat()
        print(f"[{timestamp}] {self.client_address[0]} {format % args}", flush=True)


HTTPServer(("0.0.0.0", 9090), Handler).serve_forever()
