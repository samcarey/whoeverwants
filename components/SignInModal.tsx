"use client";

import { useEffect, useRef, useState } from "react";
import ModalPortal from "./ModalPortal";
import { apiRequestMagicLink } from "@/lib/api";
import { ApiError } from "@/lib/api";

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Phase B: magic-link sign-in modal. Single email field + Send button.
 * On send, hands off to the user's email — the magic link in the
 * inbox takes over (clicking it lands on `/auth/verify?token=...` and
 * issues the session there). This modal closes after a successful
 * request and shows a "check your email" toast in the settings page.
 *
 * Stacks above the create-poll bottom sheet (z-60) and the
 * ConfirmationModal (z-70) via z-80, in case a future flow opens it
 * from inside one of those modals.
 */
export default function SignInModal({ isOpen, onClose }: SignInModalProps) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openedAtRef = useRef<number>(0);

  // Suppress backdrop dismissal in the first 400ms after open so the
  // synthesized click after a long-press / tap that opened the modal
  // doesn't immediately close it. Mirrors FollowUpModal's pattern.
  useEffect(() => {
    if (isOpen) {
      openedAtRef.current = Date.now();
      setError(null);
      // Auto-focus the email input on open (skip on touch devices to
      // avoid the iOS keyboard popping up unexpectedly — the user can
      // tap into the field).
      if (typeof window !== "undefined" && !("ontouchstart" in window)) {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } else {
      // Reset state on close so reopening is a fresh modal.
      setEmail("");
      setSubmitting(false);
      setSent(false);
      setEmailConfigured(null);
      setError(null);
    }
  }, [isOpen]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || sent) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequestMagicLink(trimmed);
      setSent(true);
      setEmailConfigured(res.email_configured);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(err.message || "Invalid email address.");
      } else {
        setError("Couldn't send sign-in link. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  };

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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          {sent ? (
            <div>
              <h2 className="text-lg font-semibold mb-2">Check your email</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                We sent a sign-in link to{" "}
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {email.trim()}
                </span>
                . Tap the link to sign in. It expires in 15 minutes.
              </p>
              {emailConfigured === false && (
                <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-md px-3 py-2 mb-4">
                  Heads up: this server isn&apos;t configured to send real
                  emails. Check the API logs for the magic link.
                </p>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-full bg-foreground text-background h-11 font-medium"
              >
                Got it
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <h2 className="text-lg font-semibold mb-1">Sign in</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                We&apos;ll email you a one-tap sign-in link. No password
                needed.
              </p>
              <input
                ref={inputRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={(e) => setEmail(e.target.value.trim())}
                disabled={submitting}
                maxLength={254}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white mb-3"
              />
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400 mb-3">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="w-full rounded-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-medium disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
