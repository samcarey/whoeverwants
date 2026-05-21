"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiVerifyMagicLink, ApiError } from "@/lib/api";
import { usePageReady } from "@/lib/usePageReady";

/**
 * Phase B: magic-link landing page. The email's link points at this
 * route with `?token=...`; we POST the token to the verify endpoint,
 * which issues a session (stored client-side by `apiVerifyMagicLink`)
 * and we redirect to settings on success.
 *
 * Token is consumed via `POST` from the FE, not a `GET` to the API
 * directly, so email-client URL preview / link-checker bots don't
 * eat the token before the user actually taps it.
 */

type Status = "verifying" | "success" | "error";

function VerifyPageContent() {
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
      setErrorMessage("This sign-in link is missing its token.");
      return;
    }

    (async () => {
      try {
        const res = await apiVerifyMagicLink(token);
        setEmail(res.user.email);
        setStatus("success");
        // Brief pause so the user reads the confirmation, then settings.
        setTimeout(() => router.replace("/settings"), 1500);
      } catch (err) {
        setStatus("error");
        if (err instanceof ApiError) {
          setErrorMessage(err.message || "Couldn't verify this link.");
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
          <p className="text-gray-700 dark:text-gray-300">Signing you in…</p>
        </div>
      )}
      {status === "success" && (
        <div>
          <h1 className="text-xl font-semibold mb-2">You&apos;re signed in</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {email ? `as ${email}` : null}
          </p>
        </div>
      )}
      {status === "error" && (
        <div>
          <h1 className="text-xl font-semibold mb-2">
            Couldn&apos;t sign you in
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {errorMessage}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
            Sign-in links expire after 15 minutes and can only be used once.
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

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyPageContent />
    </Suspense>
  );
}
