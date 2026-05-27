import { NextResponse } from 'next/server';

// Apple App Site Association (AASA) for iOS Universal Links.
//
// Served at /.well-known/apple-app-site-association on whoeverwants.com AND
// latest.whoeverwants.com. iOS fetches this file when the app is installed
// to learn which https URLs should open the app instead of Safari.
//
// Hard requirements (any miss → universal links silently disabled):
//   * HTTPS only, no redirects, no auth, no Content-Encoding tricks.
//   * Content-Type must be application/json. No `.json` suffix on the path.
//   * Body must be valid JSON. iOS caches aggressively — delete/reinstall
//     the app to force a refetch during development.
//
// The `components` block uses `{"/":"/*"}` to claim every path on the
// domain. Capacitor's WKWebView already loads whoeverwants.com, so we
// want every deeplink (group URLs, settings, etc.) to wake the app.
//
// Each bundle id uses the `<TEAM_ID>.<bundle_id>` form. Team ID 479DZ4AZT5
// is the same one baked into APNS env vars on the droplets. Two bundles
// claim every path:
//   * `com.whoeverwants.app`        — the production iOS app (loads
//                                     whoeverwants.com via capacitor.config.ts)
//   * `com.whoeverwants.app.latest` — the canary iOS app (loads
//                                     latest.whoeverwants.com)
// Both AASA endpoints (whoeverwants.com and latest.whoeverwants.com)
// serve this same file listing BOTH bundles. The discriminator is the
// app ENTITLEMENT, not the AASA: ios-build.yml scopes each shipped app's
// `associated-domains` to ONLY its own host (prod → whoeverwants.com,
// latest → latest.whoeverwants.com), so a bundle never opens links for
// a host it doesn't claim — even though this AASA lists it. This is what
// keeps a latest.whoeverwants.com link from opening the prod app when a
// tester has BOTH apps installed (iOS would otherwise pick one
// non-deterministically, and the prod app loads the wrong origin so a
// latest-tier token fails to verify).
//
// The `webcredentials` block is what makes PASSKEYS (WebAuthn) work
// inside the Capacitor WKWebView. When JS calls
// `navigator.credentials.get()/.create()` in a web view, WebKit routes
// the ceremony through the system AuthenticationServices, which refuses
// unless the host app is associated with the relying-party domain via
// the `webcredentials` service (entitlement + this AASA entry must BOTH
// list the app). Without it the ceremony fails immediately with
// NotAllowedError and the FE silently treats that as a cancellation —
// the "tap passkey, nothing happens" bug. Each shipped app's entitlement
// lists `webcredentials:<its own host>` (scoped by ios-build.yml); this
// AASA lists both bundles, and since each app's WKWebView only loads its
// own host (so the passkey RP id is that host), the scoped entitlement
// still matches. (Browser/PWA passkeys don't need this — only WKWebView.)
export const dynamic = 'force-static';

const APP_IDS = [
  '479DZ4AZT5.com.whoeverwants.app',
  '479DZ4AZT5.com.whoeverwants.app.latest',
];

const AASA = {
  applinks: {
    details: [
      {
        appIDs: APP_IDS,
        components: [{ '/': '/*' }],
      },
    ],
  },
  webcredentials: {
    apps: APP_IDS,
  },
};

export function GET() {
  return NextResponse.json(AASA);
}
