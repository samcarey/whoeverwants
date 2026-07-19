import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import Link from "next/link";
import "./globals.css";
import CommitInfo from "@/components/CommitInfo";
import ResponsiveScaling from "@/components/ResponsiveScaling";
import { SlideOverlayHost } from "@/lib/slideOverlay";
import HomeBackdropHost from "@/components/HomeBackdropHost";
import GroupBackdropHost from "@/components/GroupBackdropHost";
import PollBackdropHost from "@/components/PollBackdropHost";
import ExploreBackdropHost from "@/components/ExploreBackdropHost";
import SettingsBackdropHost from "@/components/SettingsBackdropHost";
import CreateGroupButtonHost from "@/components/CreateGroupButtonHost";
import RecoveryReminderHost from "@/components/RecoveryReminderHost";
import { PersistentCreatePollHost } from "@/components/PersistentCreatePollHost";
import { UniversalLinksHandler } from "@/components/UniversalLinksHandler";
import { PushAutoRegister } from "@/components/PushAutoRegister";
import { NativeIdentityHost } from "@/components/NativeIdentityHost";
import UserProfileModalHost from "@/components/UserProfileModalHost";
import { THEME_KEY } from "@/lib/theme";


export const metadata: Metadata = {
  // `metadataBase` makes Next.js resolve relative URLs (e.g. og:image
  // pointing at `/icon-512x512.png`) into absolute URLs that crawlers
  // can fetch. Without it, link-preview unfurlers see a relative path
  // they can't resolve and skip the thumbnail.
  metadataBase: new URL("https://whoeverwants.com"),
  title: "WhoeverWants",
  description: "Anonymous polling for group decisions.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "WhoeverWants",
  },
  openGraph: {
    title: "WhoeverWants",
    description: "Anonymous polling for group decisions.",
    siteName: "WhoeverWants",
    type: "website",
    images: [
      {
        url: "/icon-512x512.png",
        width: 512,
        height: 512,
        alt: "WhoeverWants",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "WhoeverWants",
    description: "Anonymous polling for group decisions.",
    images: ["/icon-512x512.png"],
  },
};

export function generateViewport() {
  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    // `resizes-content` permanently shrinks the layout viewport in iOS PWA
    // standalone mode, reserving a thick blank strip above the home
    // indicator even when no keyboard is showing — the page can't render
    // into that area, so it appears as a "white bar" the new group button has to sit
    // above. Default `resizes-visual` lets the layout viewport reach the
    // actual screen bottom; the keyboard, when shown, only resizes the
    // visual viewport, which is fine for our use case (the only PWA
    // surface with form inputs is the create-poll modal, which already
    // does its own keyboard handling via position:fixed body lock).
    interactiveWidget: "resizes-visual",
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: "#ffffff" },
      { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" }
    ]
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`,
          }}
        />
        <meta name="build-id" content={process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev'} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="WhoeverWants" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-180x180.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192x192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512x512.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=M+PLUS+1+Code:wght@700&display=swap" rel="stylesheet" />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      >
        <CommitInfo showTimeBadge={process.env.NODE_ENV === 'development'} />
        <ResponsiveScaling>
          <div className="font-[family-name:var(--font-geist-sans)]">
            {/* This is where content from each page will be rendered */}
            {children}
          </div>
        </ResponsiveScaling>
        
        {/* Header elements rendered outside scaling to maintain proper positioning.
            Fixed + zero-height + z-30 (mirrors #commit-badge-portal) so the
            swipe-back gesture can transform it as a unit: its children are
            `position: fixed` floating buttons, and a transform on this div
            makes it their containing block — because the div is itself pinned
            at the viewport's top edge spanning the full width, the buttons'
            `top/left/right` offsets resolve to the same coordinates whether
            the div is transformed or not, so they slide with the page without
            jumping. The explicit z-30 keeps the (transformed → new stacking
            context) buttons above the z-0 swipe backdrops. Zero height means
            the div itself never intercepts taps. */}
        <div id="header-portal" className="fixed top-0 left-0 right-0 h-0 z-30"></div>

        {/* New group button rendered outside scaling to maintain proper positioning */}
        <div id="floating-fab-portal"></div>

        {/* iOS-style overlay-slide for instant home→group navigation.
            Lives in the root layout (NOT template) because template.tsx
            mounts a new instance on every navigation — that would unmount
            the overlay the moment router.push commits. The layout
            persists across routes, so the overlay survives the route
            change and stays visible until its slide animation finishes. */}
        <SlideOverlayHost />

        {/* Persistent home backdrop for the group→home swipe-back gesture.
            Mounted here (NOT inside GroupContent) so it survives the
            router.push that commits the swipe — eliminates the blank
            frame between GroupContent's unmount and the real home page's
            first paint. */}
        <HomeBackdropHost />

        {/* Persistent group backdrop for the poll→group swipe-back gesture.
            Mirrors HomeBackdropHost but for the poll detail page's
            swipe-back gesture — see components/GroupBackdropHost.tsx.
            Also used by the group INFO page's swipe-back (info→group root). */}
        <GroupBackdropHost />

        {/* Persistent poll-detail backdrop for the poll-info→poll-detail
            swipe-back gesture — see components/PollBackdropHost.tsx. */}
        <PollBackdropHost />

        {/* Persistent explore backdrop for the poll-detail→/explore
            swipe-back (when the poll was opened from /explore) — see
            components/ExploreBackdropHost.tsx. */}
        <ExploreBackdropHost />

        {/* Persistent settings backdrop for the settings-edit→settings
            swipe-back gesture — see components/SettingsBackdropHost.tsx.
            (The settings→home swipe reuses HomeBackdropHost above.) */}
        <SettingsBackdropHost />

        {/* Single persistent "+ Group" button instance for the home page
            and the group→home swipe-back gesture window. Mounted at layout
            level so the DOM node is identical across the gesture and the
            commit — no fake/real button swap, no position jump. */}
        <CreateGroupButtonHost />

        {/* Home-page nudge for recovery-less accounts (name-only / passkey-
            only) to add a sign-in method. Self-hides off home, when the
            account gains a recovery identity, or when dismissed. */}
        <RecoveryReminderHost />

        {/* CreateQuestionContent (the floating "+ Poll" button + New Poll
            sheet hosting the create-poll search box). Lives in the root
            layout — NOT template — so it persists across route changes.
            template.tsx re-instantiates on every navigation in App Router,
            which would unmount + remount this component and reset the FAB /
            modal state. */}
        <PersistentCreatePollHost />

        {/* iOS Universal Links — converts an `appUrlOpen` event from the
            Capacitor shell into a Next.js client-side navigation. Inert
            on non-native platforms. Lives in the layout so the listener
            survives client-side route changes (template re-instantiates
            per route and would tear it down). */}
        <UniversalLinksHandler />

        <PushAutoRegister />

        {/* iOS native identity bridge — mirrors the WebView's session token /
            browser id / display name into the Keychain so native Swift (and the
            future headless-creation App Intent) can call the API as the user.
            Inert on non-native platforms. Lives in the layout so the
            subscription survives client-side route changes. */}
        <NativeIdentityHost />

        {/* Long-press (touch) / click (desktop) a user's name/avatar anywhere →
            profile modal. Mounted once so the triggering surfaces just dispatch
            the open event. */}
        <UserProfileModalHost />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                // Skip (and unregister) the service worker on dev/preview hosts
                // to avoid a stale cached bundle. Covers the per-branch dev
                // domains, localhost, and Tailscale-served demos (*.ts.net) —
                // on those the SW would otherwise pin an old JS bundle across
                // redeploys.
                if (location.hostname.endsWith('.dev.whoeverwants.com') || location.hostname.endsWith('.ts.net') || location.hostname === 'localhost') {
                  navigator.serviceWorker.getRegistrations().then(function(regs) {
                    regs.forEach(function(r) { r.unregister(); });
                  });
                } else {
                window.addEventListener('load', function() {
                  // Register enhanced service worker for mobile optimization
                  navigator.serviceWorker.register('/sw-mobile.js')
                    .then(function(registration) {
                      
                      // Send message to precache critical pages
                      if (registration.active) {
                        registration.active.postMessage({
                          type: 'PRECACHE_PAGES',
                          pages: ['/', '/create-poll']
                        });
                      }
                      
                      // Warm up critical pages immediately
                      setTimeout(() => {
                        if (registration.active) {
                          registration.active.postMessage({
                            type: 'WARM_PAGE',
                            page: '/create-poll'
                          });
                        }
                      }, 500);
                    })
                    .catch(function(registrationError) {
                      // Fallback to basic service worker
                      navigator.serviceWorker.register('/sw.js').catch(() => {});
                    });
                });
                }
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
