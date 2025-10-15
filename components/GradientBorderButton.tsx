"use client";

import { useState, useEffect } from 'react';

interface GradientBorderButtonProps {
  onClick: () => void;
  disabled?: boolean;
  gradient: 'blue-purple' | 'red-orange'; // blue-purple for Follow up, red-orange for Vote on it
  children: React.ReactNode;
  className?: string;
}

export default function GradientBorderButton({
  onClick,
  disabled = false,
  gradient,
  children,
  className = ""
}: GradientBorderButtonProps) {
  const [isDark, setIsDark] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  useEffect(() => {
    // Check if dark mode is active
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };

    checkDarkMode();

    // Watch for dark mode changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const bgColor = isDark ? 'rgb(17, 24, 39)' : 'white';
  const gradientColors = gradient === 'blue-purple'
    ? 'rgb(34, 197, 94), rgb(59, 130, 246), rgb(147, 51, 234)'
    : 'rgb(239, 68, 68), rgb(249, 115, 22), rgb(234, 179, 8)';

  const handleTouchStart = () => {
    if (!disabled) {
      setIsPressed(true);
    }
  };

  const handleTouchEnd = () => {
    setIsPressed(false);
  };

  const handleMouseDown = () => {
    if (!disabled) {
      setIsPressed(true);
    }
  };

  const handleMouseUp = () => {
    setIsPressed(false);
  };

  const handleMouseLeave = () => {
    setIsPressed(false);
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      className={`relative inline-flex items-center gap-2 px-2.5 py-1 text-gray-900 dark:text-gray-100 font-semibold text-lg rounded-full transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 active:shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${isPressed ? 'scale-95 shadow-md' : ''} ${className}`}
      style={{
        border: '2px solid transparent',
        backgroundImage: `linear-gradient(${bgColor}, ${bgColor}), linear-gradient(to top right, ${gradientColors})`,
        backgroundOrigin: 'border-box',
        backgroundClip: 'padding-box, border-box'
      }}
    >
      {children}
    </button>
  );
}
