"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_NAME_LENGTH, validateUserName } from "@/lib/nameValidation";
import { getUserName } from "@/lib/userProfile";
import { apiCreateNameAccount } from "@/lib/api";

interface NamePromptPanelProps {
  /** Fired after the name is saved to the account (POST /api/auth/account/name,
   *  which sets the name on the already-signed-in account, or mints a
   *  browser-tied account when signed out). */
  onComplete: () => void;
  /** Bump to programmatically focus the field — e.g. after a sign-in that
   *  landed on a nameless account, to draw the eye to the name step. */
  focusNonce?: number;
  autoFocus?: boolean;
  ctaLabel?: string;
}

/**
 * The "name or alias" entry step shared by every surface that must guarantee
 * an account ends up with a name (the app requires one for any action beyond
 * viewing public polls / link previews): `AccountGateModal` + `SignInModal`
 * (always-shown alternative to signing in), and `/auth/verify` (shown only
 * when a durable sign-in landed on a still-nameless account). Owns the input,
 * validation, and the `apiCreateNameAccount` call so the callsites can't
 * drift on the name rules.
 */
export default function NamePromptPanel({
  onComplete,
  focusNonce,
  autoFocus,
  ctaLabel = "Continue",
}: NamePromptPanelProps) {
  const [name, setName] = useState(() => getUserName() ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Skip the focus effect's initial mount run — callers that want focus on
  // mount pass `autoFocus` (native). `focusNonce` is for focusing LATER (e.g.
  // AccountGateModal bumps it after a nameless sign-in) without stealing focus
  // when the panel first renders as a passive alternative to signing in.
  const focusMountRef = useRef(true);

  useEffect(() => {
    if (focusMountRef.current) {
      focusMountRef.current = false;
      return;
    }
    inputRef.current?.focus();
  }, [focusNonce]);

  const validation = validateUserName(name);
  const errorText =
    error ?? (name.length > 0 && !validation.ok ? validation.error : null);

  const handleContinue = async () => {
    const trimmed = name.trim();
    if (!validateUserName(trimmed).ok) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiCreateNameAccount(trimmed);
      onComplete();
    } catch {
      setError("Couldn't save your name. Try again in a moment.");
      setSubmitting(false);
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        value={name}
        autoFocus={autoFocus}
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
        {submitting ? "Setting up…" : ctaLabel}
      </button>
    </div>
  );
}
