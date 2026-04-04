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

# Default viewport (iPhone 14 Pro Max)
DEFAULT_WIDTH=430
DEFAULT_HEIGHT=932
DEFAULT_WAIT=2000

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
    exit 1
}

take_screenshot() {
    local port="$1"; shift
    local path="$1"; shift
    local name="$1"; shift

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
    local remote_path="/tmp/screenshots/${name}.png"

    echo "Taking screenshot: ${url} (${width}x${height}, wait ${wait}ms)..."

    bash "$REMOTE" "mkdir -p /tmp/screenshots && cd /root/whoeverwants && node -e \"
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
\"" /root 30

    # Transfer to local /tmp via base64
    echo "Transferring to local machine..."
    local b64
    b64=$(bash "$REMOTE" "base64 -w0 ${remote_path}" /root 15)

    if [[ -z "$b64" ]]; then
        echo "ERROR: Failed to transfer screenshot" >&2
        exit 1
    fi

    echo "$b64" | base64 -d > "/tmp/${name}.png"
    echo "Local: /tmp/${name}.png"

    # Optionally serve via dev server
    if [[ -n "$serve_slug" ]]; then
        serve_screenshot "$name" "$serve_slug"
    fi
}

serve_screenshot() {
    local name="$1"
    local slug="$2"
    local public_dir="/root/dev-servers/${slug}/public/screenshots"

    echo "Serving screenshot to ${slug}..."
    bash "$REMOTE" "mkdir -p ${public_dir} && cp /tmp/screenshots/${name}.png ${public_dir}/${name}.png" /root 10

    local url="https://${slug}.dev.whoeverwants.com/screenshots/${name}.png"
    echo "URL: ${url}"
}

get_url() {
    local name="$1"
    local slug="$2"
    echo "https://${slug}.dev.whoeverwants.com/screenshots/${name}.png"
}

assess_path() {
    local name="$1"
    echo "/tmp/${name}.png"
}

compare_screenshots() {
    local before="$1"
    local after="$2"
    local slug="$3"

    echo "=== Screenshot Comparison ==="
    echo "Before: https://${slug}.dev.whoeverwants.com/screenshots/${before}.png"
    echo "After:  https://${slug}.dev.whoeverwants.com/screenshots/${after}.png"
    echo ""
    echo "Local assessment:"
    echo "  Before: /tmp/${before}.png"
    echo "  After:  /tmp/${after}.png"
}

# Main dispatch
case "${1:-}" in
    take)    shift; take_screenshot "$@" ;;
    serve)   shift; serve_screenshot "$@" ;;
    url)     shift; get_url "$@" ;;
    assess)  shift; assess_path "$@" ;;
    compare) shift; compare_screenshots "$@" ;;
    *)       usage ;;
esac
