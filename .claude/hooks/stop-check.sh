#!/bin/bash
# Stop hook for this project. Two responsibilities:
#   1. Block the stop with feedback if there are uncommitted/untracked/unpushed
#      changes, so Claude returns to commit + push before ending the turn.
#   2. Send an ntfy "ready for input" notification ONLY when the tree is clean
#      and everything is pushed (i.e. the stop is actually about to release).
#
# Replaces a separate ntfy-only project hook + a separate user-level
# git-check hook that fired in parallel — which produced a premature
# notification whenever the git-check was about to block the stop.

set -u

# stop_hook_active = true means we're already inside a stop-hook-triggered
# wakeup. Don't re-block or we'll loop.
input=$(cat)
stop_hook_active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo "false")
if [[ "$stop_hook_active" == "true" ]]; then
  exit 0
fi

transcript_path=$(printf '%s' "$input" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")

# Returns 0 (suppress notify) when the most recent user prompt consists ONLY
# of github-webhook-activity events that are all PR-merged or branch-deleted —
# these don't warrant waking the user. Returns 1 (do notify) for direct user
# input, mixed content, or any other webhook event (review comments, CI, etc.).
should_skip_notify_due_to_webhook() {
  [[ -z "$transcript_path" ]] && return 1
  [[ ! -r "$transcript_path" ]] && return 1
  python3 - "$transcript_path" <<'PY' 2>/dev/null
import json, re, sys

path = sys.argv[1]
try:
    with open(path) as f:
        lines = f.readlines()
except Exception:
    sys.exit(1)

# Walk backward to the most recent direct user message (skip tool_result
# entries, which are also type=user but represent tool output, not prompts).
last_user_text = None
for line in reversed(lines):
    try:
        obj = json.loads(line)
    except Exception:
        continue
    if obj.get("type") != "user":
        continue
    msg = obj.get("message") or {}
    content = msg.get("content")
    if isinstance(content, list):
        text_parts = []
        is_tool_result_only = True
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "tool_result":
                continue
            is_tool_result_only = False
            if btype in (None, "text"):
                text_parts.append(block.get("text", "") or "")
        if is_tool_result_only:
            continue
        last_user_text = "".join(text_parts)
    elif isinstance(content, str):
        last_user_text = content
    else:
        continue
    break

if not last_user_text:
    sys.exit(1)

webhook_re = re.compile(
    r"<github-webhook-activity[^>]*>(.*?)</github-webhook-activity>",
    re.DOTALL,
)
matches = webhook_re.findall(last_user_text)

# What's left after stripping webhook + system-reminder tags should be empty
# for the suppression to apply — any direct text means a real user prompt.
remainder = webhook_re.sub("", last_user_text)
remainder = re.sub(
    r"<system-reminder>.*?</system-reminder>", "", remainder, flags=re.DOTALL
)
if remainder.strip():
    sys.exit(1)

if not matches:
    sys.exit(1)

pr_merge_re = re.compile(
    r'"merged"\s*:\s*true'
    r"|merged\s+(?:the\s+)?pull\s+request"
    r"|pull\s+request\s+#?\d+\s+(?:was\s+)?merged",
    re.IGNORECASE,
)
branch_delete_re = re.compile(
    r'"ref_type"\s*:\s*"branch"'
    r"|deleted\s+(?:the\s+)?branch"
    r"|branch\s+\S+\s+(?:was\s+)?deleted",
    re.IGNORECASE,
)

for body in matches:
    if pr_merge_re.search(body):
        continue
    if branch_delete_re.search(body):
        continue
    # Any other webhook event (review comment, CI status, push, etc.) — notify.
    sys.exit(1)

sys.exit(0)
PY
}

notify() {
  [[ -z "${NTFY_TOPIC:-}" ]] && return 0
  if should_skip_notify_due_to_webhook; then
    return 0
  fi
  curl -fsS --max-time 5 \
    -d "Claude is ready for your input" \
    -H "Title: Claude Code" \
    "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1 || true
}

# Outside a git repo: nothing to gate on, just notify.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  notify
  exit 0
fi

# No remote configured: gating on "pushed" is meaningless. Notify and exit.
if [[ -z "$(git remote)" ]]; then
  notify
  exit 0
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "There are uncommitted changes in the repository. Please commit and push these changes to the remote branch." >&2
  exit 2
fi

untracked_files=$(git ls-files --others --exclude-standard)
if [[ -n "$untracked_files" ]]; then
  echo "There are untracked files in the repository. Please commit and push these changes to the remote branch." >&2
  exit 2
fi

current_branch=$(git branch --show-current)
if [[ -n "$current_branch" ]]; then
  if git rev-parse "origin/$current_branch" >/dev/null 2>&1; then
    unpushed=$(git rev-list "origin/$current_branch..HEAD" --count 2>/dev/null) || unpushed=0
    if [[ "$unpushed" -gt 0 ]]; then
      echo "There are $unpushed unpushed commit(s) on branch '$current_branch'. Please push these changes to the remote repository." >&2
      exit 2
    fi
  else
    unpushed=$(git rev-list "origin/HEAD..HEAD" --count 2>/dev/null) || unpushed=0
    if [[ "$unpushed" -gt 0 ]]; then
      echo "Branch '$current_branch' has $unpushed unpushed commit(s) and no remote branch. Please push these changes to the remote repository." >&2
      exit 2
    fi
  fi
fi

notify
exit 0
