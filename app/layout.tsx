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
import CreateGroupButtonHost from "@/components/CreateGroupButtonHost";
import { PersistentCreatePollHost } from "@/components/PersistentCreatePollHost";
import { UniversalLinksHandler } from "@/components/UniversalLinksHandler";
import { ClipboardLinkPrompt } from "@/components/ClipboardLinkPrompt";
import { PushAutoRegister } from "@/components/PushAutoRegister";
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
    <html lang="en">
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
        
        {/* Header elements rendered outside scaling to maintain proper positioning */}
        <div id="header-portal"></div>

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
            swipe-back gesture — see components/GroupBackdropHost.tsx. */}
        <GroupBackdropHost />

        {/* Single persistent "+ Group" button instance for the home page
            and the group→home swipe-back gesture window. Mounted at layout
            level so the DOM node is identical across the gesture and the
            commit — no fake/real button swap, no position jump. */}
        <CreateGroupButtonHost />

        {/* CreateQuestionContent (category bubble bar + create-poll modal).
            Lives in the root layout — NOT template — so it persists across
            route changes. template.tsx re-instantiates on every navigation
            in App Router, which would unmount + remount this component and
            cause the bubble bar's portal target to be briefly cleared
            (visible as "buttons blink after slide"). */}
        <PersistentCreatePollHost />

        {/* iOS Universal Links — converts an `appUrlOpen` event from the
            Capacitor shell into a Next.js client-side navigation. Inert
            on non-native platforms. Lives in the layout so the listener
            survives client-side route changes (template re-instantiates
            per route and would tear it down). */}
        <UniversalLinksHandler />

        {/* iOS clipboard-link prompt — on app activation (cold launch or
            foreground from background), checks the system clipboard for
            an https://whoeverwants.com/... URL and surfaces a
            confirmation modal to open it inside the app. Inert on
            non-native platforms. Lives in the layout so the listener
            survives client-side route changes (same reason as
            UniversalLinksHandler above). */}
        <ClipboardLinkPrompt />
        <PushAutoRegister />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                // Skip service worker on dev servers to avoid stale cache
                if (location.hostname.endsWith('.dev.whoeverwants.com') || location.hostname === 'localhost') {
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
