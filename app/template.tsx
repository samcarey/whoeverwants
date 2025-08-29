"use client";

import React, { useEffect, useState, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import ProfileButton from '@/components/ProfileButton';
import FloatingCopyLinkButton from '@/components/FloatingCopyLinkButton';

interface AppTemplateProps {
  children: React.ReactNode;
}

export default function Template({ children }: AppTemplateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isExternalReferrer, setIsExternalReferrer] = useState(false);
  const [shouldShowHomeButton, setShouldShowHomeButton] = useState(false);
  const [showBottomBar, setShowBottomBar] = useState(true);
  const lastScrollY = useRef(0);
  const scrollThreshold = useRef(5); // Minimum scroll distance to trigger hide/show
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInBounceRef = useRef(false);
  
  // Check if referrer is from a different domain or if this is a new tab/external entry
  // Also determine if back button should show home icon instead
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const referrer = document.referrer;
      const historyLength = window.history.length;
      let showHome = false;
      let isExternal = false;
      
      if (referrer) {
        try {
          const referrerUrl = new URL(referrer);
          const currentUrl = new URL(window.location.href);
          const isDifferentOrigin = referrerUrl.origin !== currentUrl.origin;
          
          // If referrer is from different origin, definitely external
          if (isDifferentOrigin) {
            isExternal = true;
            showHome = true;
          } else {
            // Same origin referrer
            const isHomepageReferrer = referrerUrl.pathname === '/' || referrerUrl.pathname === '';
            const isNewTab = historyLength === 1 && referrerUrl.pathname !== new URL(currentUrl).pathname;
            
            
            if (pathname.startsWith('/p/')) {
              // Poll pages
              if (isNewTab) {
                // New tab from copied link
                isExternal = true;
                showHome = true;
              } else if (isHomepageReferrer && historyLength === 2) {
                // Came directly from homepage, back would go to homepage
                // Show home button instead of back button
                isExternal = false;
                showHome = true;
              } else {
                // Normal internal navigation
                isExternal = false;
                showHome = false;
              }
            } else {
              // Non-poll pages with same-origin referrer
              if (isHomepageReferrer && historyLength === 2) {
                showHome = true;
              }
              isExternal = false;
            }
          }
        } catch (e) {
          // Invalid referrer URL - treat as external
          isExternal = true;
          showHome = true;
        }
      } else {
        // No referrer - this happens when:
        // 1. Direct URL entry/paste in address bar  
        // 2. Opening link in new tab (copied link) - most common case
        // 3. Bookmarks
        // 4. Some privacy settings
        
        if (pathname.startsWith('/p/')) {
          // Poll pages with no referrer should show home button
          // This covers the main use case: copied links opened in new tabs
          isExternal = true;
          showHome = true;
        } else {
          // Non-poll pages: check history length
          isExternal = historyLength <= 1;
          showHome = historyLength <= 1;
        }
      }
      
      
      setIsExternalReferrer(isExternal);
      setShouldShowHomeButton(showHome);
    }
  }, [pathname]);
  
  // Determine initial state based on pathname to avoid layout shift
  const getInitialPageTitle = () => {
    if (pathname === '/create-poll' || pathname === '/create-poll/') return 'Create New Poll';
    return '';
  };
  
  const getInitialLeftElement = () => {
    return <div className="w-6 h-6" />; // spacer since profile button is now in bottom bar
  };
  
  const [pageTitle, setPageTitle] = useState(getInitialPageTitle());
  const [leftElement, setLeftElement] = useState<React.ReactNode>(getInitialLeftElement());
  const [rightElement, setRightElement] = useState<React.ReactNode>(<div className="w-6 h-6" />);
  const [pollPageTitle, setPollPageTitle] = useState('');

  // Determine page-specific header content based on pathname
  useEffect(() => {
    if (pathname === '/') {
      setPageTitle('');
      setLeftElement(<div className="w-6 h-6" />); // spacer
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else if (pathname === '/create-poll' || pathname === '/create-poll/') {
      setPageTitle('Create New Poll');
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

  // Handle scroll direction detection for bottom bar
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Use a timeout to ensure the ref is attached after render
    const timeoutId = setTimeout(() => {
      const handleScroll = (e: Event) => {
        const target = e.target as HTMLElement;
        const currentScrollY = target.scrollTop;
        const maxScrollY = target.scrollHeight - target.clientHeight;
        
        // Detect iOS rubber band overshoot
        const isOvershootTop = currentScrollY < 0;
        const isOvershootBottom = currentScrollY > maxScrollY;
        const isInOvershoot = isOvershootTop || isOvershootBottom;
        
        // If we detect overshoot, enter bounce mode and ignore this event
        if (isInOvershoot) {
          isInBounceRef.current = true;
          
          // Clear any existing timeout and set a new one to exit bounce mode
          if (bounceTimeoutRef.current) {
            clearTimeout(bounceTimeoutRef.current);
          }
          
          bounceTimeoutRef.current = setTimeout(() => {
            isInBounceRef.current = false;
            bounceTimeoutRef.current = null;
          }, 150); // Wait 150ms after overshoot ends
          
          return; // Ignore this scroll event
        }
        
        // If we're still in bounce mode from previous overshoot, ignore this event
        if (isInBounceRef.current) {
          return;
        }
        
        // Normal scroll processing
        const scrollDifference = Math.abs(currentScrollY - lastScrollY.current);
        
        // Only trigger if scroll difference is above threshold
        if (scrollDifference < scrollThreshold.current) return;
        
        if (currentScrollY > lastScrollY.current) {
          // Scrolling down - hide bottom bar
          setShowBottomBar(false);
        } else if (currentScrollY < lastScrollY.current) {
          // Scrolling up - show bottom bar
          setShowBottomBar(true);
        }
        
        // Always show at the very top
        if (currentScrollY === 0) {
          setShowBottomBar(true);
        }
        
        lastScrollY.current = currentScrollY;
      };

      // Add scroll listener to the scrollable container, not window
      const scrollContainer = scrollContainerRef.current;
      
      if (scrollContainer) {
        scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
        
        return () => {
          scrollContainer.removeEventListener('scroll', handleScroll);
          // Clean up timeout on unmount
          if (bounceTimeoutRef.current) {
            clearTimeout(bounceTimeoutRef.current);
          }
        };
      }
    }, 100);

    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  const isPollPage = pathname.startsWith('/p/');
  const isCreatePollPage = pathname === '/create-poll' || pathname === '/create-poll/';
  const isProfilePage = pathname === '/profile' || pathname === '/profile/';

  return (
    <>
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
                <h1 className="text-xl font-bold text-center break-words select-none whitespace-nowrap">
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
          paddingTop: (isPollPage || isCreatePollPage || isProfilePage || pathname === '/') ? 'env(safe-area-inset-top)' : '0',
          paddingLeft: 'max(1rem, env(safe-area-inset-left))', 
          paddingRight: 'max(1rem, env(safe-area-inset-right))',
          paddingBottom: '1rem'
        }}>
        <div className="min-h-full">
          {/* Back arrow and title for pages without top bar */}
          {(isPollPage || isCreatePollPage || isProfilePage || pathname === '/') && (
            <div className="relative">
              {/* Back arrow or home button in upper left - only for poll/create/profile pages */}
              {(isPollPage || isCreatePollPage || isProfilePage) && !isExternalReferrer && (
                <div className="absolute left-0 top-4 z-10">
                {shouldShowHomeButton ? (
                  <button 
                    onClick={() => window.location.href = '/'}
                    className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                    aria-label="Go to home"
                  >
                    <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                  </button>
                ) : (
                  <button 
                    onClick={() => window.history.back()}
                    className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                    aria-label="Go back"
                  >
                    <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                </div>
              )}
              
              {/* Copy link button in upper right for poll pages */}
              {isPollPage && (
                <div className="absolute right-0 top-4 z-10">
                  <FloatingCopyLinkButton url={typeof window !== 'undefined' ? window.location.href : ''} />
                </div>
              )}
              
              {/* New poll button in upper right for home page */}
              {pathname === '/' && (
                <div className="absolute right-0 top-4 z-10">
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
              
              {/* Poll page title */}
              {isPollPage && pollPageTitle && (
                <div className="max-w-4xl mx-auto px-16 pt-4 pb-1">
                  <h1 className="text-2xl font-bold text-center break-words">
                    {pollPageTitle}
                  </h1>
                </div>
              )}
              
              {/* Create poll page title */}
              {isCreatePollPage && (
                <div className="max-w-4xl mx-auto px-16 pt-4 pb-1">
                  <h1 className="text-2xl font-bold text-center break-words">
                    Create New Poll
                  </h1>
                </div>
              )}
              
              {/* Profile page title */}
              {isProfilePage && (
                <div className="max-w-4xl mx-auto px-16 pt-4 pb-1">
                  <h1 className="text-2xl font-bold text-center break-words">
                    Profile
                  </h1>
                </div>
              )}
              
              {/* Home page title */}
              {pathname === '/' && (
                <div className="max-w-4xl mx-auto px-16 pt-4 pb-1" id="home-title-content">
                  {/* Title will be injected here */}
                </div>
              )}
            </div>
          )}
          
          <div className={`max-w-4xl mx-auto px-4 ${(isPollPage || isCreatePollPage || isProfilePage || pathname === '/') ? 'pt-2 pb-6' : 'py-6'}`}>
            {children}
          </div>
        </div>
      </div>

      {/* Scroll-aware bottom bar */}
      <div 
        className={`fixed left-0 right-0 bottom-0 backdrop-blur-lg shadow-lg z-50 transition-opacity duration-200 ease-out ${
          showBottomBar ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center justify-center">
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
      </div>
    </>
  );
}