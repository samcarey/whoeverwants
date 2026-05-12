#!/usr/bin/env bash
# scripts/screenshot.sh — Take screenshots of dev pages and serve them
#
# Usage:
#   bash scripts/screenshot.sh <action> [options]
#
# Actions:
#   take   <slug> <path> <name> [--width W] [--height H] [--wait MS] [--no-serve]
#          Take a screenshot of https://<slug>.dev.whoeverwants.com<path>.
#          Playwright runs on the droplet (which has it pre-installed) and
#          hits the public Mac-mini dev URL; the PNG is transferred locally
#          to /tmp/<name>.png and (by default) served via the Mac dev
#          container's /repo/public/screenshots/. Pass --no-serve to skip
#          the serve step.
#
#   serve  <name> <slug>
#          Copy an already-taken screenshot (/tmp/<name>.png locally) to a
#          Mac dev server's public/screenshots/ dir so it's reachable at
#          https://<slug>.dev.whoeverwants.com/screenshots/<name>.png.
#
#   url    <slug> <name>
#          Print the public URL for a served screenshot.
#
#   assess <name>
#          Print the local path for Claude to read and assess the screenshot.
#
#   compare <before-name> <after-name> <slug>
#          Print both URLs side-by-side for review.
#
# Examples:
#   # Take + serve a screenshot of the home page on the current branch's dev server
#   bash scripts/screenshot.sh take claude-my-branch / home-before
#
#   # Take with custom viewport, no serve
#   bash scripts/screenshot.sh take claude-my-branch /g/abc123 group-before --width 430 --height 932 --no-serve
#
#   # Serve a previously taken screenshot
#   bash scripts/screenshot.sh serve poll-before claude-my-branch

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE="$SCRIPT_DIR/remote.sh"
REMOTE_MAC="$SCRIPT_DIR/remote-mac.sh"

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

# Write a local PNG into the Mac dev container's /repo/public/screenshots/.
# Next.js dev serves /public/ at request time — no restart needed.
serve_to_mac() {
    local name="$1" slug="$2" local_path="$3"
    local container="whoeverwants-dev-${slug}"
    local b64
    b64=$(base64 -w0 "$local_path")
    bash "$REMOTE_MAC" "docker exec ${container} sh -c 'mkdir -p /repo/public/screenshots && echo ${b64} | base64 -d > /repo/public/screenshots/${name}.png'" / 30
}

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
    exit 1
}

take_screenshot() {
    local slug="$1"; shift
    local path="$1"; shift
    local name="$1"; shift

    validate_safe_string "slug" "$slug"
    validate_safe_string "name" "$name"

    local width=$DEFAULT_WIDTH
    local height=$DEFAULT_HEIGHT
    local wait=$DEFAULT_WAIT
    local no_serve=0

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --width)    width="$2"; shift 2 ;;
            --height)   height="$2"; shift 2 ;;
            --wait)     wait="$2"; shift 2 ;;
            --no-serve) no_serve=1; shift ;;
            *) echo "Unknown option: $1"; exit 1 ;;
        esac
    done

    local url="https://${slug}.dev.whoeverwants.com${path}"
    local remote_path="${REMOTE_DIR}/${name}.png"

    echo "Taking screenshot: ${url} (${width}x${height}, wait ${wait}ms)..."

    # Droplet hosts Playwright + Chromium; it hits the public Mac dev URL.
    bash "$REMOTE" "mkdir -p ${REMOTE_DIR} && cd /root/whoeverwants && node -e \"
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: ${width}, height: ${height} } });
  await page.goto('${url}', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(${wait});
  await page.screenshot({ path: '${remote_path}', fullPage: false });
  console.log('Screenshot saved: ${remote_path}');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
\"" /root 60

    echo "Transferring to local machine..."
    local b64
    b64=$(bash "$REMOTE" "base64 -w0 ${remote_path}" /root 15)

    if [[ -z "$b64" ]]; then
        echo "ERROR: Failed to transfer screenshot" >&2
        exit 1
    fi

    echo "$b64" | base64 -d > "/tmp/${name}.png"
    echo "Local: /tmp/${name}.png"

    if [[ "$no_serve" -eq 0 ]]; then
        echo "Serving to ${slug}..."
        serve_to_mac "$name" "$slug" "/tmp/${name}.png"
        echo "URL: $(screenshot_url "$slug" "$name")"
    fi
}

serve_screenshot() {
    local name="$1" slug="$2"
    validate_safe_string "name" "$name"
    validate_safe_string "slug" "$slug"

    if [[ ! -f "/tmp/${name}.png" ]]; then
        echo "ERROR: /tmp/${name}.png not found. Run 'take' first." >&2
        exit 1
    fi

    echo "Serving screenshot to ${slug}..."
    serve_to_mac "$name" "$slug" "/tmp/${name}.png"
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
    url)     shift; screenshot_url "$1" "$2" ;;
    assess)  shift; echo "/tmp/${1}.png" ;;
    compare) shift; compare_screenshots "$@" ;;
    *)       usage ;;
esac
