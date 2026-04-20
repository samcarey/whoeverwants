import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import Link from "next/link";
import "./globals.css";
import CommitInfo from "@/components/CommitInfo";
import ResponsiveScaling from "@/components/ResponsiveScaling";


export const metadata: Metadata = {
  title: "WhoeverWants",
  description: "Coordinate with friends!",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "WhoeverWants",
  },
};

export function generateViewport() {
  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    // Help Safari with viewport stability
    interactiveWidget: "resizes-content",
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
        
        {/* Floating "+" FAB rendered outside scaling to maintain proper positioning */}
        <div id="floating-fab-portal"></div>
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
