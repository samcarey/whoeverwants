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

  const bgColor = isDark ? 'rgb(31, 41, 55)' : 'rgb(249, 250, 251)';
  const gradientColors = isDark
    ? (gradient === 'blue-purple'
      ? 'rgb(34, 160, 80), rgb(59, 120, 210), rgb(130, 60, 200)'
      : 'rgb(210, 70, 70), rgb(220, 110, 40), rgb(210, 160, 30)')
    : (gradient === 'blue-purple'
      ? 'rgb(22, 163, 74), rgb(37, 99, 235), rgb(124, 58, 237)'
      : 'rgb(220, 38, 38), rgb(234, 88, 12), rgb(202, 138, 4)');

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
      className={`relative inline-flex items-center gap-2 px-2.5 py-1 text-gray-800 dark:text-gray-200 font-semibold text-lg rounded-full transition-all duration-300 shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95 active:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${isPressed ? 'scale-95 shadow-sm' : ''} ${className}`}
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
