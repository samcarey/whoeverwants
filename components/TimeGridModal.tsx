'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import TimeMinMaxCounter from './TimeMinMaxCounter';

// Duration bar width scaling constants
const MIN_DURATION = 15; // minutes
const MAX_DURATION = 24 * 60;
const MIN_WIDTH_PCT = 10;
const MAX_WIDTH_PCT = 100;

/** Convert "HH:MM" to total minutes since midnight */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Convert total minutes since midnight to "HH:MM" */
function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 45, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

interface TimeGridModalProps {
  isOpen: boolean;
  onClose: () => void;
  minValue: string | null;
  maxValue: string | null;
  onApply: (min: string | null, max: string | null) => void;
}

export default function TimeGridModal({
  isOpen,
  onClose,
  minValue,
  maxValue,
  onApply,
}: TimeGridModalProps) {
  const [localMinTime, setLocalMinTime] = useState<string | null>(minValue);
  const [localMaxTime, setLocalMaxTime] = useState<string | null>(maxValue);
  const [transitionsEnabled, setTransitionsEnabled] = useState(false);

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

  // Allow free movement of min and max — cross-midnight ranges (max < min) are valid
  const handleMinChange = useCallback((newMin: string | null) => {
    setLocalMinTime(newMin);
  }, []);

  const handleMaxChange = useCallback((newMax: string | null) => {
    setLocalMaxTime(newMax);
  }, []);

  // Enable transitions after first render so the duration bar doesn't animate on open
  useEffect(() => {
    if (!isOpen) {
      setTransitionsEnabled(false);
      return;
    }
    const id = requestAnimationFrame(() => setTransitionsEnabled(true));
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleApply = () => {
    onApply(localMinTime, localMaxTime);
    onClose();
  };

  const handleCancel = () => {
    // Reset to original values
    setLocalMinTime(minValue || '09:00');
    setLocalMaxTime(maxValue || '17:00');
    onClose();
  };

  // Validation: both times must be set (equal times = full 24h window)
  const isValid = localMinTime !== null && localMaxTime !== null;

  // Cross-midnight detection: max <= min means the range wraps past midnight (equal = 24h)
  const crossesMidnight = isValid && timeToMinutes(localMaxTime!) <= timeToMinutes(localMinTime!);

  // Duration bar calculations — handle cross-midnight ranges
  let durationMinutes = 0;
  let durationLabel = '';
  if (localMinTime && localMaxTime && isValid) {
    const minMins = timeToMinutes(localMinTime);
    const maxMins = timeToMinutes(localMaxTime);
    durationMinutes = crossesMidnight
      ? (MAX_DURATION - minMins) + maxMins || MAX_DURATION  // 0 means equal times = full 24h
      : maxMins - minMins;
    const hours = Math.floor(durationMinutes / 60);
    const mins = durationMinutes % 60;
    if (hours > 0 && mins > 0) {
      durationLabel = `${hours}h ${mins}m`;
    } else if (hours > 0) {
      durationLabel = `${hours}h`;
    } else {
      durationLabel = `${mins}m`;
    }
  }
  const widthPct = durationMinutes > 0
    ? MIN_WIDTH_PCT + (MAX_WIDTH_PCT - MIN_WIDTH_PCT) * ((durationMinutes - MIN_DURATION) / (MAX_DURATION - MIN_DURATION))
    : 0;

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

        {/* Duration bar */}
        {durationMinutes > 0 && (
          <div className="px-6 pt-4 flex flex-col items-center gap-1">
            <div
              className={`h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center ${transitionsEnabled ? 'transition-all duration-200' : ''}`}
              style={{ width: `${widthPct}%` }}
            >
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">
                {durationLabel}
              </span>
            </div>
            {crossesMidnight && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                Crosses midnight (+1 day)
              </span>
            )}
          </div>
        )}

        {/* Time selector */}
        <div className="p-6 pt-3">
          <TimeMinMaxCounter
            minValue={localMinTime}
            maxValue={localMaxTime}
            onMinChange={handleMinChange}
            onMaxChange={handleMaxChange}
            increment={15}
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
