"use client";

import { useState, useEffect } from "react";
import ModalPortal from "./ModalPortal";

interface SuccessPopupProps {
  show: boolean;
  onClose: () => void;
}

export default function SuccessPopup({ show, onClose }: SuccessPopupProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  useEffect(() => {
    if (show) {
      // Show the bubble immediately
      setIsVisible(true);
      
      // Start exit animation after 8 seconds
      const exitTimer = setTimeout(() => {
        setIsAnimatingOut(true);
      }, 8000);

      // Remove from DOM after animation completes
      const removeTimer = setTimeout(() => {
        setIsVisible(false);
        setIsAnimatingOut(false);
        onClose();
      }, 8500); // 8s display + 0.5s animation

      return () => {
        clearTimeout(exitTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [show, onClose]);

  if (!isVisible) return null;

  return (
    <ModalPortal>
      <div 
        className={`fixed top-14 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-500 ease-out ${
          isAnimatingOut 
            ? '-translate-y-full opacity-0' 
            : 'translate-y-0 opacity-100'
        }`}
      >
      <div className="bg-green-600 text-white px-2 py-0.5 rounded-lg shadow-lg flex items-center space-x-2 whitespace-nowrap">
        <div className="flex-shrink-0">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">Your poll is now live!</p>
        </div>
        <button
          onClick={() => {
            setIsAnimatingOut(true);
            setTimeout(() => {
              setIsVisible(false);
              setIsAnimatingOut(false);
              onClose();
            }, 500);
          }}
          className="flex-shrink-0 text-white hover:text-gray-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      </div>
    </ModalPortal>
  );
}