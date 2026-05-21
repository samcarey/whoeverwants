# iOS App Setup (Capacitor + TestFlight)

One-time setup for the Capacitor iOS app. Day-to-day, pushes to your branch
trigger a workflow on the Mac mini self-hosted runner which builds, signs,
and uploads to TestFlight automatically.

## Architecture

- **WebView shell**: the iOS app is a thin Capacitor wrapper whose WebView
  loads `https://whoeverwants.com` (prod) or `https://latest.whoeverwants.com`
  (the canary "latest" tier auto-deployed on every push to `main`) at build
  time via `capacitor.config.ts`.
- **No web bundling**: web code isn't baked into the `.ipa`. Vercel /
  canary deploys propagate to the device on app open.
- **Two iOS apps**: prod (`com.whoeverwants.app`) and latest
  (`com.whoeverwants.app.latest`). The latest build is a single shared
  TestFlight track for all contributors — there is NO per-developer suffix
  (per-author dev infra was retired when dev sites became per-branch, and
  per-branch dev sites aren't wired up to any iOS app).
- **Rebuilds only when native changes**: plugins, permissions, icons, or
  native config changes. Web-only changes never trigger a rebuild.

## One-time setup (~45 min)

Five things, in order:

1. Register the prod bundle ID in Apple Developer + create the App Store Connect record + TestFlight group.
2. Register the latest bundle ID + App Store Connect record + TestFlight group.
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

### 2. Latest (canary) app (~10 min)

Same flow as step 1, with the `.latest` suffix:

1. Register bundle ID `com.whoeverwants.app.latest`.
2. Create App Store Connect app: name `WhoeverWants Latest`, SKU
   `whoeverwants-latest`, bundle ID from step 1.
3. TestFlight → Internal Testing group → add yourself (and any other
   contributors — one shared track).

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
bash scripts/ios/build.sh --env latest
```

The first run auto-scaffolds `ios/` via `npx cap add ios`, commits it back
to the branch, then archives + signs + uploads to TestFlight for the
`com.whoeverwants.app.latest` bundle. ~10–15 min end-to-end.

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
# Manual trigger for current branch (latest URL by default)
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

## Push notifications (APNS)

The "New Poll" toggle on each group's info page registers the device for
push notifications. On the iOS app this routes through APNS (Apple's
Push Notification service); on web/PWA platforms it uses Web Push
(VAPID). Web Push works out of the box once the API is deployed —
APNS requires the following one-time setup.

### 1. Generate an APNS Auth Key in Apple Developer Portal

1. Open https://developer.apple.com/account/resources/authkeys/list
2. Click the **+** to create a new key.
3. Name it `WhoeverWants APNS` (or similar).
4. Check **Apple Push Notifications service (APNs)**.
5. Click **Continue → Register → Download**. You'll get an `.p8` file —
   download it now, you can't re-download it later.
6. Note the **Key ID** (10 chars, shown on the key's detail page) and
   your **Team ID** (top-right of the developer portal).

### 2. Enable Push Notifications capability on the iOS app

In the Apple Developer Portal:
1. Go to **Identifiers** → find `com.whoeverwants.app` and
   `com.whoeverwants.app.latest`.
2. Enable **Push Notifications** under the capabilities list. Save.
3. Repeat for both bundles (prod + latest).

In the iOS project:
1. The `aps-environment` entitlement needs to be present in
   `ios/App/App/App.entitlements`. After running `npx cap sync ios`
   following the `@capacitor/push-notifications` plugin install, Xcode
   may or may not add this automatically. If TestFlight uploads fail
   with `Missing Push Notification Entitlement`, add manually:
   ```xml
   <key>aps-environment</key>
   <string>production</string>
   ```
   Use `development` for dev builds if you want to use the APNS sandbox.

### 3. Set the API server's APNS env vars

On each droplet (prod + canary), append to `/root/whoeverwants/.env`:

```bash
APNS_KEY_ID=ABCD123456
APNS_TEAM_ID=YOURTEAMID
APNS_AUTH_KEY_P8=<base64 of the .p8 file contents, single line>
# Set to 1 to send via APNS sandbox (api.sandbox.push.apple.com).
# Leave unset for production (api.push.apple.com).
APNS_USE_SANDBOX=
```

To compute `APNS_AUTH_KEY_P8`:

```bash
base64 -i AuthKey_ABCD123456.p8 | tr -d '\n'
```

Restart the API to pick up the new env: `bash scripts/remote.sh "docker
compose up -d --force-recreate api" /root/whoeverwants` (and the same on
the latest droplet via `remote-latest.sh`).

To verify: `curl https://api.whoeverwants.com/api/notifications/config`
should return `{"vapid_public_key": "...", "apns_supported": true}`.

### 4. Capacitor plugin installation in the iOS project

The FE depends on `@capacitor/push-notifications`. After
`npm install` runs, `npx cap sync ios` (which the CI build step does
automatically) updates the iOS project to include the native plugin.
The plugin handles the `application:didRegisterForRemoteNotifications`
callback and routes the resulting APNS token to the JS layer, which the
FE then POSTs to `/api/notifications/subscriptions` with kind=`apns`.

If you've installed the plugin manually outside the CI pipeline, run:

```bash
cd /path/to/repo
npm install
npx cap sync ios
```

Then commit the resulting changes under `ios/`.

### Diagnostics

- **Tap notification → app doesn't open the right page**: check
  `ios/App/App/AppDelegate.swift` for a handler reading the
  `notification.request.content.userInfo["url"]` key. Capacitor's plugin
  surfaces the payload through `PushNotifications.addListener(
  'pushNotificationActionPerformed', ...)`; the WhoeverWants FE doesn't
  wire this listener today — pull requests welcome to route taps into
  `router.push(notification.data.url)`.
- **`BadDeviceToken`** in API logs: token was registered against the
  wrong APNS environment. Flip `APNS_USE_SANDBOX` to match the build's
  `aps-environment` entitlement.
- **`InvalidProviderToken`**: the JWT signed against `APNS_AUTH_KEY_P8`
  doesn't match the Team ID. Confirm `APNS_TEAM_ID` and `APNS_KEY_ID`
  exactly match the values from the Auth Key's page in the developer
  portal.

## Sign In with Apple (native)

The Capacitor iOS app drives Apple Sign In through Apple's native
`ASAuthorizationController` via the `@capgo/capacitor-social-login`
plugin. The web flow (in Safari / PWA) keeps using Apple's JS SDK. Both
funnel ID tokens through `POST /api/auth/oauth/apple`, but the audience
(`aud`) claim differs by surface — native sends the bundle id, web
sends the Service ID. The server's `APPLE_OAUTH_AUDIENCES` env var
must list ALL of them.

> **Why not `@capacitor-community/apple-sign-in`?** Its 7.x release
> pins `capacitor-swift-pm` to v7.x; our `@capacitor/push-notifications@8`
> pins it to v8.x. SPM rejects the conflicting graph at archive
> time. `@capgo/capacitor-social-login` is the only mainstream
> Apple-on-iOS Capacitor plugin with a v8 release.

### 1. Enable "Sign In with Apple" capability per bundle

In the Apple Developer Portal:
1. Go to **Identifiers** → find `com.whoeverwants.app` and
   `com.whoeverwants.app.latest`.
2. Enable **Sign In with Apple** under the capabilities list. Save.
3. Repeat for both bundles (prod + latest).

Without the portal toggle, the `com.apple.developer.applesignin`
entitlement (already in `ios/App/App/App.entitlements`) compiles fine
but iOS silently rejects `SignInWithApple.authorize()` at runtime — no
prompt appears, the JS promise hangs until the page tears down.

### 2. Update the API server's `APPLE_OAUTH_AUDIENCES`

On each droplet (prod + canary), `/root/whoeverwants/.env.api` must
list every audience the server should accept:

```bash
# Web Service ID + both iOS bundle ids, comma-separated:
APPLE_OAUTH_AUDIENCES=com.whoeverwants.signin,com.whoeverwants.app,com.whoeverwants.app.latest
```

Then `docker compose up -d --force-recreate api` to pick up the env
change (a plain `restart` reuses the existing container's env).

### 3. Capacitor plugin installation

Already wired up — `@capgo/capacitor-social-login` is declared in
`package.json`. `npx cap sync ios` (run by the iOS build workflow on
every push touching `package.json` or `ios/**`) pulls the plugin's
native code in via Swift Package Manager. No additional Xcode project
patching required.

### Diagnostics

- **Authorization sheet doesn't appear, promise hangs**: most likely
  the per-bundle "Sign In with Apple" capability is still off in the
  developer portal. Toggle it on (Step 1) — the change takes effect on
  next launch, no rebuild needed.
- **Server returns 400 "Sign-in token isn't for this application"**:
  the bundle id sent in the JWT's `aud` isn't in
  `APPLE_OAUTH_AUDIENCES`. Check `bash scripts/remote-latest.sh "docker
  compose logs --tail 50 api | grep aud"` for the actual rejected
  value, then add it to `.env.api` and force-recreate the container.
- **First-ever sign-in lands with `email=null` even though Apple
  shows the email in the sheet**: Apple only sends email + name on the
  FIRST authorization for a given (user, RP) pair. The server resolves
  via `sub` either way; subsequent sign-ins reuse the original user_id.
  If you accidentally deleted the user row, Apple still won't re-send
  email — the user has to visit Settings → Apple ID → Sign in with
  Apple → find the app → Stop Using Apple ID, then sign in again.
