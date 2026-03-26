'use client';

import { useState, useEffect, useRef } from 'react';
import TimeMinMaxCounter from './TimeMinMaxCounter';

interface TimeGridModalProps {
  isOpen: boolean;
  onClose: () => void;
  minValue: string | null;
  maxValue: string | null;
  minEnabled: boolean;
  maxEnabled: boolean;
  onApply: (min: string | null, max: string | null, minEnabled: boolean, maxEnabled: boolean) => void;
  absoluteMin?: string; // HH:MM - hard lower bound for voter constraint
  absoluteMax?: string; // HH:MM - hard upper bound for voter constraint
}

export default function TimeGridModal({
  isOpen,
  onClose,
  minValue,
  maxValue,
  minEnabled,
  maxEnabled,
  onApply,
  absoluteMin,
  absoluteMax,
}: TimeGridModalProps) {
  const [localMinTime, setLocalMinTime] = useState<string | null>(minValue);
  const [localMaxTime, setLocalMaxTime] = useState<string | null>(maxValue);

  const backdropRef = useRef<HTMLDivElement>(null);

  // Prevent background scrolling and pull-to-refresh when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const body = document.body;
    const html = document.documentElement;

    // Store current scroll position
    const scrollY = window.scrollY;

    // Prevent background scrolling
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overscrollBehavior = 'none';
    html.style.overscrollBehavior = 'none';

    // Block pull-to-refresh by preventing touchmove everywhere in the modal
    // except inside scroll wheels (which need touch scrolling to work).
    // Must use non-passive listener to allow preventDefault.
    const backdrop = backdropRef.current;
    const preventRefresh = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-scroll-wheel]')) {
        e.preventDefault();
      }
    };
    backdrop?.addEventListener('touchmove', preventRefresh, { passive: false });

    return () => {
      backdrop?.removeEventListener('touchmove', preventRefresh);
      // Restore scroll position
      body.style.position = '';
      body.style.top = '';
      body.style.width = '';
      body.style.overscrollBehavior = '';
      html.style.overscrollBehavior = '';
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  // Update local state when props change
  useEffect(() => {
    // Initialize with defaults if not set
    const initMinTime = minValue || '09:00';
    const initMaxTime = maxValue || '17:00';

    setLocalMinTime(initMinTime);
    setLocalMaxTime(initMaxTime);
  }, [minValue, maxValue, isOpen]);

  if (!isOpen) return null;

  const handleMinTimeChange = (time: string | null) => {
    setLocalMinTime(time);
  };

  const handleMaxTimeChange = (time: string | null) => {
    setLocalMaxTime(time);
  };

  const handleApply = () => {
    onApply(localMinTime, localMaxTime, true, true);
    onClose();
  };

  const handleCancel = () => {
    // Reset to original values
    setLocalMinTime(minValue || '09:00');
    setLocalMaxTime(maxValue || '17:00');
    onClose();
  };

  // Validation: both times must be set and min must be less than max
  const isValid = localMinTime !== null && localMaxTime !== null && localMinTime < localMaxTime;

  return (
    <div
      ref={backdropRef}
      data-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleCancel}
      style={{ touchAction: 'none' }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Select Time Window</h3>
          <button
            onClick={handleCancel}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Time selector */}
        <div className="p-6">
          <TimeMinMaxCounter
            minValue={localMinTime}
            maxValue={localMaxTime}
            onMinChange={handleMinTimeChange}
            onMaxChange={handleMaxTimeChange}
            increment={15}
            absoluteMin={absoluteMin}
            absoluteMax={absoluteMax}
          />
        </div>

        {/* Footer */}
        <div className="p-4 pt-0 flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!isValid}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
