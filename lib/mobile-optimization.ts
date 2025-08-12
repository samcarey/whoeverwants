"use client";

import { useRouter } from "next/navigation";
import { useEffect, useCallback, useRef } from "react";

// Mobile-specific optimizations for instant page loading
export function useMobileOptimization() {
  const router = useRouter();
  const warmupCompleted = useRef(new Set<string>());
  
  // Aggressive page warming - make actual requests to compile pages
  const warmupPage = useCallback(async (path: string) => {
    if (warmupCompleted.current.has(path)) return;
    
    try {
      // Make a HEAD request to trigger compilation without downloading content
      await fetch(path, { method: 'HEAD', cache: 'force-cache' });
      warmupCompleted.current.add(path);
      
      // Also prefetch with Next.js router
      router.prefetch(path);
    } catch (error) {
      console.warn('Page warmup failed for:', path, error);
    }
  }, [router]);

  // Immediate warmup of critical pages on app start
  useEffect(() => {
    const criticalPages = ['/create-poll'];
    
    // Use requestIdleCallback for non-blocking warmup
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        criticalPages.forEach(page => warmupPage(page));
      }, { timeout: 1000 });
    } else {
      // Fallback for Safari
      setTimeout(() => {
        criticalPages.forEach(page => warmupPage(page));
      }, 100);
    }
  }, [warmupPage]);

  return { warmupPage };
}

// Touch-optimized prefetching for mobile devices
export function useTouchOptimizedPrefetch() {
  const { warmupPage } = useMobileOptimization();
  
  const createTouchHandlers = useCallback((href: string) => {
    return {
      // touchstart fires immediately when finger touches screen
      onTouchStart: () => {
        warmupPage(href);
      },
      // mouseenter for desktop hover
      onMouseEnter: () => {
        warmupPage(href);
      },
      // Focus for keyboard navigation
      onFocus: () => {
        warmupPage(href);
      }
    };
  }, [warmupPage]);

  return { createTouchHandlers, warmupPage };
}

// iOS Safari specific optimizations
export function useIOSOptimizations() {
  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS) return;

    // Prevent iOS from pausing JavaScript during scroll
    const preventPause = () => {
      document.addEventListener('touchmove', (e) => {
        e.preventDefault();
      }, { passive: false });
    };

    // Add iOS-specific meta tags for better performance
    const addIOSMeta = () => {
      const meta = document.createElement('meta');
      meta.name = 'apple-mobile-web-app-capable';
      meta.content = 'yes';
      if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
        document.head.appendChild(meta);
      }
    };

    addIOSMeta();
    
    // Preload critical resources
    const preloadCriticalResources = () => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'document';
      link.href = '/create-poll';
      document.head.appendChild(link);
    };

    preloadCriticalResources();
    
  }, []);
}

// Background page compilation for development
export function useBackgroundCompilation() {
  useEffect(() => {
    const compileInBackground = async () => {
      const pagesToCompile = ['/create-poll'];
      
      for (const page of pagesToCompile) {
        try {
          // Make background request to trigger compilation
          await fetch(page, { 
            method: 'GET',
            cache: 'no-store',
            // Use a special header to identify background compilation
            headers: {
              'X-Background-Compile': 'true'
            }
          });
        } catch (error) {
          // Ignore errors - this is just for warming up
        }
      }
    };

    // Delay to not interfere with initial page load
    const timer = setTimeout(compileInBackground, 500);
    return () => clearTimeout(timer);
  }, []);
}