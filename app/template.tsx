"use client";

import React, { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import HeaderPortal from '@/components/HeaderPortal';
import { useLongPress } from '@/lib/useLongPress';
import { installClientLogForwarder } from '@/lib/clientLogForwarder';
import { usePrefetch } from '@/lib/prefetch';
import { navigateWithTransition, navigateBackWithTransition, NAV_COUNT_KEY } from '@/lib/viewTransitions';
import { getCachedPollById, getCachedPollByShortId } from '@/lib/pollCache';
import { isUuidLike, extractPollRouteId } from '@/lib/pollId';
import { findThreadRootRouteId } from '@/lib/threadUtils';
import * as pollBackTarget from '@/lib/pollBackTarget';

// Extract the import so it can be triggered independently for preloading.
// When called a second time, the module cache returns the already-resolved module instantly.
const importCreatePoll = () =>
  import('@/app/create-poll/page').catch((err) => {
    if (err?.name === 'ChunkLoadError' || err?.message?.includes('Failed to load chunk') || err?.message?.includes('Failed to fetch dynamically imported module')) {
      window.location.reload();
    }
    throw err;
  });

const LazyCreatePollContent = React.lazy(() =>
  importCreatePoll().then(m => ({ default: m.CreatePollContent }))
);

interface AppTemplateProps {
  children: React.ReactNode;
}

// Detect standalone PWA mode (iOS via navigator.standalone, Android/Chrome via display-mode media query).
const isStandalonePWA = () =>
  (navigator as unknown as { standalone?: boolean }).standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches;

// navigator.standalone is iOS/iPadOS Safari-only; true = launched as standalone PWA.
const isIOSSPWAStandalone = () =>
  (navigator as unknown as { standalone?: boolean }).standalone === true;

// Bottom bar scroll behavior
const SCROLL_TOP_SAFE_ZONE = 50; // Don't hide bottom bar when within this many px of top

// Pull-to-refresh constants (iOS PWA only)
const PTR_THRESHOLD = 240;  // px of raw touch movement to trigger refresh
const PTR_CIRCUMFERENCE = 2 * Math.PI * 10; // SVG arc circumference (radius=10)
const PTR_INDICATOR_SIZE = 40; // approx height of circle + padding

export default function Template({ children }: AppTemplateProps) {
  return (
    <Suspense fallback={<div />}>
      <TemplateInner>{children}</TemplateInner>
    </Suspense>
  );
}

function TemplateInner({ children }: AppTemplateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { prefetchOnHover } = usePrefetch();
  const [isStandalone, setIsStandalone] = useState(false);
  const [hasAppHistory, setHasAppHistory] = useState(false);
  const [showBottomBar, setShowBottomBar] = useState(true);
  const [bottomBarHeight, setBottomBarHeight] = useState(56);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isIOSPWA, setIsIOSPWA] = useState(false);
  // True on any mobile touch device — custom PTR runs for both PWA and mobile web
  // because the fixed-viewport layout breaks native browser PTR.
  const [needsCustomPTR, setNeedsCustomPTR] = useState(false);
  const lastScrollY = useRef(0);
  const scrollThreshold = useRef(5); // Minimum scroll distance to trigger hide/show
  const bounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInBounceRef = useRef(false);
  const isThreadPageRef = useRef(false);

  // Pull-to-refresh state — uses refs + direct DOM manipulation for 60fps during drag,
  // React state only for mount/unmount of indicator and final actions (refresh/snap-back).
  const [pullActive, setPullActive] = useState(false);    // whether indicator is mounted
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullIndicatorRef = useRef<HTMLDivElement>(null);   // direct DOM ref for indicator
  const pullArcRef = useRef<SVGCircleElement>(null);       // direct DOM ref for arc
  
  // Track in-app navigation for back button (runs on each client-side navigation).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const count = parseInt(sessionStorage.getItem(NAV_COUNT_KEY) || '0', 10) + 1;
    sessionStorage.setItem(NAV_COUNT_KEY, String(count));
    setHasAppHistory(count > 1);
  }, [pathname]);

  // Measure the bottom bar's rendered height so the scroll container can reserve
  // the exact amount — hardcoding 56px leaves a white gap on web where the bar
  // (no safe-area inset) is a few px shorter.
  useEffect(() => {
    if (!isMounted) return;
    const el = bottomBarRef.current;
    if (!el) return;
    const measure = () => {
      // Bar is translated off-screen when hidden; offsetHeight still reflects
      // the laid-out height regardless of transform.
      const h = el.offsetHeight;
      if (h > 0) setBottomBarHeight(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMounted]);

  // Keep thread page ref in sync for the scroll handler (which runs in a [] effect).
  // Also force the bottom bar visible on arrival so a previously-hidden bar
  // (e.g., from scrolling a non-thread page) doesn't stay hidden here.
  useEffect(() => {
    const onThreadPage = pathname.startsWith('/thread/');
    isThreadPageRef.current = onThreadPage;
    if (onThreadPage) setShowBottomBar(true);
  }, [pathname]);

  // Detect PWA standalone mode once — these are device constants that never change mid-session.
  useEffect(() => {
    setIsStandalone(isStandalonePWA());
    setIsIOSPWA(isIOSSPWAStandalone());
    // Mobile touch device: has touch AND coarse pointer (excludes desktops with touchscreens
    // used primarily with a mouse, where native browser PTR isn't expected anyway).
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    setNeedsCustomPTR(hasTouch && coarsePointer);
  }, []);

  // Set mounted state for portal rendering + install client log forwarder on dev sites
  useEffect(() => {
    setIsMounted(true);
    installClientLogForwarder();

    // Reload on ChunkLoadError — stale cached chunks after a new deploy.
    const handleChunkError = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      if (err?.name === 'ChunkLoadError' || err?.message?.includes('Failed to load chunk')) {
        window.location.reload();
      }
    };
    window.addEventListener('unhandledrejection', handleChunkError);
    return () => window.removeEventListener('unhandledrejection', handleChunkError);
  }, []);

  // Preload the create-poll chunk during idle time so it's instant when the user taps "+".
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(() => importCreatePoll(), { timeout: 3000 });
      return () => cancelIdleCallback(id);
    } else {
      const t = setTimeout(() => importCreatePoll(), 1500);
      return () => clearTimeout(t);
    }
  }, []);
  
  // Determine initial state based on pathname to avoid layout shift
  const getInitialPageTitle = () => {
    if (pathname === '/create-poll' || pathname === '/create-poll/') return 'Ask For…';
    return '';
  };
  
  const getInitialLeftElement = () => {
    return <div className="w-6 h-6" />; // spacer since profile button is now in bottom bar
  };
  
  const [pageTitle, setPageTitle] = useState(getInitialPageTitle());
  const [leftElement, setLeftElement] = useState<React.ReactNode>(getInitialLeftElement());
  const [rightElement, setRightElement] = useState<React.ReactNode>(<div className="w-6 h-6" />);
  // Initialize pollPageTitle synchronously from the poll cache on poll pages,
  // so the header shows the title on the very first paint after navigation
  // (avoids the h1 being empty during a view transition slide).
  const [pollPageTitle, setPollPageTitle] = useState(() => {
    if (typeof window === 'undefined') return '';
    const match = pathname.match(/^\/p\/([^/]+)\/?$/);
    if (!match) return '';
    const id = match[1];
    const poll = isUuidLike(id) ? getCachedPollById(id) : getCachedPollByShortId(id);
    return poll?.title ?? '';
  });

  // Long-press detection for opening the debug modal (replaces simple tap)
  const { props: longPressProps } = useLongPress(() =>
    window.dispatchEvent(new Event('openCommitInfo'))
  );

  // Determine page-specific header content based on pathname
  useEffect(() => {
    if (pathname === '/') {
      setPageTitle('');
      setLeftElement(<div className="w-6 h-6" />); // spacer
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else if (pathname === '/create-poll' || pathname === '/create-poll/') {
      setPageTitle('Create Poll');
      setLeftElement(<div className="w-6 h-6" />); // spacer
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else if (pathname.startsWith('/p/')) {
      // Poll pages - title will be set by the page content via custom event
      setPageTitle(pollPageTitle);
      setLeftElement(<div className="w-6 h-6" />); // spacer
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else {
      setPageTitle('');
      setLeftElement(<div className="w-6 h-6" />); // spacer
      setRightElement(<div className="w-6 h-6" />); // spacer
    }
  }, [pathname, pollPageTitle]);

  // Listen for title changes from poll pages
  useEffect(() => {
    const handleTitleChange = (event: CustomEvent) => {
      setPollPageTitle(event.detail.title);
    };

    window.addEventListener('pageTitleChange', handleTitleChange as EventListener);

    return () => {
      window.removeEventListener('pageTitleChange', handleTitleChange as EventListener);
    };
  }, []);

  // Handle scroll direction detection for bottom bar.
  // The document is the scroller — uses touch events (reliable on iOS) as the
  // primary mechanism and window scroll as a fallback for desktop mouse wheel.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let rAFId: number | null = null;

    // Track current visibility to avoid no-op setState calls during scroll
    let isVisible = true;
    const setVisible = (visible: boolean) => {
      // Never hide bottom bar on thread pages
      if (isThreadPageRef.current) visible = true;
      if (visible !== isVisible) {
        isVisible = visible;
        setShowBottomBar(visible);
      }
    };

    const getScrollTop = () => window.scrollY;
    const getMaxScroll = () =>
      document.documentElement.scrollHeight - window.innerHeight;
    const isNearTop = (pos: number) => pos < SCROLL_TOP_SAFE_ZONE;

    // --- Touch-based direction detection (primary on iOS) ---
    let touchStartScrollTop = 0;

    const handleTouchStart = () => {
      touchStartScrollTop = getScrollTop();
    };

    const handleTouchEnd = () => {
      const pos = getScrollTop();
      if (isNearTop(pos)) { setVisible(true); return; }
      const delta = pos - touchStartScrollTop;
      if (Math.abs(delta) >= scrollThreshold.current) {
        setVisible(delta < 0); // scrolled up → show, scrolled down → hide
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    // --- Scroll event fallback (desktop mouse wheel + browser scroll) ---
    const processScroll = () => {
      rAFId = null;
      const currentScrollY = getScrollTop();
      const maxScrollY = getMaxScroll();

      if (isNearTop(currentScrollY)) {
        setVisible(true);
        lastScrollY.current = currentScrollY;
        return;
      }

      // iOS rubber band past the bottom — ignore
      if (currentScrollY > maxScrollY) {
        isInBounceRef.current = true;
        if (bounceTimeoutRef.current) clearTimeout(bounceTimeoutRef.current);
        bounceTimeoutRef.current = setTimeout(() => {
          isInBounceRef.current = false;
          bounceTimeoutRef.current = null;
        }, 150);
        lastScrollY.current = maxScrollY;
        return;
      }

      if (isInBounceRef.current) {
        lastScrollY.current = currentScrollY;
        return;
      }

      const scrollDifference = Math.abs(currentScrollY - lastScrollY.current);
      if (scrollDifference >= scrollThreshold.current) {
        setVisible(currentScrollY < lastScrollY.current);
      }

      lastScrollY.current = currentScrollY;
    };

    const handleScroll = () => {
      if (rAFId === null) {
        rAFId = requestAnimationFrame(processScroll);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('scroll', handleScroll);
      if (rAFId !== null) cancelAnimationFrame(rAFId);
      if (bounceTimeoutRef.current) clearTimeout(bounceTimeoutRef.current);
    };
  }, []);

  // Pull-to-refresh for all mobile touch devices (PWA + mobile web).
  // The document is the scroller; the transform is applied to <body> so the
  // whole page translates with the drag. Native PTR is suppressed via
  // overscroll-behavior:none on html/body (globals.css).
  //
  // All listeners are PASSIVE — no e.preventDefault(). Calling preventDefault
  // on even a 1px downward touchmove causes iOS to classify the entire gesture
  // as non-scrollable, permanently blocking scroll for that touch. We track
  // pull distance purely from touch position deltas.
  useEffect(() => {
    if (typeof window === 'undefined' || !needsCustomPTR) return;

    const body = document.body;

    let startY = 0;
    let isAtTop = true;
    let isDragging = false;
    let currentPullDistance = 0;
    let refreshTriggered = false;
    let rAFId: number | null = null;
    let snapBackTimeout: ReturnType<typeof setTimeout> | null = null;

    const updateDOM = (distance: number) => {
      const damped = distance * 0.5;
      body.style.transform = `translateY(${damped}px)`;
      body.style.transition = 'none';

      const indicator = pullIndicatorRef.current;
      if (indicator) {
        const fadeStart = PTR_INDICATOR_SIZE * 0.5;
        const fadeEnd = PTR_INDICATOR_SIZE;
        indicator.style.opacity = String(Math.min(Math.max((damped - fadeStart) / (fadeEnd - fadeStart), 0), 1));
        indicator.style.transition = 'none';
      }

      const arc = pullArcRef.current;
      if (arc) {
        const pastThreshold = distance >= PTR_THRESHOLD;
        arc.style.strokeDasharray = `${Math.min(distance / PTR_THRESHOLD, 1) * PTR_CIRCUMFERENCE} ${PTR_CIRCUMFERENCE}`;
        arc.classList.toggle('text-blue-600', pastThreshold);
        arc.classList.toggle('dark:text-blue-400', pastThreshold);
        arc.classList.toggle('text-gray-400', !pastThreshold);
        arc.classList.toggle('dark:text-gray-500', !pastThreshold);
      }
    };

    // Walk up from the touch target looking for an inner scrollable ancestor
    // (thread list, modal content, dropdown, etc.). If any nested scroller
    // isn't at its top, PTR must NOT fire — the user is scrolling something
    // inside. Only fire PTR when the document AND every nested scroller above
    // the touch target are at their top.
    const nestedScrollerAboveTop = (target: HTMLElement): boolean => {
      let el: HTMLElement | null = target;
      while (el && el !== body) {
        if (el.scrollHeight > el.clientHeight) {
          const oy = getComputedStyle(el).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && el.scrollTop > 5) return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (refreshTriggered) return;
      startY = e.touches[0].clientY;
      const docAtTop = window.scrollY <= 5;
      isAtTop = docAtTop && !nestedScrollerAboveTop(e.target as HTMLElement);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (refreshTriggered || !isAtTop) return;

      // Skip when a modal is open
      const target = e.target as HTMLElement;
      if (target.closest('[data-modal]')) return;

      const rawDelta = e.touches[0].clientY - startY;

      if (rawDelta > 10) {
        if (!isDragging) {
          isDragging = true;
          // Cancel any pending snap-back from a previous gesture
          if (snapBackTimeout) { clearTimeout(snapBackTimeout); snapBackTimeout = null; }
          setPullActive(true);
        }
        currentPullDistance = rawDelta;
        if (rAFId === null) {
          rAFId = requestAnimationFrame(() => {
            rAFId = null;
            updateDOM(currentPullDistance);
          });
        }
      } else if (isDragging && rawDelta <= 10) {
        isDragging = false;
        currentPullDistance = 0;
        body.style.transform = '';
        body.style.transition = '';
        setPullActive(false);
      }
    };

    const handleTouchEnd = () => {
      if (refreshTriggered) return;

      if (isDragging && currentPullDistance >= PTR_THRESHOLD) {
        refreshTriggered = true;
        setIsRefreshing(true);
        setTimeout(() => window.location.reload(), 400);
      } else if (isDragging) {
        body.style.transition = 'transform 0.3s ease';
        body.style.transform = 'translateY(0px)';
        const indicator = pullIndicatorRef.current;
        if (indicator) {
          indicator.style.transition = 'opacity 0.3s ease';
          indicator.style.opacity = '0';
        }
        snapBackTimeout = setTimeout(() => {
          body.style.transition = '';
          body.style.transform = '';
          setPullActive(false);
          snapBackTimeout = null;
        }, 300);
      } else {
        // Clear any stale transform
        body.style.transform = '';
        body.style.transition = '';
      }

      isDragging = false;
      currentPullDistance = 0;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      body.style.transform = '';
      body.style.transition = '';
      if (rAFId !== null) cancelAnimationFrame(rAFId);
      if (snapBackTimeout) clearTimeout(snapBackTimeout);
    };
  }, [needsCustomPTR]);

  const isPollPage = pathname.startsWith('/p/');
  const isThreadPage = pathname.startsWith('/thread/');
  // /p/<id> now renders the thread view with a card expanded; both routes share the
  // thread-page layout (fixed header + scroll list) and the thread's own back button.
  const isThreadLikePage = isThreadPage || isPollPage;
  const isCreateModalOpen = searchParams.has('create');
  const isProfilePage = pathname === '/profile' || pathname === '/profile/';
  const [modalClosing, setModalClosing] = useState(false);

  // Refs for modal drag-to-dismiss — uses direct DOM manipulation for 60fps.
  const modalSheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const modalScrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({
    startY: 0,
    currentTranslate: 0,
    isDragging: false,
    startedInHeader: false,
    startedInScrollableChild: false,
    isClosing: false,
    rAFPending: false,
    rAFId: 0,
    lastMoveTime: 0,
    lastMoveY: 0,
  });
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Stable ref for close navigation — avoids searchParams in deps, preventing listener churn.
  const navigateCloseModalRef = useRef(() => {});
  useEffect(() => {
    navigateCloseModalRef.current = () => {
      const params = new URLSearchParams(searchParams.toString());
      ['create', 'followUpTo', 'fork', 'duplicate', 'voteFromSuggestion', 'mode']
        .forEach(p => params.delete(p));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    };
  }, [router, pathname, searchParams]);

  const handleCloseCreateModal = useCallback(() => {
    if (dragState.current.isClosing) return;
    dragState.current.isClosing = true;
    setModalClosing(true);
    closeTimerRef.current = setTimeout(() => {
      navigateCloseModalRef.current();
    }, 300);
  }, []);

  // Drag-to-dismiss touch handling for the create poll modal sheet.
  useEffect(() => {
    if (!isCreateModalOpen || !isMounted) return;
    const sheet = modalSheetRef.current;
    if (!sheet) return;

    const state = dragState.current;

    const updateDOM = () => {
      state.rAFPending = false;
      const t = state.currentTranslate;
      if (modalSheetRef.current) {
        modalSheetRef.current.style.transform = `translateY(${t}px)`;
      }
      if (backdropRef.current) {
        const h = modalSheetRef.current?.offsetHeight || window.innerHeight;
        const progress = Math.min(t / (h * 0.5), 1);
        backdropRef.current.style.opacity = String(1 - progress * 0.7);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (state.isClosing) return;
      state.startY = e.touches[0].clientY;
      state.isDragging = false;
      state.currentTranslate = 0;
      state.lastMoveTime = Date.now();
      state.lastMoveY = e.touches[0].clientY;
      const scrollEl = modalScrollRef.current;
      if (scrollEl) {
        const rect = scrollEl.getBoundingClientRect();
        state.startedInHeader = e.touches[0].clientY < rect.top;
      }
      // Check if touch started inside a scrollable child (e.g. autocomplete dropdown).
      // If so, don't engage drag-to-dismiss — let the child scroll naturally.
      // Only check for overflow-y style, not scrollHeight vs clientHeight — the height
      // check has edge cases near the max-height boundary that cause false negatives.
      state.startedInScrollableChild = false;
      if (scrollEl) {
        let el = e.target as HTMLElement | null;
        while (el && el !== scrollEl) {
          const overflowY = window.getComputedStyle(el).overflowY;
          if (overflowY === 'auto' || overflowY === 'scroll') {
            state.startedInScrollableChild = true;
            break;
          }
          el = el.parentElement;
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (state.isClosing) return;
      const touchY = e.touches[0].clientY;
      const deltaY = touchY - state.startY;

      if (!state.isDragging) {
        const scrollEl = modalScrollRef.current;
        const scrollAtTop = !scrollEl || scrollEl.scrollTop <= 0;
        if (!(state.startedInHeader || (!state.startedInScrollableChild && scrollAtTop && deltaY > 5))) return;
        state.isDragging = true;
        if (scrollEl) scrollEl.style.overflowY = 'hidden';
        if (modalSheetRef.current) modalSheetRef.current.style.transition = 'none';
        if (backdropRef.current) backdropRef.current.style.transition = 'none';
      }

      // Track velocity from the last few touchmove events
      state.lastMoveTime = Date.now();
      state.lastMoveY = touchY;

      state.currentTranslate = Math.max(0, deltaY);
      if (!state.rAFPending) {
        state.rAFPending = true;
        state.rAFId = requestAnimationFrame(updateDOM);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!state.isDragging || state.isClosing) return;
      state.isDragging = false;

      // Cancel any pending rAF so it doesn't overwrite the animation.
      if (state.rAFPending) {
        cancelAnimationFrame(state.rAFId);
        state.rAFPending = false;
      }

      const scrollEl = modalScrollRef.current;
      if (scrollEl) scrollEl.style.overflowY = '';

      const modalHeight = modalSheetRef.current?.offsetHeight || window.innerHeight;
      const threshold = modalHeight * 0.33;

      // Compute downward velocity (px/ms) from the last touchmove to touchend.
      const endY = e.changedTouches[0].clientY;
      const dt = Date.now() - state.lastMoveTime;
      const velocity = dt > 0 ? (endY - state.lastMoveY) / dt : 0;
      // Dismiss if past halfway OR flicked downward fast (>0.5 px/ms ≈ 500px/s).
      const shouldClose = state.currentTranslate > threshold || (velocity > 0.5 && state.currentTranslate > 30);

      if (shouldClose) {
        // Past halfway — close. Must force reflow between setting transition
        // and target value, otherwise browser skips the animation (transition
        // was 'none' during drag).
        state.isClosing = true;
        if (modalSheetRef.current) {
          modalSheetRef.current.style.transition = 'transform 0.3s ease-in';
          modalSheetRef.current.offsetHeight; // force reflow
          modalSheetRef.current.style.transform = 'translateY(100%)';
        }
        if (backdropRef.current) {
          backdropRef.current.style.transition = 'opacity 0.3s ease-in';
          backdropRef.current.offsetHeight;
          backdropRef.current.style.opacity = '0';
        }
        closeTimerRef.current = setTimeout(() => {
          navigateCloseModalRef.current();
        }, 300);
      } else {
        // Under halfway — spring back
        if (modalSheetRef.current) {
          modalSheetRef.current.style.transition = 'transform 0.3s ease-out';
          modalSheetRef.current.offsetHeight;
          modalSheetRef.current.style.transform = '';
        }
        if (backdropRef.current) {
          backdropRef.current.style.transition = 'opacity 0.3s ease-out';
          backdropRef.current.offsetHeight;
          backdropRef.current.style.opacity = '';
        }
        setTimeout(() => {
          if (modalSheetRef.current) modalSheetRef.current.style.transition = '';
          if (backdropRef.current) backdropRef.current.style.transition = '';
        }, 300);
      }
      state.currentTranslate = 0;
    };

    sheet.addEventListener('touchstart', onTouchStart, { passive: true });
    sheet.addEventListener('touchmove', onTouchMove, { passive: true });
    sheet.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      sheet.removeEventListener('touchstart', onTouchStart);
      sheet.removeEventListener('touchmove', onTouchMove);
      sheet.removeEventListener('touchend', onTouchEnd);
    };
  }, [isCreateModalOpen, isMounted]);

  // Lock body scroll when create-poll modal is open to prevent browser pull-to-refresh.
  // On iOS, overflow:hidden alone doesn't prevent native PTR — position:fixed is required.
  useEffect(() => {
    if (!isCreateModalOpen) return;
    // Reset stale close state from previous dismiss
    setModalClosing(false);
    dragState.current.isClosing = false;
    const scrollY = window.scrollY;
    const html = document.documentElement;
    html.style.overscrollBehavior = 'none';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
    return () => {
      // Cancel any pending close animation timeout to prevent stale navigation.
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      html.style.overscrollBehavior = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, [isCreateModalOpen]);

  return (
    <>
      {/* Pull-to-refresh indicator — rendered via portal to escape scaling container.
           Uses refs for direct DOM updates during drag (no React re-renders). */}
      {needsCustomPTR && (pullActive || isRefreshing) && isMounted && createPortal(
        <div
          ref={pullIndicatorRef}
          className="fixed left-0 right-0 z-[9999] flex justify-center pointer-events-none"
          style={{
            top: 'calc(env(safe-area-inset-top, 0px) + 2px)',
            opacity: isRefreshing ? 1 : 0,
          }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-full shadow-lg p-2">
            {isRefreshing ? (
              <svg className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" className="text-gray-200 dark:text-gray-600" strokeWidth="2.5" />
                <circle
                  ref={pullArcRef}
                  cx="12" cy="12" r="10" stroke="currentColor"
                  className="text-gray-400 dark:text-gray-500"
                  strokeWidth="2.5" strokeLinecap="round"
                  strokeDasharray={`0 ${PTR_CIRCUMFERENCE}`}
                  transform="rotate(-90 12 12)"
                />
              </svg>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Fixed Header - skip for poll, create poll, profile, thread, and home pages.
          Uses position:sticky so it stays pinned during document scroll. */}
      {!isPollPage && !isThreadPage && !isProfilePage && pathname !== '/' && (
        <div className="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700"
             style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="relative flex items-start justify-between pt-2 pb-2 pl-2 pr-2.5">
            <div className="flex items-center justify-center">
              {leftElement}
            </div>
            {pageTitle && (
              <div className="absolute left-1/2 top-1/2" style={{transform: 'translate(-50%, -50%) translateY(0.125em) translateX(-0.5rem)'}}>
                <h1
                  className="text-xl font-bold text-center break-words select-none whitespace-nowrap"
                  {...longPressProps}
                >
                  {pageTitle}
                </h1>
              </div>
            )}
            <div className="flex items-center justify-center">
              {rightElement}
            </div>
          </div>
        </div>
      )}

      {/* Document-scroll content wrapper. Bottom padding reserves space for the
          fixed bottom bar when visible; collapses to 0 in lockstep with the
          bar's 200ms slide-out so no white gap remains. */}
      <div
        style={{
          paddingLeft: 'max(0.35rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.35rem, env(safe-area-inset-right))',
          paddingBottom: showBottomBar ? `${bottomBarHeight}px` : '0',
          transition: 'padding-bottom 200ms ease-out',
        }}>
        {/* Commit age badge portal target — position:fixed, anchored to the
             top safe-area boundary via .pwa-badge-top. z-30 keeps it above the
             thread page's fixed header (z-20). */}
        {isMounted && <div id="commit-badge-portal" className="fixed left-0 right-0 z-30 pwa-badge-top"></div>}

        {/* Profile page title */}
        {isProfilePage && (
          <div
            className="max-w-4xl mx-auto px-16 pt-4 pb-1"
            style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
          >
            <h1 className="text-2xl font-bold text-center break-words select-none" {...longPressProps}>
              Profile
            </h1>
          </div>
        )}

        {/* Home page title */}
        {pathname === '/' && (
          <div
            className="relative max-w-4xl mx-auto px-2 pt-4 pb-1"
            style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
          >
            <div className="text-center">
              <h1 className="text-2xl font-bold mb-1 select-none" {...longPressProps}>
                Whoever Wants
              </h1>
              <div className="h-7 flex items-center justify-center mb-1" id="home-phrase-content">
                {/* Blue phrase will be injected here */}
              </div>
            </div>
          </div>
        )}

        <div className={`max-w-4xl mx-auto ${(pathname === '/' || isThreadLikePage) ? '-mx-4 sm:mx-auto sm:px-4' : 'px-4'} ${isThreadLikePage ? '' : (isProfilePage || pathname === '/') ? 'pt-0.5 pb-6' : 'py-6'}`}>
          {children}
        </div>
      </div>

      {/* Create poll modal - iOS-style sheet rendered via portal.
           Triggered by ?create query param so the underlying page stays mounted. */}
      {isCreateModalOpen && isMounted && createPortal(
        <div className="fixed inset-0 z-[60]">
          {/* Backdrop */}
          <div
            ref={backdropRef}
            className={`absolute inset-0 bg-black/40 ${modalClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
            onClick={handleCloseCreateModal}
          />
          {/* Modal sheet */}
          <div
            ref={modalSheetRef}
            className={`absolute bottom-0 left-0 right-0 rounded-t-[32px] bg-white dark:bg-gray-900 flex flex-col shadow-2xl ${
              modalClosing ? 'animate-slide-down' : 'animate-slide-up'
            }`}
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 15px)', overscrollBehavior: 'none' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex-shrink-0 flex justify-center pt-2.5 pb-1">
              <div className="w-9 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
            </div>
            {/* Header */}
            <div className="flex-shrink-0 relative flex items-center justify-between px-4 pb-2">
              <button
                onClick={handleCloseCreateModal}
                className="w-[43px] h-[43px] flex items-center justify-center rounded-full bg-gray-200/80 dark:bg-gray-700/80 cursor-pointer z-10"
                aria-label="Close"
              >
                <svg className="w-[34px] h-[34px] text-black dark:text-white" fill="none" viewBox="0 0 24 24">
                  <path stroke="currentColor" strokeLinecap="round" strokeWidth={0.75} d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
              <h2 className="absolute inset-0 flex items-center justify-center text-[17px] font-semibold pointer-events-none">New Poll</h2>
              <div id="create-poll-submit-portal" className="flex-shrink-0 z-10" />
            </div>
            {/* Generated title line */}
            <div id="create-poll-title-portal" className="flex-shrink-0 px-4" />
            {/* Scrollable content */}
            <div ref={modalScrollRef} className="flex-1 overflow-auto overscroll-contain">
              <div className="max-w-4xl mx-auto px-4 pt-2 pb-8">
                <Suspense fallback={
                  <div className="flex justify-center items-center py-20">
                    <svg className="animate-spin h-8 w-8 text-gray-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                }>
                  <LazyCreatePollContent />
                </Suspense>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Scroll-aware bottom bar - rendered via portal outside scaled container */}
      {isMounted && createPortal(
        <div
          ref={bottomBarRef}
          className={`fixed left-0 right-0 bottom-0 z-50 border-t border-gray-300 dark:border-gray-600 bg-gray-200/95 dark:bg-gray-800/95 backdrop-blur-sm pwa-bottom-bar ${
            showBottomBar ? '' : 'pointer-events-none'
          }`}
          style={{
            // Bottom padding handled by .pwa-bottom-bar CSS class (1x default, 2x in standalone).
            transform: showBottomBar ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 200ms ease-out',
            willChange: 'transform',
          }}
        >
        <div className="flex items-center justify-evenly py-1.5">
          {/* Home button */}
          <button
            onClick={pathname === '/' ? undefined : () => navigateWithTransition(router, '/', 'back')}
            {...prefetchOnHover('/')}
            className="flex flex-col items-center gap-0.5 min-w-[64px] cursor-pointer"
            aria-label="Go to home"
            disabled={pathname === '/'}
          >
            <svg className={`w-6 h-6 ${
              pathname === '/'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className={`text-[10px] font-medium ${
              pathname === '/'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}>Home</span>
          </button>

          {/* Create poll button */}
          <button
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              params.set('create', '1');
              // When on a thread page, auto-set followUpTo for the latest poll
              const threadLatestPollId = document.body.getAttribute('data-thread-latest-poll-id');
              if (threadLatestPollId) {
                params.set('followUpTo', threadLatestPollId);
              }
              router.push(`${pathname}?${params.toString()}`);
            }}
            className="flex flex-col items-center gap-0.5 min-w-[64px] cursor-pointer"
            aria-label="Create new poll"
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isCreateModalOpen
                ? 'bg-blue-600 dark:bg-blue-500'
                : 'bg-blue-500 dark:bg-blue-600'
            } shadow-md`}>
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
          </button>

          {/* Profile button */}
          <button
            onClick={isProfilePage ? undefined : () => navigateWithTransition(router, '/profile', 'forward')}
            {...prefetchOnHover('/profile')}
            className="flex flex-col items-center gap-0.5 min-w-[64px] cursor-pointer"
            aria-label="Profile"
            disabled={isProfilePage}
          >
            <svg className={`w-6 h-6 ${
              isProfilePage
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className={`text-[10px] font-medium ${
              isProfilePage
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}>Profile</span>
          </button>
        </div>
        </div>,
        document.getElementById('bottom-bar-portal')!
      )}

      {/* Header elements rendered outside scaling container */}
      <HeaderPortal>
        {/* Back arrow in upper left. Thread-like pages render their own back
             button in their fixed header — only the profile page still uses the
             template's portal back arrow, and only when there's in-app history. */}
        {(isProfilePage && hasAppHistory) && (
          <div className="fixed left-0 z-50" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}>
            <button
              onClick={() => {
                // Newly-created poll pages have a custom back target (the
                // thread containing the poll) — `replace` mode so `back` from
                // the thread skips over the poll rather than returning to it.
                const pollRouteId = extractPollRouteId(pathname);
                const customBack = pollRouteId && pollBackTarget.consume(pollRouteId);
                if (customBack) {
                  navigateWithTransition(router, customBack, 'back', { mode: 'replace' });
                  return;
                }
                // Otherwise route back to the thread containing this poll.
                // Standalone polls resolve to /thread/<itself>.
                if (pollRouteId) {
                  const currentPoll = isUuidLike(pollRouteId)
                    ? getCachedPollById(pollRouteId)
                    : getCachedPollByShortId(pollRouteId);
                  if (currentPoll) {
                    const rootRouteId = findThreadRootRouteId(currentPoll, getCachedPollById);
                    navigateWithTransition(router, `/thread/${rootRouteId}`, 'back');
                    return;
                  }
                }
                navigateBackWithTransition();
              }}
              className="w-12 h-16 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
              aria-label="Go back"
            >
              <svg className="w-7 h-7 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        )}
        
      </HeaderPortal>
    </>
  );
}