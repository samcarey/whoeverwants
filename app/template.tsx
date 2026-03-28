"use client";

import React, { useEffect, useState, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import FloatingCopyLinkButton from '@/components/FloatingCopyLinkButton';
import HeaderPortal from '@/components/HeaderPortal';

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

// Session-scoped in-app navigation counter (per-tab, cleared on tab close).
const NAV_COUNT_KEY = 'app_nav_count';

// Pull-to-refresh constants (iOS PWA only)
const PTR_THRESHOLD = 240;  // px of raw touch movement to trigger refresh
const PTR_CIRCUMFERENCE = 2 * Math.PI * 10; // SVG arc circumference (radius=10)
const PTR_INDICATOR_SIZE = 40; // approx height of circle + padding

export default function Template({ children }: AppTemplateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isStandalone, setIsStandalone] = useState(false);
  const [hasAppHistory, setHasAppHistory] = useState(false);
  const [showBottomBar, setShowBottomBar] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const [isIOSPWA, setIsIOSPWA] = useState(false);
  const lastScrollY = useRef(0);
  const scrollThreshold = useRef(5); // Minimum scroll distance to trigger hide/show
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInBounceRef = useRef(false);

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

  // Detect PWA standalone mode once — these are device constants that never change mid-session.
  useEffect(() => {
    setIsStandalone(isStandalonePWA());
    setIsIOSPWA(isIOSSPWAStandalone());
  }, []);

  // Set mounted state for portal rendering
  useEffect(() => {
    setIsMounted(true);
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
  const [pollPageTitle, setPollPageTitle] = useState('');
  const [createPollCategory, setCreatePollCategory] = useState<'nomination' | 'poll' | 'participation'>('nomination');

  // Determine page-specific header content based on pathname
  useEffect(() => {
    if (pathname === '/') {
      setPageTitle('');
      setLeftElement(<div className="w-6 h-6" />); // spacer
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else if (pathname === '/create-poll' || pathname === '/create-poll/') {
      setPageTitle('Ask For…');
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

  // Listen for poll category changes from create-poll page
  useEffect(() => {
    const handlePollCategoryChange = (event: CustomEvent) => {
      setCreatePollCategory(event.detail.pollCategory);
    };

    window.addEventListener('pollCategoryChange', handlePollCategoryChange as EventListener);

    return () => {
      window.removeEventListener('pollCategoryChange', handlePollCategoryChange as EventListener);
    };
  }, []);

  // Handle scroll direction detection for bottom bar
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let rAFId: number | null = null;
    let scrollContainer: HTMLElement | null = null;

    // Track current visibility to avoid no-op setState calls during scroll
    let isVisible = true;
    const setVisible = (visible: boolean) => {
      if (visible !== isVisible) {
        isVisible = visible;
        setShowBottomBar(visible);
      }
    };

    const processScroll = () => {
      rAFId = null;
      if (!scrollContainer) return;

      const currentScrollY = scrollContainer.scrollTop;
      const maxScrollY = scrollContainer.scrollHeight - scrollContainer.clientHeight;

      if (currentScrollY <= 0) {
        setVisible(true);
        lastScrollY.current = currentScrollY;
        return;
      }

      // iOS rubber band past the bottom — ignore and clamp lastScrollY
      if (currentScrollY > maxScrollY) {
        isInBounceRef.current = true;
        if (bounceTimeoutRef.current) {
          clearTimeout(bounceTimeoutRef.current);
        }
        bounceTimeoutRef.current = setTimeout(() => {
          isInBounceRef.current = false;
          bounceTimeoutRef.current = null;
        }, 150);
        lastScrollY.current = maxScrollY;
        return;
      }

      // Scroll position is unreliable during bounce cooldown
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

    const timeoutId = setTimeout(() => {
      scrollContainer = scrollContainerRef.current;
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
      }
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      if (rAFId !== null) {
        cancelAnimationFrame(rAFId);
      }
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', handleScroll);
      }
      if (bounceTimeoutRef.current) {
        clearTimeout(bounceTimeoutRef.current);
      }
    };
  }, []);

  // Pull-to-refresh for iOS PWA standalone mode only.
  // Uses direct DOM manipulation during touchmove for 60fps updates.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Log detection details regardless of result
    console.log('[PTR] detection: navigator.standalone=' + isIOSSPWAStandalone() + ', isIOSPWA=' + isIOSPWA);

    if (!isIOSPWA) {
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      console.warn('[PTR] scrollContainerRef.current is null — cannot attach');
      return;
    }
    console.log('[PTR] attaching touch handlers, scrollContainer.scrollTop=' + scrollContainer.scrollTop + ', overflow=' + getComputedStyle(scrollContainer).overflow);

    // Prevent native overscroll bounce on both the scroll container AND body/html.
    // iOS PWA standalone mode has body { overflow: auto } from globals.css which
    // creates a competing scrollable layer whose bounce steals the pull gesture.
    scrollContainer.style.overscrollBehaviorY = 'none';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';

    let startY = 0;
    let isAtTop = true;
    let isDragging = false;
    let currentPullDistance = 0;
    let refreshTriggered = false;
    let rAFPending = false;
    let snapBackTimeout: ReturnType<typeof setTimeout> | null = null;
    let touchMoveCount = 0;

    const updateDOM = (distance: number) => {
      const damped = distance * 0.5;
      scrollContainer.style.transform = `translateY(${damped}px)`;
      scrollContainer.style.transition = 'none';

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
        // Tailwind classes toggled imperatively — these classes also exist in the
        // JSX below (spinner SVG) so they won't be purged from the CSS bundle.
        arc.classList.toggle('text-blue-600', pastThreshold);
        arc.classList.toggle('dark:text-blue-400', pastThreshold);
        arc.classList.toggle('text-gray-400', !pastThreshold);
        arc.classList.toggle('dark:text-gray-500', !pastThreshold);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (refreshTriggered) return;
      startY = e.touches[0].clientY;
      isAtTop = scrollContainer.scrollTop <= 5;
      touchMoveCount = 0;
      console.log('[PTR] touchstart: startY=' + startY + ', scrollTop=' + scrollContainer.scrollTop + ', isAtTop=' + isAtTop);
    };

    const handleTouchMove = (e: TouchEvent) => {
      touchMoveCount++;
      if (refreshTriggered || !isAtTop) {
        if (touchMoveCount <= 3) {
          console.log('[PTR] touchmove #' + touchMoveCount + ' SKIPPED: refreshTriggered=' + refreshTriggered + ', isAtTop=' + isAtTop);
        }
        return;
      }

      // Skip pull-to-refresh when a modal is open (e.g. time picker)
      const target = e.target as HTMLElement;
      if (target.closest('[data-modal]')) {
        return;
      }

      const rawDelta = e.touches[0].clientY - startY;

      // Log first few touchmove events to diagnose gesture capture
      if (touchMoveCount <= 5) {
        console.log('[PTR] touchmove #' + touchMoveCount + ': rawDelta=' + rawDelta.toFixed(1) + ', isDragging=' + isDragging + ', cancelable=' + e.cancelable);
      }

      // Prevent default IMMEDIATELY for any downward movement at the top.
      // iOS's gesture recognizer claims the touch within the first few touchmove
      // events. If we wait (e.g. 10px) before calling preventDefault, iOS starts
      // native overscroll bounce and ignores our later preventDefault calls.
      if (rawDelta > 0) {
        e.preventDefault();
      }

      if (rawDelta > 10) {
        if (!isDragging) {
          isDragging = true;
          console.log('[PTR] drag started at rawDelta=' + rawDelta.toFixed(1));
          setPullActive(true);
        }
        currentPullDistance = rawDelta;
        if (!rAFPending) {
          rAFPending = true;
          requestAnimationFrame(() => {
            rAFPending = false;
            updateDOM(currentPullDistance);
          });
        }
      } else if (isDragging && rawDelta <= 10) {
        isDragging = false;
        currentPullDistance = 0;
        updateDOM(0);
        setPullActive(false);
      }
    };

    const handleTouchEnd = () => {
      console.log('[PTR] touchend: isDragging=' + isDragging + ', distance=' + currentPullDistance + ', threshold=' + PTR_THRESHOLD + ', totalMoves=' + touchMoveCount);
      if (refreshTriggered) return;

      if (isDragging && currentPullDistance >= PTR_THRESHOLD) {
        refreshTriggered = true;
        setIsRefreshing(true);
        setTimeout(() => window.location.reload(), 400);
      } else if (isDragging) {
        scrollContainer.style.transition = 'transform 0.3s ease';
        scrollContainer.style.transform = 'translateY(0px)';
        const indicator = pullIndicatorRef.current;
        if (indicator) {
          indicator.style.transition = 'opacity 0.3s ease';
          indicator.style.opacity = '0';
        }
        snapBackTimeout = setTimeout(() => {
          scrollContainer.style.transition = '';
          scrollContainer.style.transform = '';
          setPullActive(false);
          snapBackTimeout = null;
        }, 300);
      }

      isDragging = false;
      currentPullDistance = 0;
    };

    scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    scrollContainer.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      scrollContainer.removeEventListener('touchstart', handleTouchStart);
      scrollContainer.removeEventListener('touchmove', handleTouchMove);
      scrollContainer.removeEventListener('touchend', handleTouchEnd);
      scrollContainer.style.overscrollBehaviorY = '';
      document.body.style.overscrollBehavior = '';
      document.documentElement.style.overscrollBehavior = '';
      scrollContainer.style.transform = '';
      scrollContainer.style.transition = '';
      if (snapBackTimeout) clearTimeout(snapBackTimeout);
    };
  }, [isIOSPWA]);

  const isPollPage = pathname.startsWith('/p/');
  const isCreatePollPage = pathname === '/create-poll' || pathname === '/create-poll/';
  const isProfilePage = pathname === '/profile' || pathname === '/profile/';

  return (
    <>
      {/* Pull-to-refresh indicator — rendered via portal to escape scaling container.
           Uses refs for direct DOM updates during drag (no React re-renders). */}
      {isIOSPWA && (pullActive || isRefreshing) && isMounted && createPortal(
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

      {/* Fixed Header - skip for poll, create poll, profile, and home pages */}
      {!isPollPage && !isCreatePollPage && !isProfilePage && pathname !== '/' && (
        <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700" 
             style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="relative flex items-start justify-between pt-2 pb-2 pl-2 pr-2.5">
            {/* Left element - stays at top */}
            <div className="flex items-center justify-center">
              {leftElement}
            </div>
            
            {/* Title - vertically centered with slight downward and leftward offset */}
            {pageTitle && (
              <div className="absolute left-1/2 top-1/2" style={{transform: 'translate(-50%, -50%) translateY(0.125em) translateX(-0.5rem)'}}>
                <h1
                  className="text-xl font-bold text-center break-words select-none whitespace-nowrap cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  onClick={() => window.dispatchEvent(new Event('openCommitInfo'))}
                >
                  {pageTitle}
                </h1>
              </div>
            )}
            
            
            {/* Right element - stays at top */}
            <div className="flex items-center justify-center">
              {rightElement}
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Content Area - consistent across all pages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto safari-scroll-container"
        style={{
          paddingTop: '0',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
          paddingBottom: '1rem',
        }}>
        <div>
          {/* Spacer div for header elements that are now rendered in portal */}
          {(isPollPage || isCreatePollPage || isProfilePage || pathname === '/') && (
            <div className="relative">
              
              {/* Poll page title */}
              {isPollPage && pollPageTitle && (
                <div className="max-w-4xl mx-auto px-16 pt-4 pb-1">
                  <h1
                    className="text-2xl font-bold text-center break-words cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    onClick={() => window.dispatchEvent(new Event('openCommitInfo'))}
                  >
                    {pollPageTitle}
                  </h1>
                </div>
              )}

              {/* Create poll page title */}
              {isCreatePollPage && (
                <div className="max-w-4xl mx-auto px-16 pt-4 pb-1">
                  <h1
                    className="text-2xl font-bold text-center whitespace-nowrap cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    onClick={() => window.dispatchEvent(new Event('openCommitInfo'))}
                  >
                    Ask for{' '}
                    <span
                      className="text-blue-600 dark:text-blue-400"
                      style={{ fontFamily: "'M PLUS 1 Code', monospace" }}
                    >
                      {createPollCategory === 'nomination' ? 'Suggestions' : createPollCategory === 'poll' ? 'Preferences' : 'Participation'}
                    </span>
                  </h1>
                </div>
              )}

              {/* Profile page title */}
              {isProfilePage && (
                <div className="max-w-4xl mx-auto px-16 pt-4 pb-1">
                  <h1
                    className="text-2xl font-bold text-center break-words cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    onClick={() => window.dispatchEvent(new Event('openCommitInfo'))}
                  >
                    Profile
                  </h1>
                </div>
              )}
              
              {/* Home page title */}
              {pathname === '/' && (
                <div className="max-w-4xl mx-auto px-2 pt-4 pb-1">
                  <div className="text-center">
                    <h1
                      className="text-2xl font-bold mb-1 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      onClick={() => window.dispatchEvent(new Event('openCommitInfo'))}
                    >Whoever Wants</h1>
                    <div className="h-7 flex items-center justify-center mb-4" id="home-phrase-content">
                      {/* Blue phrase will be injected here */}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          
          <div className={`max-w-4xl mx-auto ${pathname === '/' ? 'px-2' : 'px-4'} ${(isPollPage || isCreatePollPage || isProfilePage || pathname === '/') ? 'pt-2 pb-6' : 'py-6'} ${pathname === '/' ? 'text-red-600' : ''}`}>
            {children}
          </div>
        </div>
      </div>

      {/* Scroll-aware bottom bar - rendered via portal outside scaled container */}
      {isMounted && createPortal(
        <div
          className={`fixed left-0 right-0 bottom-0 backdrop-blur-lg bg-white/50 dark:bg-black/50 shadow-lg z-50 ${
            showBottomBar ? '' : 'pointer-events-none'
          }`}
          style={{
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            transform: showBottomBar ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 200ms ease-out',
            willChange: 'transform',
          }}
        >
        <div className="max-w-4xl mx-auto px-4 py-2 flex items-center justify-center">
          <div className="flex items-center justify-center gap-12">
            {/* Home button */}
            <button 
              onClick={pathname === '/' ? undefined : () => window.location.href = '/'}
              className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
                pathname === '/' 
                  ? 'bg-blue-100 dark:bg-blue-900/30 cursor-default' 
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'
              }`}
              aria-label="Go to home"
              disabled={pathname === '/'}
            >
              <svg className={`w-7 h-7 ${
                pathname === '/' 
                  ? 'text-blue-600 dark:text-blue-400' 
                  : 'text-gray-400 dark:text-gray-500'
              }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </button>
            
            {/* Profile button - larger direct size */}
            <button
              onClick={isProfilePage ? undefined : () => router.push('/profile')}
              className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
                isProfilePage 
                  ? 'bg-blue-100 dark:bg-blue-900/30 cursor-default' 
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'
              }`}
              aria-label="Profile"
              disabled={isProfilePage}
            >
              <svg className={`w-7 h-7 ${
                isProfilePage 
                  ? 'text-blue-600 dark:text-blue-400' 
                  : 'text-gray-400 dark:text-gray-500'
              }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </button>
          </div>
        </div>
        </div>,
        document.getElementById('bottom-bar-portal')!
      )}

      {/* Header elements rendered outside scaling container */}
      <HeaderPortal>
        {/* Back/home button in upper left — PWA standalone mode only.
             In regular browser tabs, the browser's own back button handles navigation.
             Shows back arrow if user has navigated within the app, home icon otherwise. */}
        {isStandalone && (isPollPage || isCreatePollPage || isProfilePage) && (
          <div className="fixed left-4 z-50" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}>
            {hasAppHistory ? (
              <button
                onClick={() => window.history.back()}
                className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                aria-label="Go back"
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            ) : (
              <button
                onClick={() => window.location.href = '/'}
                className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                aria-label="Go to home"
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </button>
            )}
          </div>
        )}
        
        {/* Copy link button in upper right for poll pages */}
        {isPollPage && (
          <div className="fixed right-4 z-50" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}>
            <FloatingCopyLinkButton url={typeof window !== 'undefined' ? window.location.href : ''} />
          </div>
        )}
        
        {/* New poll button in upper right for home page */}
        {pathname === '/' && (
          <div className="fixed right-4 z-50" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}>
            <Link
              href="/create-poll"
              className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
              aria-label="Create new poll"
            >
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </Link>
          </div>
        )}
      </HeaderPortal>
    </>
  );
}