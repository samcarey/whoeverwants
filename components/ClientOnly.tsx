"use client";

import { useEffect, useState, ReactNode } from 'react';

interface ClientOnlyProps {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * If true, delays rendering by one frame to prevent hydration mismatches
   * in components that depend on DOM measurements or window properties
   */
  delayRender?: boolean;
}

/**
 * ClientOnly Component - Bulletproof Solution for Hydration Errors
 * 
 * This component ensures that complex interactive components only render
 * on the client side, completely eliminating the possibility of hydration
 * mismatches between server and client rendering.
 * 
 * Use this wrapper for components that:
 * - Use window/document APIs
 * - Perform date/time calculations 
 * - Access localStorage/sessionStorage
 * - Use Math.random() or other non-deterministic functions
 * - Have complex drag-and-drop or interactive behaviors
 * - Depend on client-side state management
 * 
 * Benefits:
 * - Zero hydration errors
 * - Consistent rendering across server/client
 * - Graceful loading states
 * - No need for typeof window checks
 * - Future-proof against Next.js updates
 */
export default function ClientOnly({ 
  children, 
  fallback = <div>Loading...</div>,
  delayRender = false
}: ClientOnlyProps) {
  const [hasMounted, setHasMounted] = useState(false);
  const [isDelayComplete, setIsDelayComplete] = useState(!delayRender);

  useEffect(() => {
    setHasMounted(true);
    
    if (delayRender) {
      // Delay rendering by one frame to ensure DOM is ready
      requestAnimationFrame(() => {
        setIsDelayComplete(true);
      });
    }
  }, [delayRender]);

  // Return fallback during SSR and initial client render
  if (!hasMounted || !isDelayComplete) {
    return <>{fallback}</>;
  }

  // Only render children once we're definitely on the client
  return <>{children}</>;
}

/**
 * Specialized ClientOnly component for drag-and-drop interfaces
 * Includes additional delay to ensure proper DOM measurements
 */
export function ClientOnlyDragDrop({ 
  children, 
  fallback = (
    <div className="p-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600">
      <div className="text-center text-gray-500 dark:text-gray-400">
        Loading interactive interface...
      </div>
    </div>
  )
}: { children: ReactNode; fallback?: ReactNode }) {
  return (
    <ClientOnly fallback={fallback} delayRender={true}>
      {children}
    </ClientOnly>
  );
}

/**
 * Hook that returns true only after component has mounted on client
 * Use this for conditional logic that should only run client-side
 */
export function useClientOnly(): boolean {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  return hasMounted;
}