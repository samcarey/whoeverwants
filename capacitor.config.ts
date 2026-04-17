import type { CapacitorConfig } from '@capacitor/cli';

// Select the URL the native WebView loads.
//   - CAP_SERVER_URL overrides everything (useful for ad-hoc testing).
//   - CAP_ENV=dev     → your personal dev server.
//   - default         → production site.
//
// With server.url set, the iOS app loads the hosted Next.js app directly.
// Every web deploy is immediately visible on the device (pull-to-refresh).
// Capacitor still injects its native bridge, so plugins (haptics, contacts,
// etc.) work normally even though the HTML is served remotely.
const DEV_URL = 'https://sam-at-samcarey-com.dev.whoeverwants.com';
const PROD_URL = 'https://whoeverwants.com';

function resolveServerUrl(): string {
  if (process.env.CAP_SERVER_URL) return process.env.CAP_SERVER_URL;
  if (process.env.CAP_ENV === 'dev') return DEV_URL;
  return PROD_URL;
}

const serverUrl = resolveServerUrl();

const config: CapacitorConfig = {
  appId: 'com.whoeverwants.app',
  appName: 'WhoeverWants',
  // webDir is only used when the app runs from bundled assets. With server.url
  // set we never load from here, but Capacitor requires the path to exist.
  webDir: 'ios-webdir',
  server: {
    url: serverUrl,
    cleartext: false,
    // Allow navigation to all whoeverwants subdomains (prod, dev, branch previews).
    allowNavigation: [
      'whoeverwants.com',
      '*.whoeverwants.com',
    ],
  },
  ios: {
    // Use WKWebView's default inline-media behaviour; no special tweaks yet.
    contentInset: 'always',
    // Keep the status bar opaque; the web app draws its own safe-area padding.
    backgroundColor: '#000000',
  },
};

export default config;
