"use client";

import { useState, useEffect } from 'react';

export default function BuildTimer() {
  const [buildAge, setBuildAge] = useState<string>('');
  const [isClient, setIsClient] = useState(false);

  // Only show in development mode
  const isDev = process.env.NODE_ENV === 'development';
  
  // Get build timestamp from webpack DefinePlugin
  const buildTimestamp = parseInt(process.env.BUILD_TIMESTAMP || '0');
  
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isDev || !isClient || !buildTimestamp) return;

    const updateBuildAge = () => {
      const now = Date.now();
      const ageMs = now - buildTimestamp;
      
      // Convert to human readable format (single unit only)
      const seconds = Math.floor(ageMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      
      let ageString = '';
      
      if (days > 0) {
        ageString = `${days}d`;
      } else if (hours > 0) {
        ageString = `${hours}h`;
      } else if (minutes > 0) {
        ageString = `${minutes}m`;
      } else {
        ageString = `${seconds}s`;
      }
      
      setBuildAge(ageString);
    };

    // Update immediately
    updateBuildAge();
    
    // Update every second
    const interval = setInterval(updateBuildAge, 1000);
    
    return () => clearInterval(interval);
  }, [isDev, isClient, buildTimestamp]);

  // Don't render in production or during SSR
  if (!isDev || !isClient || !buildTimestamp) {
    return null;
  }

  return (
    <div 
      className="fixed top-2 right-2 z-[9999] text-gray-500 text-xs font-mono pointer-events-none select-none"
      style={{ 
        fontSize: '11px',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
      }}
    >
      {buildAge}
    </div>
  );
}