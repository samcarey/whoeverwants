"use client";

import { useState } from 'react';

interface GradientBorderButtonProps {
  onClick: () => void;
  disabled?: boolean;
  gradient: 'blue-purple' | 'red-orange';
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
  const [isPressed, setIsPressed] = useState(false);

  const gradientClass = gradient === 'blue-purple'
    ? 'from-green-600 via-blue-600 to-purple-600 dark:from-green-500 dark:via-blue-500 dark:to-purple-500'
    : 'from-red-600 via-orange-600 to-yellow-600 dark:from-red-500 dark:via-orange-500 dark:to-yellow-500';

  return (
    <div
      className={`inline-flex rounded-full p-[2px] bg-gradient-to-tr ${gradientClass} ${disabled ? 'opacity-50' : ''}`}
    >
      <button
        onClick={onClick}
        disabled={disabled}
        onTouchStart={() => !disabled && setIsPressed(true)}
        onTouchEnd={() => setIsPressed(false)}
        onTouchCancel={() => setIsPressed(false)}
        onMouseDown={() => !disabled && setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        onMouseLeave={() => setIsPressed(false)}
        className={`relative inline-flex items-center gap-2 px-2.5 py-1 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-semibold text-lg rounded-full transition-all duration-300 shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95 active:shadow-sm disabled:cursor-not-allowed ${isPressed ? 'scale-95 shadow-sm' : ''} ${className}`}
      >
        {children}
      </button>
    </div>
  );
}
