#!/bin/bash
# Deploy a preview environment for the current branch.
# Pushes the branch to GitHub (triggering Vercel preview) and creates
# a preview API instance on the droplet.
#
# Usage:
#   bash scripts/deploy-preview.sh              # Use current branch
#   bash scripts/deploy-preview.sh <branch>      # Specify branch
#
# Prerequisites:
#   - DROPLET_API_URL and DROPLET_API_TOKEN environment variables set
#   - *.api.whoeverwants.com wildcard DNS pointing to the droplet

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Determine branch
BRANCH="${1:-$(git branch --show-current)}"

if [ -z "$BRANCH" ] || [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "Error: Cannot create preview for main/master branch."
  echo "Usage: deploy-preview.sh [branch-name]"
  exit 1
fi

# Derive slug (same logic as preview-manager.sh)
SLUG=$(echo "${BRANCH#claude/}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g; s/--*/-/g; s/^-//; s/-$//' | cut -c1-50)

echo "=== Deploying preview ==="
echo "Branch: $BRANCH"
echo "Slug: $SLUG"
echo ""

# 1. Push branch to GitHub (triggers Vercel preview deploy)
echo "--- Pushing branch to GitHub ---"
git push -u origin "$BRANCH"
echo ""

# 2. Create preview API on droplet
echo "--- Creating preview API on droplet ---"
bash "$SCRIPT_DIR/remote.sh" \
  "cd /root/whoeverwants && git fetch origin $BRANCH && bash scripts/preview-manager.sh create $BRANCH" \
  /root 300

echo ""
echo "=== Preview deployed ==="
echo "  Frontend: (Vercel preview - check Vercel dashboard for URL)"
echo "  API:      https://${SLUG}.api.whoeverwants.com"
echo ""
echo "The Vercel preview will automatically use the preview API based on the branch name."
