'use client';

import { useEffect } from 'react';
import ModalPortal from '@/components/ModalPortal';

interface MinimumParticipationModalProps {
  isOpen: boolean;
  onClose: () => void;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export default function MinimumParticipationModal({
  isOpen,
  onClose,
  value,
  onChange,
  min = 50,
  max = 100,
  disabled = false,
}: MinimumParticipationModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const clamped = Math.min(max, Math.max(min, value));

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 dark:bg-black/70 p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-sm w-full shadow-xl">
          <h3 className="text-lg font-semibold mb-1">Minimum Participation</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Include time slots where at least this percentage of the maximum responders are available.
          </p>

          <div className="mb-4 text-center">
            <span className="text-3xl font-semibold text-blue-600 dark:text-blue-400">
              {clamped}%
            </span>
          </div>

          <input
            type="range"
            min={min}
            max={max}
            step={1}
            value={clamped}
            onChange={(e) => onChange(Number(e.target.value))}
            disabled={disabled}
            className="w-full accent-blue-500 disabled:opacity-50"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-0.5 mb-5">
            <span>{min}%</span>
            <span>{max}% (max only)</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-lg bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
