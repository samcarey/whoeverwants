'use client';

import { useEffect } from 'react';
import ModalPortal from '@/components/ModalPortal';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { haptic } from '@/lib/haptics';

interface MemberActionsSheetProps {
  isOpen: boolean;
  /** The member's display name (shown in the sheet header). */
  name: string;
  /** Whether to offer "Make admin". False for anonymous members (admins are
   *  account-keyed, so a nameless member can't be promoted). */
  canMakeAdmin?: boolean;
  /** Whether to offer the destructive "Remove from group" action. */
  canRemove: boolean;
  onMakeAdmin?: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * Bottom action sheet opened from the 3-dots button on a group member row
 * (/info). Offers "Make admin" (named members) and "Remove from group".
 * Selecting one closes the sheet; the parent then opens the shared
 * ConfirmationModal for the consequential confirm step. Haptic feedback fires
 * on every tap (iOS Core Haptics via @capacitor/haptics).
 */
export default function MemberActionsSheet({
  isOpen,
  name,
  canMakeAdmin = true,
  canRemove,
  onMakeAdmin,
  onRemove,
  onClose,
}: MemberActionsSheetProps) {
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

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-3"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/50" />
        <div
          className="relative w-full max-w-sm bg-white dark:bg-gray-800 rounded-3xl shadow-xl p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-1 pt-1 pb-3 text-center text-sm text-gray-500 dark:text-gray-400 truncate">
            {name}
          </p>

          {canMakeAdmin && (
            <button
              onClick={() => {
                haptic.medium();
                onMakeAdmin?.();
              }}
              className="w-full mb-2 py-3 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium border border-blue-200 dark:border-blue-800 active:scale-[0.99]"
            >
              Make admin
            </button>
          )}
          {canRemove && (
            <button
              onClick={() => {
                haptic.medium();
                onRemove();
              }}
              className="w-full mb-2 py-3 rounded-2xl bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-medium border border-red-200 dark:border-red-800 active:scale-[0.99]"
            >
              Remove from group
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium active:scale-[0.99]"
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
