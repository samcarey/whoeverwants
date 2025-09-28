'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

interface ResponsiveScalingProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * ResponsiveScaling component that applies scaling via pure CSS media queries
 * No JavaScript required - scaling is applied immediately during SSR/initial load
 * Scaling is disabled for poll pages to prevent excessive scroll issues
 */
export default function ResponsiveScaling({
  children,
  className = ''
}: ResponsiveScalingProps) {
  const pathname = usePathname();

  // Disable responsive scaling for poll pages to prevent scroll issues
  const isPollPage = pathname?.startsWith('/p/');

  // Pure CSS approach - no JavaScript hooks needed
  // All scaling logic is handled by CSS media queries in globals.css
  return (
    <div
      className={`${isPollPage ? '' : 'responsive-scaling-container'} ${className}`.trim()}
    >
      {children}
    </div>
  );
}