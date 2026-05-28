"use client";

import { useEffect, useRef } from "react";
import ModalPortal from "./ModalPortal";
import SignInOptions from "./SignInOptions";

interface MergeAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Settings → "Combine another account". For when a user accidentally ended up
 * with two real accounts (e.g. a passkey account and a Google account, or
 * Apple "Hide My Email" + Google). The user is signed into account A; each
 * button here AUTHENTICATES the OTHER account (B) and the server folds B into
 * A — B's polls, groups, and sign-in methods move onto A, and B is deleted.
 *
 * The dual proof authorizes it: A's bearer (already signed in) + B's
 * just-completed sign-in ceremony. `<SignInOptions mode="merge">` passes the
 * `merge` flag to the OAuth / passkey verify endpoints; the caller stays
 * signed in as A throughout. Only the synchronous ceremonies are offered
 * (email is async and doesn't fit an in-modal merge).
 */
export default function MergeAccountModal({
  isOpen,
  onClose,
}: MergeAccountModalProps) {
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

          <h2 className="text-lg font-semibold mb-2 pr-6">Combine another account</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Sign in to your <strong>other</strong>{" "}account below. Its
            polls, groups, and sign-in methods move into this one, and the other
            account is permanently removed. This can&apos;t be undone.
          </p>

          <SignInOptions mode="merge" onComplete={onClose} />
        </div>
      </div>
    </ModalPortal>
  );
}
