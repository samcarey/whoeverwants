"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiVerifyRecoveryEmail, ApiError } from "@/lib/api";
import { usePageReady } from "@/lib/usePageReady";

/**
 * Phase I: recovery-email confirmation landing page. The email's link
 * points here with `?token=...`; we POST it to the recovery-email verify
 * endpoint, which binds the email to the CURRENTLY SIGNED-IN account
 * (the server requires the session's user_id to match the token's).
 *
 * Distinct from `/auth/verify` (sign-in): this confirms an email being
 * ADDED to an existing account, so it requires the user to already be
 * signed in on this device — hence the 403 → "open on the right device"
 * copy below.
 */

type Status = "verifying" | "success" | "error";

function RecoveryEmailContent() {
  const router = useRouter();
  usePageReady(true);
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("verifying");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [email, setEmail] = useState<string | null>(null);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setErrorMessage("This confirmation link is missing its token.");
      return;
    }

    (async () => {
      try {
        const user = await apiVerifyRecoveryEmail(token);
        setEmail(user.email);
        setStatus("success");
        setTimeout(() => router.replace("/settings"), 1500);
      } catch (err) {
        setStatus("error");
        if (err instanceof ApiError) {
          if (err.status === 401) {
            setErrorMessage(
              "You need to be signed in on this device to confirm a recovery email.",
            );
          } else if (err.status === 403) {
            setErrorMessage(
              "This link belongs to a different account. Open it on the device where you're signed in to that account.",
            );
          } else if (err.status === 409) {
            setErrorMessage(
              "That email is already used by another account.",
            );
          } else {
            setErrorMessage(err.message || "Couldn't confirm this link.");
          }
        } else {
          setErrorMessage("Couldn't reach the server. Try again in a moment.");
        }
      }
    })();
  }, [router, searchParams]);

  return (
    <div className="question-content text-center pt-16">
      {status === "verifying" && (
        <div className="flex flex-col items-center gap-4">
          <svg
            className="w-8 h-8 animate-spin text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-gray-700 dark:text-gray-300">
            Confirming your recovery email…
          </p>
        </div>
      )}
      {status === "success" && (
        <div>
          <h1 className="text-xl font-semibold mb-2">Recovery email added</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {email ? `You can now sign in with ${email}` : null}
          </p>
        </div>
      )}
      {status === "error" && (
        <div>
          <h1 className="text-xl font-semibold mb-2">
            Couldn&apos;t add this email
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {errorMessage}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
            Confirmation links expire after 15 minutes and can only be used
            once.
          </p>
          <button
            type="button"
            onClick={() => router.replace("/settings")}
            className="rounded-full bg-blue-600 hover:bg-blue-700 text-white px-6 h-11 font-medium"
          >
            Back to settings
          </button>
        </div>
      )}
    </div>
  );
}

export default function RecoveryEmailPage() {
  return (
    <Suspense fallback={null}>
      <RecoveryEmailContent />
    </Suspense>
  );
}
