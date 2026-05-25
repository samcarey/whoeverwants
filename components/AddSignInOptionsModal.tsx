"use client";

import { useEffect, useRef, useState } from "react";
import ModalPortal from "./ModalPortal";
import SignInOptions from "./SignInOptions";
import SliderSwitch from "./SliderSwitch";
import { apiSetRecoveryReminderDismissed } from "@/lib/api";

interface AddSignInOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Opened from the home-page recovery banner (and Settings). Lets a
 * recovery-less signed-in account ADD a sign-in method — `<SignInOptions
 * mode="link">` links Google/Apple/passkey/email to the current account —
 * and carries the "don't remind me again" toggle that sets
 * `recovery_reminder_dismissed`. Linking a recovery method hides the banner
 * automatically (providers change); the toggle hides it without adding one.
 */
export default function AddSignInOptionsModal({
  isOpen,
  onClose,
}: AddSignInOptionsModalProps) {
  const [dismissing, setDismissing] = useState(false);
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (isOpen) openedAtRef.current = Date.now();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleDontRemind = async (value: boolean) => {
    if (!value || dismissing) return;
    setDismissing(true);
    try {
      await apiSetRecoveryReminderDismissed(true);
      onClose();
    } catch {
      setDismissing(false);
    }
  };

  const handleBackdropClick = () => {
    if (Date.now() - openedAtRef.current < 400) return;
    onClose();
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 overflow-y-auto">
        <div
          className="absolute inset-0 bg-black/50 dark:bg-black/70"
          onClick={handleBackdropClick}
        />
        <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl my-auto">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <h2 className="text-lg font-semibold mb-1 pr-6">Add a way to sign in</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Your account only lives on this device right now. Connect a sign-in
            method so you can get back in if you lose it.
          </p>

          <SignInOptions mode="link" onComplete={onClose} />

          <div
            className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 cursor-pointer"
            onClick={() => handleDontRemind(true)}
          >
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Don&apos;t remind me again
            </span>
            <SliderSwitch
              checked={false}
              onChange={handleDontRemind}
              disabled={dismissing}
              aria-label="Don't remind me again"
            />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
