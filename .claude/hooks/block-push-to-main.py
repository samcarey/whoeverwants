#!/usr/bin/env python3
"""
PreToolUse hook on Bash: blocks `git push` commands that target the main branch.

Intended as a fast-fail guardrail. The real enforcement is GitHub branch protection
on origin/main (which rejects the push server-side). This hook catches the mistake
earlier so the assistant doesn't hit the network with a doomed push.

Detects:
  - git push origin main
  - git push origin main:main
  - git push origin HEAD:main
  - git push origin HEAD:refs/heads/main
  - git push --force origin main (any flag form)
  - git push (no args) when current branch is main, or upstream is origin/main

Does NOT attempt to catch every obscure form — regex on shell strings is best-effort.
Anything it misses is caught by GitHub's branch protection anyway.
"""
import json
import re
import subprocess
import sys


def current_branch_is_main() -> bool:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=2,
        )
        return r.returncode == 0 and r.stdout.strip() == "main"
    except Exception:
        return False


def upstream_is_origin_main() -> bool:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
            capture_output=True, text=True, timeout=2,
        )
        return r.returncode == 0 and r.stdout.strip() in ("origin/main", "refs/remotes/origin/main")
    except Exception:
        return False


def push_targets_main(push_args: str) -> bool:
    """Given the arg string after 'git push', return True if it targets main."""
    # Tokenize
    tokens = push_args.strip().split()
    # Drop flags (including --force, --force-with-lease=foo, -u, etc.)
    positional = [t for t in tokens if not t.startswith("-")]

    # Explicit refspec forms: positional[1:] are refspecs
    # e.g. ['origin', 'main'] or ['origin', 'HEAD:main'] or ['origin', 'main:main']
    refspecs = positional[1:] if len(positional) >= 2 else []

    for ref in refspecs:
        # Strip leading '+' (force push marker)
        r = ref.lstrip("+")
        # Target is after the last ':' (for src:dst form), else the whole thing
        target = r.rsplit(":", 1)[-1]
        # Normalize refs/heads/main -> main
        if target.startswith("refs/heads/"):
            target = target[len("refs/heads/"):]
        if target == "main":
            return True

    # No explicit refspecs: `git push` or `git push origin` — depends on current branch/upstream
    if not refspecs:
        if current_branch_is_main() or upstream_is_origin_main():
            return True

    return False


def command_pushes_to_main(cmd: str) -> bool:
    """Scan a shell command string for any `git push` invocation targeting main."""
    # Match 'git push' possibly preceded by flags like 'git -C foo push'.
    # The capture group collects everything after 'push' up to the next shell separator.
    pattern = re.compile(r"\bgit\b(?:\s+-[A-Za-z0-9=/._\-]+)*\s+push\b([^;&|()]*)")
    for m in pattern.finditer(cmd):
        if push_targets_main(m.group(1)):
            return True
    return False


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        # Malformed input — don't block
        return 0

    cmd = payload.get("tool_input", {}).get("command", "")
    if not cmd or "git" not in cmd or "push" not in cmd:
        return 0

    if command_pushes_to_main(cmd):
        out = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    "BLOCKED: direct push to main is not allowed. "
                    "Push to a feature branch and open a PR."
                ),
            }
        }
        print(json.dumps(out))
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
