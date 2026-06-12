import type { CapacitorConfig } from '@capacitor/cli';

// The native WebView loads whichever URL wins this precedence chain:
//   1. CAP_SERVER_URL — explicit override exported by the CI workflow.
//   2. Production site (https://whoeverwants.com) — the default fallback.
// The CI workflow (`.github/workflows/ios-build.yml`) sets CAP_SERVER_URL
// to `https://latest.whoeverwants.com` for the `latest` build env (the
// canary tier auto-deployed on every push to main) and leaves it unset
// for the `prod` env so the fallback kicks in.
const PROD_URL = 'https://whoeverwants.com';
const serverUrl = process.env.CAP_SERVER_URL || PROD_URL;

const config: CapacitorConfig = {
  appId: 'com.whoeverwants.app',
  appName: 'WhoeverWants',
  // webDir is only used when the app runs from bundled assets. With server.url
  // set we never load from here, but Capacitor requires the path to exist.
  webDir: 'ios-webdir',
  server: {
    url: serverUrl,
    cleartext: false,
    allowNavigation: [
      'whoeverwants.com',
      '*.whoeverwants.com',
    ],
  },
  ios: {
    // The web app uses `viewport-fit=cover` and draws its own
    // `env(safe-area-inset-*)` padding throughout (fixed headers fill the
    // notch zone, page titles use `.page-title-safe-top`, etc.). Let the
    // WebView extend edge-to-edge under the status bar and home indicator.
    // `contentInset: 'always'` produced visible black bars at top and
    // bottom because it pads the WebView away from the safe areas and
    // exposes the `backgroundColor` underneath.
    contentInset: 'never',
    backgroundColor: '#ffffff',
  },
  plugins: {
    // Without presentationOptions, iOS suppresses push banners entirely
    // while the app is FOREGROUNDED — only the JS `pushNotificationReceived`
    // event fires, so e.g. a "Join request for <group>" or "Added to
    // <group>" push arriving while the user is in the app was invisible.
    // Listing alert/sound/badge makes Capacitor's
    // `userNotificationCenter(_:willPresent:)` show the banner (and play
    // the sound / stamp the badge) in the foreground too, matching the
    // backgrounded behavior. Requires a fresh iOS build to take effect
    // (config is baked into the native shell at `npx cap sync ios` time).
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
