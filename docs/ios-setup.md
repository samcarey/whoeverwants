# iOS App Setup (Capacitor + TestFlight)

This is a one-time setup guide for the Capacitor iOS app. Day-to-day,
everything is automated — pushes to the branch trigger a GitHub Actions
workflow on the Mac mini self-hosted runner, which builds, signs, and
uploads to TestFlight.

## Architecture

- **WebView shell**: the iOS app is a thin Capacitor wrapper whose WebView
  loads `https://whoeverwants.com` (prod) or the dev URL (branch builds)
  via `capacitor.config.ts → server.url`.
- **No web bundling**: web code is NOT bundled into the `.ipa`. Every
  Vercel/dev-server deploy is instantly visible on device (pull-to-refresh).
- **Native plugins still work**: Capacitor injects its JS bridge regardless
  of where HTML is loaded from. `@capacitor/haptics` and native modules
  like contacts work normally.
- **Rebuilds only when native changes**: the `.ipa` only needs rebuilding
  when plugins, permissions, icons, or native config change.

## One-time setup (≈ 45 minutes total)

You'll do 5 things, in order:

1. Register the app in Apple Developer + App Store Connect.
2. Create an App Store Connect API key (for CI uploads).
3. Add secrets to GitHub.
4. Run the Mac mini bootstrap script.
5. Trigger the first build (initializes the iOS project).

### 1. Register the app (≈ 10 min)

All of this is done in a web browser — nothing on the Mac.

1. Sign in to https://developer.apple.com/account with your paid Apple ID.
2. **Certificates, IDs & Profiles → Identifiers → +** →
   - Type: App IDs → App.
   - Description: `WhoeverWants`.
   - Bundle ID: `com.whoeverwants.app` (Explicit).
   - Capabilities: leave defaults for now (we can add push, etc. later).
   - Continue → Register.
3. Sign in to https://appstoreconnect.apple.com → **Apps → + → New App**:
   - Platform: iOS.
   - Name: `WhoeverWants`.
   - Primary language: English (US).
   - Bundle ID: select `com.whoeverwants.app`.
   - SKU: `whoeverwants` (any unique string).
   - User access: Full Access → Create.
4. In the new app → **TestFlight tab → Internal Testing → + New Group**
   (call it "Me") and add your Apple ID as a tester. You'll receive an
   invite email when the first build is processed; tap it on your iPhone
   to install the TestFlight app (if you haven't already) and get access.

### 2. Create an App Store Connect API key (≈ 5 min)

1. https://appstoreconnect.apple.com → **Users and Access → Integrations → App Store Connect API**.
2. Click **Generate API Key** (first time) or **+** (subsequent).
3. Name: `CI build signer`. Access: **App Manager**. Generate.
4. **Download the `.p8` file NOW** — you can only download it once.
5. Note down:
   - **Key ID** (10-char string shown in the table).
   - **Issuer ID** (UUID at the top of the page).
6. You'll also need your **Team ID**: find it at
   https://developer.apple.com/account → membership details (10-char string).

### 3. Add GitHub secrets (≈ 3 min)

Go to https://github.com/samcarey/whoeverwants/settings/secrets/actions
and add the following four secrets:

| Secret name | Value |
|---|---|
| `APP_STORE_CONNECT_API_KEY_ID` | the 10-char Key ID |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | the issuer UUID |
| `APP_STORE_CONNECT_API_KEY_P8` | run `base64 -w0 AuthKey_XXXXXX.p8` and paste the output |
| `APPLE_TEAM_ID` | your 10-char team ID |

> **Tip**: on macOS, `base64` doesn't accept `-w0` — use
> `base64 -i AuthKey_XXXXXX.p8 | pbcopy` instead.

### 4. Run the Mac mini bootstrap (≈ 15 min, mostly waiting)

SSH into the Mac mini. Make sure you're logged in as the user you want
the runner to run as (probably your normal user account).

```bash
# On the Mac mini:
# Get a runner registration token from:
#   https://github.com/samcarey/whoeverwants/settings/actions/runners/new
# It's the long token string shown in the displayed config.sh command.

cd /tmp
curl -sSL https://raw.githubusercontent.com/samcarey/whoeverwants/claude/capacitor-ios-automation-ANoCK/scripts/ios/mac-bootstrap.sh -o mac-bootstrap.sh
chmod +x mac-bootstrap.sh
./mac-bootstrap.sh <RUNNER_TOKEN>
```

The script installs Homebrew, Node, CocoaPods, xcpretty, Xcode CLI tools,
downloads the GitHub Actions runner, registers it with the repo, and
installs it as a LaunchAgent (survives reboot).

Verify the runner appears (green dot = online) at
https://github.com/samcarey/whoeverwants/settings/actions/runners.

### 5. Trigger the first build (≈ 10 min, fully automated)

Once the runner is online and secrets are set, dispatch the first build
from the Claude environment:

```bash
bash scripts/ios/build.sh --env dev --skip-upload
```

The workflow:
1. Detects there's no `ios/` directory yet and runs `npx cap add ios`.
2. Commits the scaffolded `ios/` project back to the branch (subsequent
   builds skip this step).
3. Runs `npx cap sync ios`, `pod install`, and archives/exports a `.ipa`.

After this succeeds, re-run without `--skip-upload` to push to TestFlight:

```bash
bash scripts/ios/build.sh --env dev
```

You'll get a TestFlight email once Apple finishes processing (~5–10 min
after the runner upload completes). Tap "Install" in the TestFlight app
on your iPhone — done.

## Day-to-day workflow

- **Changing web code** (most changes): push to any branch. Vercel /
  dev-server picks it up; refresh the app on your iPhone to see it. No
  iOS build needed.
- **Changing native config** (plugins, icons, permissions): push to a
  branch matching `main`, `claude/capacitor-*`, or `ios/*`, OR change
  `capacitor.config.ts` / `package.json`. The runner auto-builds and
  uploads to TestFlight.
- **Manual trigger**:
  ```bash
  bash scripts/ios/build.sh                     # current branch
  bash scripts/ios/build.sh --env prod          # force prod URL
  bash scripts/ios/build.sh --skip-upload       # build only
  bash scripts/ios/logs.sh                      # latest run's logs
  bash scripts/ios/logs.sh <run_id>             # specific run's logs
  ```

## Feedback loop

| Change type | Where | Delay |
|---|---|---|
| Web code (TS/TSX, CSS) | Push → Vercel / dev server | ~30 s, pull-to-refresh |
| Native config / plugins | Push → Mac mini runner → TestFlight | 8–20 min |
| New app version (e.g. new icon) | Push to `main` | 10–20 min, TestFlight notifies |

## Troubleshooting

- **Runner offline**: SSH in and run `cd ~/actions-runner && ./svc.sh status`.
  Restart with `./svc.sh restart`.
- **Code signing fails**: open Xcode on the Mac once, sign into your
  Apple ID (Preferences → Accounts), and verify the team shows up.
  Automatic provisioning via API key usually handles everything, but
  Xcode needs to have been launched at least once.
- **Build works locally but fails on CI**: check
  `bash scripts/ios/logs.sh --failed-only` from the Claude environment.

## File map

- `capacitor.config.ts` — Capacitor config; selects remote URL by env.
- `.github/workflows/ios-build.yml` — CI workflow.
- `scripts/ios/ExportOptions.plist` — `.ipa` export settings.
- `scripts/ios/build.sh` — trigger CI build + wait for completion.
- `scripts/ios/logs.sh` — fetch CI logs.
- `scripts/ios/mac-bootstrap.sh` — one-time Mac mini setup.
- `ios/` — generated Xcode project (committed after first scaffold).
