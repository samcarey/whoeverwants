"use client";

import { useEffect, useState } from "react";
import ModalPortal from "./ModalPortal";

interface MinimumParticipationModalProps {
  isOpen: boolean;
  value: number;
  onSave: (value: number) => void;
  onClose: () => void;
}

export default function MinimumParticipationModal({
  isOpen,
  value,
  onSave,
  onClose,
}: MinimumParticipationModalProps) {
  // Local draft state isolates slider drag re-renders from the parent form.
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (isOpen) setDraft(value);
  }, [isOpen, value]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="absolute inset-0 bg-black/50 dark:bg-black/70" />
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full p-5">
          <h3 className="text-base font-semibold mb-2 text-gray-900 dark:text-white">
            Minimum Participation:{' '}
            <span className="font-normal text-blue-600 dark:text-blue-400">
              {draft}%
            </span>
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Include time slots where at least this percentage of the maximum responders are available.
          </p>
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            value={draft}
            onChange={(e) => setDraft(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-0.5 mb-4">
            <span>50%</span>
            <span>100% (max only)</span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { onSave(draft); onClose(); }}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
