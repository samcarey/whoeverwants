import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import BuildTimer from "@/components/BuildTimer";
import ResponsiveScaling from "@/components/ResponsiveScaling";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
        <meta name="build-id" content={process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || process.env.BUILD_TIMESTAMP || 'dev'} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="WhoeverWants" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
        <link rel="apple-touch-icon" href="/icon-192x192.svg" />
        <link rel="icon" type="image/svg+xml" sizes="192x192" href="/icon-192x192.svg" />
        <link rel="icon" type="image/svg+xml" sizes="512x512" href="/icon-512x512.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=M+PLUS+1+Code:wght@700&display=swap" rel="stylesheet" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <BuildTimer />
        <ResponsiveScaling>
          <div className="h-screen-safe flex flex-col font-[family-name:var(--font-geist-sans)]">
            {/* This is where content from each page will be rendered */}
            {children}
          </div>
        </ResponsiveScaling>
        
        {/* Header elements rendered outside scaling to maintain proper positioning */}
        <div id="header-portal"></div>
        
        {/* Bottom bar rendered outside scaling to maintain proper positioning */}
        <div id="bottom-bar-portal"></div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
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
            `,
          }}
        />
      </body>
    </html>
  );
}
