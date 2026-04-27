# iOS App Setup (Capacitor + TestFlight)

One-time setup for the Capacitor iOS app. Day-to-day, pushes to your branch
trigger a workflow on the Mac mini self-hosted runner which builds, signs,
and uploads to TestFlight automatically.

## Architecture

- **WebView shell**: the iOS app is a thin Capacitor wrapper whose WebView
  loads `https://whoeverwants.com` (prod) or your personal dev URL
  (`<email-slug>.dev.whoeverwants.com`) at build time via `capacitor.config.ts`.
- **No web bundling**: web code isn't baked into the `.ipa`. Vercel / dev
  server deploys propagate to the device via pull-to-refresh.
- **Per-developer dev app**: dev builds get a unique bundle ID
  (`com.whoeverwants.app.dev.<github-username>`) and separate App Store
  Connect record so they coexist with the prod app — and with each other if
  multiple developers build dev.
- **Rebuilds only when native changes**: plugins, permissions, icons, or
  native config changes. Web-only changes never trigger a rebuild.

## One-time setup (~45 min)

Five things, in order:

1. Register the prod bundle ID in Apple Developer + create the App Store Connect record + TestFlight group.
2. Register your personal dev bundle ID + App Store Connect record + TestFlight group.
3. Create an App Store Connect API key with Admin role.
4. Add 5 GitHub secrets.
5. Run the Mac mini bootstrap + create the CI keychain.

### 1. Prod app (~15 min)

1. https://developer.apple.com/account/resources/identifiers/list → + → App IDs → App →
   - Description: `WhoeverWants`
   - Bundle ID (Explicit): `com.whoeverwants.app`
   - Register.
2. https://appstoreconnect.apple.com/apps → + → New App → iOS →
   - Name: `WhoeverWants`, Language: English (US), Bundle ID: select
     `com.whoeverwants.app`, SKU: `whoeverwants`, Full Access → Create.
3. In the new app → TestFlight tab → Internal Testing → + → name `Me` →
   enable **Enable automatic distribution** → Create. Add yourself as a tester.

### 2. Your personal dev app (~10 min)

Same flow as step 1, with your GitHub username as the suffix:

1. Register bundle ID `com.whoeverwants.app.dev.<your-github-username>`.
2. Create App Store Connect app: name `WhoeverWants Dev`, SKU
   `whoeverwants-dev-<your-github-username>`, bundle ID from step 1.
3. TestFlight → Internal Testing group → add yourself.

### 3. App Store Connect API key (~5 min)

1. https://appstoreconnect.apple.com/access/integrations/api → Team Keys tab.
2. Generate API Key → **Admin** role (App Manager is NOT sufficient — it
   lacks cloud-signing permission for Distribution certs).
3. Download the `.p8` file **immediately** (one-time download). Note the
   **Key ID** (10-char) and **Issuer ID** (UUID at the top of the page).
4. Also note your **Team ID**: https://developer.apple.com/account → Membership
   details.

### 4. GitHub secrets (~3 min)

Transfer the `.p8` to the Mac mini (AirDrop or iCloud → `~/Downloads/`), then
on mini4:

```
base64 -i ~/Downloads/AuthKey_<KEY_ID>.p8 | tr -d '\n' && echo
```

Copy the single-line output (easier to paste without corruption than
multi-line PEM). At
https://github.com/samcarey/whoeverwants/settings/secrets/actions add:

| Secret | Value |
|---|---|
| `APP_STORE_CONNECT_API_KEY_ID` | the 10-char Key ID |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | the issuer UUID |
| `APP_STORE_CONNECT_API_KEY_P8` | the base64 string from above |
| `APPLE_TEAM_ID` | your 10-char team ID |
| `CI_KEYCHAIN_PASSWORD` | any password you pick (used in step 5) |

### 5. Mac mini runner + CI keychain (~15 min, mostly install waits)

Grab a runner token at
https://github.com/samcarey/whoeverwants/settings/actions/runners/new (copy
the long value after `--token` in the displayed command).

SSH to mini4, then:

```
cd /tmp
curl -sSL https://raw.githubusercontent.com/samcarey/whoeverwants/main/scripts/ios/mac-bootstrap.sh -o mac-bootstrap.sh
chmod +x mac-bootstrap.sh
./mac-bootstrap.sh <RUNNER_TOKEN>
```

The script installs Homebrew + Node + Xcode CLI tools, points `xcode-select`
at Xcode.app, downloads the iOS platform SDK, registers the runner as a
LaunchAgent, and accepts the Xcode license.

After it completes, create the CI keychain (using the password you put in
`CI_KEYCHAIN_PASSWORD`):

```
CI_PWD='<same-password-you-saved-as-the-github-secret>'
security create-keychain -p "$CI_PWD" ~/Library/Keychains/ci.keychain-db
security list-keychains -d user -s ~/Library/Keychains/ci.keychain-db ~/Library/Keychains/login.keychain-db
security default-keychain -s ~/Library/Keychains/ci.keychain-db
security unlock-keychain -p "$CI_PWD" ~/Library/Keychains/ci.keychain-db
```

(`security set-keychain-settings` fails over SSH with "User interaction is
not allowed" — harmless; the workflow unlocks fresh before each run.)

Verify the runner appears with a green dot (Idle) at
https://github.com/samcarey/whoeverwants/settings/actions/runners.

## Trigger the first build

From Claude environment (or any shell with `GITHUB_API_TOKEN`):

```
bash scripts/ios/build.sh --env dev
```

The first run auto-scaffolds `ios/` via `npx cap add ios`, commits it back
to the branch, then archives + signs + uploads to TestFlight for the dev
bundle ID. ~10–15 min end-to-end.

Answer "None of the algorithms mentioned above" if TestFlight prompts for
encryption compliance (one-time per app record; the
`ITSAppUsesNonExemptEncryption=false` flag in `Info.plist` avoids it
afterward).

## Day-to-day

| Change | Where | Delay |
|---|---|---|
| Web code (TS/TSX, CSS) | push to your branch | ~30 s, pull-to-refresh |
| Native config / plugins | push to `main`, `claude/capacitor-*`, or `ios/*` | 8–20 min |

```
# Manual trigger for current branch (dev URL by default)
bash scripts/ios/build.sh

# Force prod URL
bash scripts/ios/build.sh --env prod

# Build without uploading
bash scripts/ios/build.sh --skip-upload

# Tail latest CI logs
bash scripts/ios/logs.sh

# Tail only the failing job's logs for a specific run
bash scripts/ios/logs.sh --failed-only 12345678
```

## Troubleshooting

- **Runner offline**: `cd ~/actions-runner && ./svc.sh status` → `./svc.sh restart`.
- **Build fails at "Unlock CI keychain"**: the `ci.keychain-db` doesn't exist or the `CI_KEYCHAIN_PASSWORD` secret doesn't match. Recreate per step 5.
- **`xcode-select` error in workflow**: run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` once on mini4.
- **`Cloud signing permission error` during export**: API key lacks cert-management scope. Regenerate with Admin role (see step 3) and update the `APP_STORE_CONNECT_API_KEY_ID` + `APP_STORE_CONNECT_API_KEY_P8` secrets.
- **`invalidPEMDocument`**: the P8 secret got corrupted. Re-copy via `base64 -i ... | tr -d '\n'` and paste the single-line string.
- **`Missing required icon file`**: the 1024×1024 AppIcon PNG at `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` isn't being committed. Check `.gitignore` — the `*.png` deny rule must be overridden by `!ios/App/App/Assets.xcassets/**/*.png`.

## File map

- `capacitor.config.ts` — Capacitor config; `server.url` from `CAP_SERVER_URL` or prod default.
- `.github/workflows/ios-build.yml` — CI workflow (self-hosted Mac mini runner).
- `scripts/ios/ExportOptions.plist` — `.ipa` export settings (app-store-connect, automatic signing).
- `scripts/ios/build.sh` — dispatch + question CI.
- `scripts/ios/logs.sh` — fetch CI logs (full run or `--failed-only`).
- `scripts/ios/mac-bootstrap.sh` — one-time Mac mini setup.
- `ios/` — generated Xcode project (committed by CI on first run).
