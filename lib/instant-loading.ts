"use client";

import { useEffect, useRef } from "react";

// Aggressive instant loading strategy for mobile
export function useInstantLoading() {
  const warmupStarted = useRef(false);
  
  useEffect(() => {
    if (warmupStarted.current) return;
    warmupStarted.current = true;
    
    const aggressiveWarmup = async () => {
      const criticalPages = ['/create-poll'];
      
      // Strategy 1: Immediate fetch to trigger compilation
      const fetchPromises = criticalPages.map(async (page) => {
        try {
          // Multiple concurrent requests to ensure compilation
          await Promise.all([
            fetch(page, { method: 'HEAD', cache: 'no-store' }),
            fetch(page, { method: 'GET', cache: 'force-cache' })
          ]);
        } catch (error) {
          // Ignore errors - this is just warming
        }
      });
      
      await Promise.all(fetchPromises);
      
      // Strategy 2: Preload resources via DOM
      criticalPages.forEach((page) => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'document';
        link.href = page;
        link.fetchPriority = 'high';
        document.head.appendChild(link);
      });
    };
    
    // Start immediately but don't block page load
    if ('requestIdleCallback' in window) {
      requestIdleCallback(aggressiveWarmup, { timeout: 100 });
    } else {
      setTimeout(aggressiveWarmup, 50);
    }
    
    // Also warm up on first user interaction
    const warmOnInteraction = () => {
      aggressiveWarmup();
      document.removeEventListener('touchstart', warmOnInteraction);
      document.removeEventListener('mousedown', warmOnInteraction);
    };
    
    document.addEventListener('touchstart', warmOnInteraction, { once: true, passive: true });
    document.addEventListener('mousedown', warmOnInteraction, { once: true, passive: true });
    
    return () => {
      document.removeEventListener('touchstart', warmOnInteraction);
      document.removeEventListener('mousedown', warmOnInteraction);
    };
  }, []);
}

// Mobile-specific link optimization
export function createInstantLink(href: string) {
  return {
    href,
    onTouchStart: () => {
      // Immediate fetch on touch start for mobile
      fetch(href, { method: 'HEAD', cache: 'force-cache' }).catch(() => {});
    },
    onMouseDown: () => {
      // Immediate fetch on mouse down for desktop
      fetch(href, { method: 'HEAD', cache: 'force-cache' }).catch(() => {});
    },
    onFocus: () => {
      // Fetch on focus for keyboard navigation
      fetch(href, { method: 'HEAD', cache: 'force-cache' }).catch(() => {});
    }
  };
}