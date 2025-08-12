"use client";

import { useState, useEffect } from "react";

interface OptimizedLoaderProps {
  isLoading: boolean;
  error?: string | null;
  children: React.ReactNode;
  skeletonComponent?: React.ReactNode;
  errorComponent?: React.ReactNode;
  minLoadingTime?: number;
}

// Skeleton components for different content types
export const PollSkeleton = () => (
  <div className="animate-pulse space-y-4">
    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-3/4 mx-auto"></div>
    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mx-auto"></div>
    <div className="space-y-3 mt-6">
      <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
      <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
      <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
    </div>
  </div>
);

export const PollListSkeleton = () => (
  <div className="animate-pulse space-y-3">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded mb-2 w-4/5"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
      </div>
    ))}
  </div>
);

export const SpinnerLoader = ({ message = "Loading..." }: { message?: string }) => (
  <div className="flex items-center justify-center py-8">
    <div className="text-center">
      <svg 
        className="animate-spin h-8 w-8 text-gray-500 mx-auto mb-4" 
        xmlns="http://www.w3.org/2000/svg" 
        fill="none" 
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path 
          className="opacity-75" 
          fill="currentColor" 
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
      <p className="text-gray-600 dark:text-gray-400">{message}</p>
    </div>
  </div>
);

export default function OptimizedLoader({
  isLoading,
  error,
  children,
  skeletonComponent,
  errorComponent,
  minLoadingTime = 300
}: OptimizedLoaderProps) {
  const [showContent, setShowContent] = useState(false);
  const [startTime] = useState(Date.now());

  useEffect(() => {
    if (!isLoading && !error) {
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, minLoadingTime - elapsedTime);
      
      // Ensure minimum loading time for better UX
      setTimeout(() => {
        setShowContent(true);
      }, remainingTime);
    }
  }, [isLoading, error, startTime, minLoadingTime]);

  if (error) {
    return errorComponent || (
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
        <div className="text-red-600 dark:text-red-400 mb-2">
          <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-red-900 dark:text-red-100 mb-2">Error</h3>
        <p className="text-red-700 dark:text-red-300">{error}</p>
      </div>
    );
  }

  if (isLoading || !showContent) {
    return skeletonComponent || <SpinnerLoader />;
  }

  return <>{children}</>;
}

// Higher-order component for optimized loading
export function withOptimizedLoading<T extends {}>(
  Component: React.ComponentType<T>,
  LoadingSkeleton: React.ComponentType = SpinnerLoader
) {
  return function OptimizedComponent(props: T & {
    isLoading?: boolean;
    error?: string | null;
  }) {
    const { isLoading = false, error, ...componentProps } = props;
    
    return (
      <OptimizedLoader
        isLoading={isLoading}
        error={error}
        skeletonComponent={<LoadingSkeleton />}
      >
        <Component {...(componentProps as T)} />
      </OptimizedLoader>
    );
  };
}