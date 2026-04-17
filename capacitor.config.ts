import type { CapacitorConfig } from '@capacitor/cli';

// The native WebView loads whichever URL wins this precedence chain:
//   1. CAP_SERVER_URL — explicit override (CI sets this per-developer).
//   2. Production site — the default fallback.
// `CAP_ENV=dev` alone is no longer meaningful; the workflow translates
// it into a real URL (e.g., <email-slug>.dev.whoeverwants.com) and
// exports CAP_SERVER_URL before running `cap sync`.
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
    contentInset: 'always',
    // Keep the status bar opaque; the web app draws its own safe-area padding.
    backgroundColor: '#000000',
  },
};

export default config;
