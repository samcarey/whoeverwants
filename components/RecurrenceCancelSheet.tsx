'use client';

import { useEffect } from 'react';
import ModalPortal from '@/components/ModalPortal';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { haptic } from '@/lib/haptics';

interface RecurrenceCancelSheetProps {
  isOpen: boolean;
  /** The recurring poll's title. */
  pollTitle: string;
  /** The targeted occurrence's date label (e.g. "Tue, Jun 16") for a SCHEDULED
   *  instance; null for the currently-open poll. Tunes the button copy. */
  occurrenceLabel?: string | null;
  onCancelOccurrence: () => void;
  onCancelSeries: () => void;
  onClose: () => void;
  /** Disables the buttons while a request is in flight. */
  busy?: boolean;
}

/**
 * Shared "cancel a recurring poll" action sheet. Offers cancelling just this
 * instance vs this instance plus the remainder of the series. Used by the
 * group page (long-press an open recurring poll) and the Scheduled page
 * (long-press a future instance).
 */
export default function RecurrenceCancelSheet({
  isOpen,
  pollTitle,
  occurrenceLabel = null,
  onCancelOccurrence,
  onCancelSeries,
  onClose,
  busy = false,
}: RecurrenceCancelSheetProps) {
  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const thisLabel = occurrenceLabel ? 'Cancel this occurrence' : 'Cancel this poll';
  const seriesLabel = occurrenceLabel
    ? 'Cancel this and all later'
    : 'Cancel this and stop repeating';

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3" onClick={onClose}>
        <div className="absolute inset-0 bg-black/50" />
        <div
          className="relative w-full max-w-sm bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-1 pt-1 pb-3 text-center">
            <div className="text-base font-semibold flex items-center justify-center gap-2">
              <span aria-hidden>🔁</span> Recurring poll
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">{pollTitle}</p>
            {occurrenceLabel && (
              <p className="text-xs text-gray-400 dark:text-gray-500">Opens {occurrenceLabel}</p>
            )}
          </div>

          <button
            onClick={() => { haptic.medium(); onCancelOccurrence(); }}
            disabled={busy}
            className="w-full mb-2 py-3 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-medium border border-red-200 dark:border-red-800 active:scale-[0.99] disabled:opacity-50"
          >
            {thisLabel}
          </button>
          <button
            onClick={() => { haptic.medium(); onCancelSeries(); }}
            disabled={busy}
            className="w-full mb-2 py-3 rounded-2xl bg-red-600 text-white font-medium active:scale-[0.99] disabled:opacity-50"
          >
            {seriesLabel}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="w-full py-3 rounded-2xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium active:scale-[0.99] disabled:opacity-50"
          >
            Keep it
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
