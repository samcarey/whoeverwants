"use client";

import React from 'react';
import ProfileButton from '@/components/ProfileButton';

interface PageLayoutProps {
  children: React.ReactNode;
  title?: string | React.ReactNode;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
  showProfileButton?: boolean;
  contentWidth?: 'narrow' | 'wide';
  className?: string;
}

export default function PageLayout({ 
  children, 
  title,
  leftElement,
  rightElement,
  showProfileButton = true,
  contentWidth = 'narrow',
  className = "" 
}: PageLayoutProps) {
  
  return (
    <>
      {/* Fixed header bar */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 safe-area-header">
        <div className="flex items-center justify-between pt-3 pb-2 px-2">
          {/* Left element or spacer */}
          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
            {leftElement}
          </div>
          
          {/* Title */}
          {title && (
            typeof title === 'string' ? (
              <h1 className="text-xl font-bold text-center px-4 break-words select-none flex-1">
                {title}
              </h1>
            ) : (
              <div className="flex-1 px-4">
                {title}
              </div>
            )
          )}
          
          {/* Right element or profile button */}
          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
            {rightElement || (showProfileButton && <ProfileButton />)}
          </div>
        </div>
      </div>
      
      {/* Main content with proper spacing for fixed header */}
      <div className={`pb-20 page-content ${contentWidth === 'wide' ? 'max-w-4xl px-4 sm:px-8' : 'max-w-md px-4'} mx-auto ${className}`}>
        {children}
      </div>
    </>
  );
}