"use client";

import { useEffect, useRef, useState } from "react";
import ModalPortal from "./ModalPortal";
import SignInOptions from "./SignInOptions";
import { MAX_NAME_LENGTH, validateUserName, isValidUserName } from "@/lib/nameValidation";
import { getUserName } from "@/lib/userProfile";
import { apiCreateNameAccount, getCurrentUser } from "@/lib/api";

interface AccountGateModalProps {
  isOpen: boolean;
  /**
   * Called once the caller has a usable account + name — either a sign-in
   * completed and the account already had a name, OR the user entered a name
   * (which mints / names a recovery-less account). The host closes the modal
   * here and proceeds with the gated action (vote / create group / etc.).
   */
  onSubmit: () => void;
  onCancel: () => void;
  /** Contextual second line, e.g. "to vote" / "to create a new group". */
  message?: string;
}

/**
 * The unified "we need an account" gate that replaces the name-only
 * NameRequiredModal at every gated action. Sign-in methods come first (a
 * returning user's account name auto-fills + proceeds); below them, a "name
 * or alias" field creates a recovery-less account for users who don't want
 * to sign in. Both the buttons and the look are shared with SignInModal /
 * Settings via `<SignInOptions>`.
 */
export default function AccountGateModal({
  isOpen,
  onSubmit,
  onCancel,
  message,
}: AccountGateModalProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openedAtRef = useRef(0);

  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!isOpen) return;
    openedAtRef.current = Date.now();
    setName(getUserName() ?? "");
    setError(null);
    setSubmitting(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelRef.current();
    };
    document.addEventListener("keydown", handle);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handle);
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const validation = validateUserName(name);
  const errorText =
    error ?? (name.length > 0 && !validation.ok ? validation.error : null);

  // A sign-in (OAuth / passkey) completed inside SignInOptions. If the
  // resulting account already carries a name (returning user), we're done —
  // proceed. Otherwise the user is now signed in but nameless: keep the modal
  // open so they fill in the "name or alias" field, which `apiCreateNameAccount`
  // then writes to the existing account.
  const handleSignInComplete = () => {
    const accountName = getCurrentUser()?.name?.trim() || getUserName()?.trim() || "";
    if (isValidUserName(accountName)) {
      onSubmit();
      return;
    }
    setName("");
    setError(null);
    // Nudge focus toward the name field now that sign-in alone didn't finish.
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleContinue = async () => {
    const trimmed = name.trim();
    if (!validateUserName(trimmed).ok) return;
    setSubmitting(true);
    setError(null);
    try {
      // Creates a recovery-less account (anonymous) OR sets the name on the
      // already-signed-in account; persists the session either way.
      await apiCreateNameAccount(trimmed);
      onSubmit();
    } catch {
      setError("Couldn't save your name. Try again in a moment.");
      setSubmitting(false);
    }
  };

  const handleBackdropClick = () => {
    if (Date.now() - openedAtRef.current < 400) return;
    onCancel();
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 overflow-y-auto">
        <div
          className="absolute inset-0 bg-black/50 dark:bg-black/70"
          onClick={handleBackdropClick}
        />
        <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl my-auto">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <h2 className="text-lg font-semibold mb-4 pr-6">
            Sign in{message ? ` ${message}` : ""}
          </h2>

          <SignInOptions mode="signin" onComplete={handleSignInComplete} />

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              or just provide a name/alias
            </span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </div>

          <input
            id="account-gate-name"
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && validation.ok && !submitting) {
                e.preventDefault();
                void handleContinue();
              }
            }}
            maxLength={MAX_NAME_LENGTH}
            placeholder="e.g. Alex"
            className="w-full mb-3 px-3 py-2 text-base bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errorText && (
            <p className="mb-3 text-sm text-red-600 dark:text-red-400">{errorText}</p>
          )}
          <button
            type="button"
            onClick={handleContinue}
            disabled={!validation.ok || submitting}
            className="w-full rounded-full bg-foreground text-background h-11 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Setting up…" : "Continue"}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
