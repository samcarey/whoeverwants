"use client";

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import ProfileButton from '@/components/ProfileButton';
import FloatingCopyLinkButton from '@/components/FloatingCopyLinkButton';

interface AppTemplateProps {
  children: React.ReactNode;
}

export default function Template({ children }: AppTemplateProps) {
  const pathname = usePathname();
  
  // Determine initial state based on pathname to avoid layout shift
  const getInitialPageTitle = () => {
    if (pathname === '/create-poll' || pathname === '/create-poll/') return 'Create New Poll';
    if (pathname === '/profile' || pathname === '/profile/') return 'Profile';
    return '';
  };
  
  const getInitialLeftElement = () => {
    if (pathname === '/profile' || pathname === '/profile/') return <div className="w-6 h-6" />;
    return <ProfileButton />;
  };
  
  const [pageTitle, setPageTitle] = useState(getInitialPageTitle());
  const [leftElement, setLeftElement] = useState<React.ReactNode>(getInitialLeftElement());
  const [rightElement, setRightElement] = useState<React.ReactNode>(<div className="w-6 h-6" />);
  const [pollPageTitle, setPollPageTitle] = useState('');

  // Determine page-specific header content based on pathname
  useEffect(() => {
    if (pathname === '/') {
      setPageTitle('');
      setLeftElement(<ProfileButton />);
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else if (pathname === '/create-poll' || pathname === '/create-poll/') {
      setPageTitle('Create New Poll');
      setLeftElement(<ProfileButton />);
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else if (pathname === '/profile' || pathname === '/profile/') {
      setPageTitle('Profile');
      setLeftElement(<div className="w-6 h-6" />); // no profile button on profile page
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else if (pathname.startsWith('/p/')) {
      // Poll pages - title will be set by the page content via custom event
      setPageTitle(pollPageTitle);
      setLeftElement(<ProfileButton />);
      setRightElement(<div className="w-6 h-6" />); // spacer
    } else {
      setPageTitle('');
      setLeftElement(<ProfileButton />);
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

  const isPollPage = pathname.startsWith('/p/');
  const isCreatePollPage = pathname === '/create-poll' || pathname === '/create-poll/';

  return (
    <>
      {/* Fixed Header - skip for poll and create poll pages */}
      {!isPollPage && !isCreatePollPage && (
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
            
            {/* Homepage gets special title treatment - vertically centered with font-size-based offset and left nudge */}
            {pathname === '/' && (
              <div className="absolute left-1/2 top-1/2" id="home-title" style={{transform: 'translate(-50%, -50%) translateY(0.125em) translateX(-0.5rem)'}}>
                {/* Home page will inject its dynamic title here - offset will be proportional to font size */}
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
      <div className="flex-1 overflow-auto safari-scroll-container" 
           style={{ 
             paddingTop: (isPollPage || isCreatePollPage) ? 'env(safe-area-inset-top)' : '0',
             paddingLeft: 'max(1rem, env(safe-area-inset-left))', 
             paddingRight: 'max(1rem, env(safe-area-inset-right))',
             paddingBottom: 'max(1rem, env(safe-area-inset-bottom))'
           }}>
        <div className="min-h-full">
          {/* Back arrow and title for pages without top bar */}
          {(isPollPage || isCreatePollPage) && (
            <div className="relative">
              {/* Back arrow in upper left */}
              <div className="absolute left-0 top-6 z-10">
                <button 
                  onClick={() => window.history.back()}
                  className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                  aria-label="Go back"
                >
                  <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              </div>
              
              {/* Copy link button in upper right for poll pages */}
              {isPollPage && (
                <div className="absolute right-0 top-6 z-10">
                  <FloatingCopyLinkButton url={typeof window !== 'undefined' ? window.location.href : ''} />
                </div>
              )}
              
              {/* Poll page title */}
              {isPollPage && pollPageTitle && (
                <div className="max-w-4xl mx-auto px-16 pt-6 pb-1">
                  <h1 className="text-2xl font-bold text-center break-words">
                    {pollPageTitle}
                  </h1>
                </div>
              )}
              
              {/* Create poll page title */}
              {isCreatePollPage && (
                <div className="max-w-4xl mx-auto px-16 pt-6 pb-1">
                  <h1 className="text-2xl font-bold text-center break-words">
                    Create New Poll
                  </h1>
                </div>
              )}
            </div>
          )}
          
          <div className={`max-w-4xl mx-auto px-4 ${(isPollPage || isCreatePollPage) ? 'pt-2 pb-6' : 'py-6'}`}>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}