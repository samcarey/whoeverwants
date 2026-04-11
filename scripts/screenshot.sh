#!/usr/bin/env bash
# scripts/screenshot.sh — Take screenshots of pages on the droplet and serve them
#
# Usage:
#   bash scripts/screenshot.sh <action> [options]
#
# Actions:
#   take   <port> <path> <name> [--width W] [--height H] [--wait MS] [--serve-slug SLUG]
#          Take a screenshot of http://localhost:<port><path> on the droplet.
#          Saves to /tmp/<name>.png locally (for Claude Read tool assessment).
#          If --serve-slug is given, also copies to that dev server's public/screenshots/.
#
#   serve  <name> <slug>
#          Copy an already-taken screenshot (/tmp/<name>.png on droplet) to a dev server.
#
#   url    <name> <slug>
#          Print the public URL for a served screenshot.
#
#   assess <name>
#          Print the local path for Claude to read and assess the screenshot.
#
#   compare <before-name> <after-name> <slug>
#          Print both URLs side-by-side for review.
#
# Examples:
#   # Take a screenshot of the home page on dev server port 3002
#   bash scripts/screenshot.sh take 3002 / home-before
#
#   # Take with custom viewport and serve to dev server
#   bash scripts/screenshot.sh take 3002 /p/abc123 poll-before --width 430 --height 932 --serve-slug sam-at-samcarey-com
#
#   # Serve a previously taken screenshot
#   bash scripts/screenshot.sh serve poll-before sam-at-samcarey-com
#
#   # Get the assessment path (for Claude Read tool)
#   bash scripts/screenshot.sh assess poll-before
#   # → /tmp/poll-before.png

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE="$SCRIPT_DIR/remote.sh"

REMOTE_DIR="/tmp/screenshots"
DEFAULT_WIDTH=430
DEFAULT_HEIGHT=932
DEFAULT_WAIT=2000

# Validate name/slug contain only safe characters (alphanumeric, hyphens, underscores)
validate_safe_string() {
    local label="$1" value="$2"
    if [[ ! "$value" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        echo "ERROR: ${label} contains unsafe characters: ${value}" >&2
        echo "Only alphanumeric, hyphens, and underscores are allowed." >&2
        exit 1
    fi
}

screenshot_url() {
    local slug="$1" name="$2"
    echo "https://${slug}.dev.whoeverwants.com/screenshots/${name}.png"
}

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
    exit 1
}

take_screenshot() {
    local port="$1"; shift
    local path="$1"; shift
    local name="$1"; shift

    validate_safe_string "name" "$name"

    local width=$DEFAULT_WIDTH
    local height=$DEFAULT_HEIGHT
    local wait=$DEFAULT_WAIT
    local serve_slug=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --width)  width="$2"; shift 2 ;;
            --height) height="$2"; shift 2 ;;
            --wait)   wait="$2"; shift 2 ;;
            --serve-slug) serve_slug="$2"; shift 2 ;;
            *) echo "Unknown option: $1"; exit 1 ;;
        esac
    done

    local url="http://localhost:${port}${path}"
    local remote_path="${REMOTE_DIR}/${name}.png"
    local serve_cmd=""

    # If serving, copy to the STANDALONE public dir (not the repo's public dir).
    # The standalone Next.js server serves files from .next/standalone/public/,
    # and it scans that directory at startup — so we also need to restart the
    # frontend process to make the new file visible. See scripts/dev-server-manager.sh
    # restart-frontend command.
    if [[ -n "$serve_slug" ]]; then
        validate_safe_string "slug" "$serve_slug"
        local public_dir="/root/dev-servers/${serve_slug}/.next/standalone/public/screenshots"
        serve_cmd=" && mkdir -p ${public_dir} && cp ${remote_path} ${public_dir}/${name}.png && bash /root/whoeverwants/scripts/dev-server-manager.sh restart-frontend ${serve_slug}"
    fi

    echo "Taking screenshot: ${url} (${width}x${height}, wait ${wait}ms)..."

    bash "$REMOTE" "mkdir -p ${REMOTE_DIR} && cd /root/whoeverwants && node -e \"
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: ${width}, height: ${height} } });
  await page.goto('${url}', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(${wait});
  await page.screenshot({ path: '${remote_path}', fullPage: false });
  console.log('Screenshot saved: ${remote_path}');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
\"${serve_cmd}" /root 60

    echo "Transferring to local machine..."
    local b64
    b64=$(bash "$REMOTE" "base64 -w0 ${remote_path}" /root 15)

    if [[ -z "$b64" ]]; then
        echo "ERROR: Failed to transfer screenshot" >&2
        exit 1
    fi

    echo "$b64" | base64 -d > "/tmp/${name}.png"
    echo "Local: /tmp/${name}.png"

    if [[ -n "$serve_slug" ]]; then
        echo "URL: $(screenshot_url "$serve_slug" "$name")"
    fi
}

serve_screenshot() {
    local name="$1" slug="$2"
    validate_safe_string "name" "$name"
    validate_safe_string "slug" "$slug"

    # Standalone Next.js serves static files from .next/standalone/public/ and
    # caches the directory listing at startup, so new files require a frontend
    # restart to become visible.
    local public_dir="/root/dev-servers/${slug}/.next/standalone/public/screenshots"

    echo "Serving screenshot to ${slug}..."
    bash "$REMOTE" "mkdir -p ${public_dir} && cp ${REMOTE_DIR}/${name}.png ${public_dir}/${name}.png && bash /root/whoeverwants/scripts/dev-server-manager.sh restart-frontend ${slug}" /root 30
    echo "URL: $(screenshot_url "$slug" "$name")"
}

compare_screenshots() {
    local before="$1" after="$2" slug="$3"

    echo "=== Screenshot Comparison ==="
    echo "Before: $(screenshot_url "$slug" "$before")"
    echo "After:  $(screenshot_url "$slug" "$after")"
    echo ""
    echo "Local assessment:"
    echo "  Before: /tmp/${before}.png"
    echo "  After:  /tmp/${after}.png"
}

case "${1:-}" in
    take)    shift; take_screenshot "$@" ;;
    serve)   shift; serve_screenshot "$@" ;;
    url)     shift; screenshot_url "$2" "$1" ;;
    assess)  shift; echo "/tmp/${1}.png" ;;
    compare) shift; compare_screenshots "$@" ;;
    *)       usage ;;
esac
