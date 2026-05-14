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
// The bundle id is the per-tier `<TEAM_ID>.<bundle_id>` form. Team ID
// 479DZ4AZT5 is the same one baked into APNS env vars on the droplets.
// If you add another bundle id (e.g. a fresh dev bundle), append another
// string to the `appIDs` array — they all map onto the same components.
export const dynamic = 'force-static';

const AASA = {
  applinks: {
    details: [
      {
        appIDs: ['479DZ4AZT5.com.whoeverwants.app'],
        components: [{ '/': '/*' }],
      },
    ],
  },
};

export function GET() {
  return NextResponse.json(AASA);
}
