"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiAdoptInstantSession, ApiError } from "@/lib/api";
import { usePageReady } from "@/lib/usePageReady";

/**
 * Dev-only instant sign-in landing page (demo helper). The link minted by
 * `POST /api/auth/dev/instant-link` points here with `?token=<sessionToken>`
 * (+ optional `&next=<relative path>`). We POST the token to `/instant/adopt`,
 * which links this browser to the throwaway demo account and signs in, then
 * redirect to `next` (default home).
 *
 * Gated to non-production hosts: the adopt endpoint already 503s on prod, but
 * the page also short-circuits with a clear message so a stray prod link
 * doesn't show a confusing error. See server/routers/auth.py for the threat
 * model (this "sign a browser in from a URL token" capability is a login-CSRF
 * vector kept off production entirely).
 */

type Status = "verifying" | "success" | "error" | "disabled";

function sanitizeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}

function InstantPageContent() {
  const router = useRouter();
  usePageReady(true);
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("verifying");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [name, setName] = useState<string | null>(null);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    if (window.location.hostname === "whoeverwants.com") {
      setStatus("disabled");
      return;
    }

    const token = searchParams.get("token");
    const next = sanitizeNext(searchParams.get("next"));
    if (!token) {
      setStatus("error");
      setErrorMessage("This sign-in link is missing its token.");
      return;
    }

    (async () => {
      try {
        const user = await apiAdoptInstantSession(token);
        setName(user.name ?? null);
        setStatus("success");
        setTimeout(() => router.replace(next), 800);
      } catch (err) {
        setStatus("error");
        if (err instanceof ApiError) {
          setErrorMessage(err.message || "Couldn't sign you in with this link.");
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
            {name ? `as ${name}` : null}
          </p>
        </div>
      )}
      {status === "disabled" && (
        <div>
          <h1 className="text-xl font-semibold mb-2">Dev links only</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Instant sign-in links work only on preview / dev environments.
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
          <button
            type="button"
            onClick={() => router.replace("/")}
            className="rounded-full bg-blue-600 hover:bg-blue-700 text-white px-6 h-11 font-medium"
          >
            Go home
          </button>
        </div>
      )}
    </div>
  );
}

export default function InstantPage() {
  return (
    <Suspense fallback={null}>
      <InstantPageContent />
    </Suspense>
  );
}
