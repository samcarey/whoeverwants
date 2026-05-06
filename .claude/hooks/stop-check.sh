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

notify() {
  [[ -z "${NTFY_TOPIC:-}" ]] && return 0
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

# Uncommitted changes (staged or unstaged).
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "There are uncommitted changes in the repository. Please commit and push these changes to the remote branch." >&2
  exit 2
fi

# Untracked files (excluding gitignored).
untracked_files=$(git ls-files --others --exclude-standard)
if [[ -n "$untracked_files" ]]; then
  echo "There are untracked files in the repository. Please commit and push these changes to the remote branch." >&2
  exit 2
fi

# Unpushed commits on the current branch.
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
