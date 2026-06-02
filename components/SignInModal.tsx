"use client";

import { useEffect, useRef, useState } from "react";
import ModalPortal from "./ModalPortal";
import SignInOptions from "./SignInOptions";
import NamePromptPanel from "./NamePromptPanel";
import { isValidUserName } from "@/lib/nameValidation";
import { getUserName } from "@/lib/userProfile";
import { getCurrentUser } from "@/lib/api";

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Anonymous sign-in modal. The provider buttons + email link live in the
 * shared `<SignInOptions mode="signin">` so this modal, the account gating
 * modal, the "add a recovery method" modal, and Settings all look and behave
 * identically. This component owns only the modal chrome (backdrop, close
 * button, escape, body-scroll lock).
 *
 * Like `AccountGateModal`, the provider buttons are followed by an
 * always-visible "or just provide a name/alias" path so a brand-new user can
 * mint a recovery-less, name-only account directly from "Sign in" without
 * first completing an OAuth / passkey / magic-link ceremony. The name field
 * is a passive alternative on first open (it does NOT steal focus / pop the
 * mobile keyboard); a durable sign-in that lands on a still-nameless account
 * bumps `nameFocusNonce` to draw the eye to it (and `NamePromptPanel` then
 * writes the name onto the existing account).
 *
 * Stacks above the create-poll bottom sheet (z-60) and the
 * ConfirmationModal (z-70) via z-80.
 */
export default function SignInModal({ isOpen, onClose }: SignInModalProps) {
  const openedAtRef = useRef<number>(0);
  const [nameFocusNonce, setNameFocusNonce] = useState(0);

  // Suppress backdrop dismissal in the first 400ms after open so the
  // synthesized click after a long-press / tap that opened the modal doesn't
  // immediately close it. Mirrors FollowUpModal's pattern.
  useEffect(() => {
    if (isOpen) openedAtRef.current = Date.now();
  }, [isOpen]);

  const handleSignInComplete = () => {
    const accountName =
      getCurrentUser()?.name?.trim() || getUserName()?.trim() || "";
    if (isValidUserName(accountName)) {
      onClose();
      return;
    }
    // Signed in but nameless: keep the modal open and focus the name field,
    // which NamePromptPanel writes to the now-signed-in account.
    setNameFocusNonce((n) => n + 1);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = () => {
    if (Date.now() - openedAtRef.current < 400) return;
    onClose();
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/50 dark:bg-black/70"
          onClick={handleBackdropClick}
        />
        <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <h2 className="text-lg font-semibold mb-4 pr-6">Sign in</h2>

          <SignInOptions mode="signin" onComplete={handleSignInComplete} />

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              or just provide a name/alias
            </span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </div>

          <NamePromptPanel onComplete={onClose} focusNonce={nameFocusNonce} />
        </div>
      </div>
    </ModalPortal>
  );
}
