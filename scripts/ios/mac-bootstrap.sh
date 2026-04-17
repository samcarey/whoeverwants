#!/usr/bin/env bash
# One-shot Mac mini bootstrap. Run this ONCE on the Mac mini over SSH.
# Idempotent — safe to re-run.
#
# Usage:
#   bash mac-bootstrap.sh <github_runner_token>
#
# Get <github_runner_token> from:
#   https://github.com/samcarey/whoeverwants/settings/actions/runners/new
#   (it's the token in the --token argument of the config.sh command shown there)
set -euo pipefail

RUNNER_TOKEN="${1:-}"
RUNNER_NAME="macos-mini"
RUNNER_LABELS="self-hosted,macos-mini"
RUNNER_DIR="$HOME/actions-runner"
REPO_URL="https://github.com/samcarey/whoeverwants"

say() { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }

# ---- Homebrew ---------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  say "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Ensure brew is on PATH (Apple silicon default is /opt/homebrew)
if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

say "Installing formulae (node, cocoapods, xcpretty, coreutils)"
brew install node cocoapods xcpretty coreutils || true

# ---- Xcode command-line tools ----------------------------------------
if ! xcode-select -p >/dev/null 2>&1; then
  say "Installing Xcode command-line tools (a GUI prompt may appear)"
  xcode-select --install || true
fi

# Accept the Xcode license (requires sudo; may prompt once).
if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  say "Accepting Xcode license + first-launch setup (sudo required)"
  sudo xcodebuild -license accept || true
  sudo xcodebuild -runFirstLaunch || true
fi

# ---- GitHub Actions self-hosted runner -------------------------------
if [[ -d "$RUNNER_DIR/.runner" ]]; then
  say "Runner already configured at $RUNNER_DIR — skipping registration"
else
  if [[ -z "$RUNNER_TOKEN" ]]; then
    echo "ERROR: runner token required for first-time setup." >&2
    echo "       Get one at $REPO_URL/settings/actions/runners/new" >&2
    exit 1
  fi
  say "Downloading GitHub Actions runner"
  mkdir -p "$RUNNER_DIR"
  cd "$RUNNER_DIR"

  # Pin to a known-good runner version (update occasionally).
  RUNNER_VERSION="2.321.0"
  ARCH_SUFFIX="osx-arm64"
  if [[ "$(uname -m)" == "x86_64" ]]; then ARCH_SUFFIX="osx-x64"; fi
  TARBALL="actions-runner-${ARCH_SUFFIX}-${RUNNER_VERSION}.tar.gz"

  if [[ ! -f "$TARBALL" ]]; then
    curl -L -o "$TARBALL" \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"
  fi
  tar xzf "$TARBALL"

  say "Registering runner with repo"
  ./config.sh --unattended \
    --url "$REPO_URL" \
    --token "$RUNNER_TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "$RUNNER_LABELS" \
    --replace

  say "Installing runner as a LaunchAgent (starts on login, auto-restarts)"
  ./svc.sh install
  ./svc.sh start
fi

# ---- Done ------------------------------------------------------------
say "Bootstrap complete."
cat <<'EOF'
Next steps:
  1. Verify the runner is online:
       https://github.com/samcarey/whoeverwants/settings/actions/runners
  2. Confirm these GitHub repo secrets are set (see docs/ios-setup.md):
       APP_STORE_CONNECT_API_KEY_ID
       APP_STORE_CONNECT_API_KEY_ISSUER_ID
       APP_STORE_CONNECT_API_KEY_P8  (base64-encoded .p8 contents)
       APPLE_TEAM_ID
  3. Trigger the first build from the Claude environment:
       bash scripts/ios/build.sh --env dev
EOF
