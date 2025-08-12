"use client";

import { useRouter } from "next/navigation";
import { useEffect, useCallback, useRef } from "react";

interface PrefetchOptions {
  priority?: "high" | "low";
  delay?: number;
  condition?: () => boolean;
}

export function usePrefetch() {
  const router = useRouter();
  const prefetchedRoutes = useRef(new Set<string>());
  
  const prefetch = useCallback((
    href: string, 
    options: PrefetchOptions = {}
  ) => {
    const { priority = "low", delay = 0, condition = () => true } = options;
    
    // Skip if already prefetched
    if (prefetchedRoutes.current.has(href)) {
      return;
    }
    
    // Check condition
    if (!condition()) {
      return;
    }
    
    const executePrefetch = () => {
      try {
        router.prefetch(href);
        prefetchedRoutes.current.add(href);
      } catch (error) {
        console.warn('Prefetch failed for:', href, error);
      }
    };
    
    if (delay > 0) {
      setTimeout(executePrefetch, delay);
    } else {
      // Use requestIdleCallback for low priority prefetches
      if (priority === "low" && 'requestIdleCallback' in window) {
        requestIdleCallback(executePrefetch, { timeout: 5000 });
      } else {
        executePrefetch();
      }
    }
  }, [router]);
  
  const prefetchOnHover = useCallback((href: string) => {
    return {
      onMouseEnter: () => prefetch(href, { priority: "high" }),
      onTouchStart: () => prefetch(href, { priority: "high" })
    };
  }, [prefetch]);
  
  const prefetchBatch = useCallback((hrefs: string[], options?: PrefetchOptions) => {
    hrefs.forEach((href, index) => {
      prefetch(href, { 
        ...options, 
        delay: (options?.delay || 0) + (index * 50) // Stagger requests
      });
    });
  }, [prefetch]);
  
  return {
    prefetch,
    prefetchOnHover,
    prefetchBatch,
    isPrefetched: (href: string) => prefetchedRoutes.current.has(href)
  };
}

// Hook for common prefetching patterns
export function useAppPrefetch() {
  const { prefetch, prefetchBatch } = usePrefetch();
  
  // Prefetch critical app routes
  useEffect(() => {
    const criticalRoutes = ['/', '/create-poll'];
    prefetchBatch(criticalRoutes, { priority: "high" });
  }, [prefetchBatch]);
  
  return { prefetch, prefetchBatch };
}

// Intersection Observer based prefetching for viewport-based prefetching
export function useViewportPrefetch(
  enabled = true,
  options: IntersectionObserverInit = {}
) {
  const { prefetch } = usePrefetch();
  const observerRef = useRef<IntersectionObserver | null>(null);
  
  const observeElement = useCallback((
    element: HTMLElement | null,
    href: string
  ) => {
    if (!enabled || !element) return;
    
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const link = entry.target as HTMLElement;
              const href = link.getAttribute('data-prefetch-href');
              if (href) {
                prefetch(href, { priority: "low" });
                observerRef.current?.unobserve(link);
              }
            }
          });
        },
        { 
          rootMargin: '200px', // Start prefetching 200px before element enters viewport
          ...options 
        }
      );
    }
    
    element.setAttribute('data-prefetch-href', href);
    observerRef.current.observe(element);
  }, [enabled, prefetch, options]);
  
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);
  
  return { observeElement };
}