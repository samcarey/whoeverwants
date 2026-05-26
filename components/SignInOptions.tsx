"use client";

import { useEffect, useRef, useState } from "react";
import {
  apiGetAuthProviders,
  apiRequestMagicLink,
  apiRequestRecoveryEmail,
  apiSignInWithOAuth,
  ApiError,
  type AuthProvidersResponse,
} from "@/lib/api";
import {
  appleConfigured,
  appleSignIn,
  googleConfigured,
  googleSignIn,
  isNativeIOS,
  renderGoogleButton,
} from "@/lib/oauth";
import {
  PasskeyCancelledError,
  passkeySupported,
  platformPasskeySupported,
  registerPasskey,
  signInWithPasskey,
} from "@/lib/passkeys";
import { resolveActiveTheme } from "@/lib/theme";

/**
 * Shared provider-button block (Google / Apple / passkey / email) reused by:
 *   - `SignInModal` (mode="signin", anonymous): each method signs in.
 *   - the account gating modal (mode="signin"): same, the alternative to
 *     "provide a name".
 *   - the "add a recovery method" modal + Settings (mode="link", signed in):
 *     each method LINKS an identity to the CURRENT account. OAuth links via
 *     the server's signed-in branch on /oauth/{provider}; passkey adds a
 *     credential; email sends a recovery-confirmation link.
 *
 * `mode` only changes labels, the passkey button set, and the email endpoint
 * — the OAuth handlers are identical (the server decides link-vs-switch from
 * the bearer token). Keeping one component means both surfaces look and
 * behave consistently.
 */

export type SignInOptionsMode = "signin" | "link";

interface SignInOptionsProps {
  mode: SignInOptionsMode;
  /**
   * Called after a SYNCHRONOUS success (OAuth / passkey) so the host can
   * close the modal / proceed with a gated action. Email is asynchronous
   * (the user leaves to click a link), so this is NOT fired for email — the
   * inline "check your inbox" acknowledgement is the terminal state there.
   */
  onComplete?: () => void;
}

export default function SignInOptions({ mode, onComplete }: SignInOptionsProps) {
  const isLink = mode === "link";

  const [serverProviders, setServerProviders] =
    useState<AuthProvidersResponse | null>(null);
  const [platformPasskey, setPlatformPasskey] = useState<boolean | null>(null);
  const [oauthSubmitting, setOAuthSubmitting] = useState<
    "google" | "apple" | "passkey" | "passkey-register" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);

  const googleButtonRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Resolve server-side provider capability + platform-authenticator
  // availability once on mount. `apiGetAuthProviders` is module-memoized so
  // this only hits the network on the first mount per page lifetime.
  useEffect(() => {
    let cancelled = false;
    apiGetAuthProviders()
      .then((p) => {
        if (!cancelled) setServerProviders(p);
      })
      .catch(() => {
        if (!cancelled) {
          setServerProviders({
            email: true,
            google: false,
            apple: false,
            passkey: false,
          });
        }
      });
    platformPasskeySupported().then((ok) => {
      if (!cancelled) setPlatformPasskey(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Google renders its own branded button into a container we supply.
  // Skipped on native iOS (the web SDK 403s in WebViews — a custom button
  // below handles that). The Promise resolves with the id_token on success.
  useEffect(() => {
    if (emailSent) return;
    if (!googleConfigured() || !serverProviders?.google) return;
    if (isNativeIOS()) return;
    const el = googleButtonRef.current;
    if (!el) return;
    let cancelled = false;
    el.innerHTML = "";
    renderGoogleButton(el, resolveActiveTheme())
      .then(async (idToken) => {
        if (cancelled) return;
        setOAuthSubmitting("google");
        setError(null);
        try {
          await apiSignInWithOAuth("google", idToken);
          onCompleteRef.current?.();
        } catch (err) {
          setError(oauthErrorMessage(err, "Google", isLink));
        } finally {
          setOAuthSubmitting(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === "Sign-in superseded") return;
        setError(
          err instanceof Error ? err.message : "Google sign-in failed to load.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [emailSent, serverProviders?.google, isLink]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setOAuthSubmitting("google");
    try {
      const idToken = await googleSignIn();
      await apiSignInWithOAuth("google", idToken);
      onComplete?.();
    } catch (err) {
      if (isOAuthCancel(err)) {
        setError(null);
      } else {
        setError(oauthErrorMessage(err, "Google", isLink));
      }
    } finally {
      setOAuthSubmitting(null);
    }
  };

  const handleAppleSignIn = async () => {
    setError(null);
    setOAuthSubmitting("apple");
    try {
      const idToken = await appleSignIn();
      await apiSignInWithOAuth("apple", idToken);
      onComplete?.();
    } catch (err) {
      if (isOAuthCancel(err)) {
        setError(null);
      } else {
        setError(oauthErrorMessage(err, "Apple", isLink));
      }
    } finally {
      setOAuthSubmitting(null);
    }
  };

  const handlePasskeySignIn = async () => {
    setError(null);
    setOAuthSubmitting("passkey");
    try {
      await signInWithPasskey();
      onComplete?.();
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        setError(null);
      } else {
        setError(
          err instanceof ApiError && err.status === 400
            ? err.message || "Passkey sign-in failed."
            : "Couldn't sign you in with a passkey. Try again in a moment.",
        );
      }
    } finally {
      setOAuthSubmitting(null);
    }
  };

  // Register a passkey. In link mode (signed in) this adds a credential to
  // the current account; in signin mode (anonymous) it mints a new
  // passkey-only account and the server issues a session.
  const handlePasskeyRegister = async () => {
    setError(null);
    setOAuthSubmitting("passkey-register");
    try {
      await registerPasskey(null);
      onComplete?.();
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        setError(null);
      } else {
        setError(
          err instanceof ApiError && err.status === 400
            ? err.message || "Couldn't add a passkey."
            : "Couldn't add a passkey. Try again in a moment.",
        );
      }
    } finally {
      setOAuthSubmitting(null);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailSubmitting || emailSent) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email address.");
      return;
    }
    setEmailSubmitting(true);
    setError(null);
    try {
      const res = isLink
        ? await apiRequestRecoveryEmail(trimmed)
        : await apiRequestMagicLink(trimmed);
      setEmailSent(true);
      setEmailConfigured(res.email_configured);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(err.message || "Invalid email address.");
      } else {
        setError("Couldn't send the link. Try again in a moment.");
      }
    } finally {
      setEmailSubmitting(false);
    }
  };

  const showGoogle = !!serverProviders?.google && googleConfigured();
  const showApple = !!serverProviders?.apple && appleConfigured();
  const showPasskey = !!serverProviders?.passkey && passkeySupported();
  // The "register a passkey" affordance needs a platform authenticator
  // (Touch ID / Face ID / Windows Hello). In link mode it's the ONLY
  // passkey button (you're already signed in, so there's nothing to sign
  // into); in signin mode it accompanies the "sign in with a passkey" one.
  const showPasskeyRegister = showPasskey && platformPasskey === true;
  const busy = oauthSubmitting !== null;

  return (
    <div>
      {emailSent ? (
        <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {isLink
              ? "Check your inbox for a confirmation link."
              : "Check your email for a sign-in link."}{" "}
            <span className="text-gray-500 dark:text-gray-400">
              It expires in 15 minutes.
            </span>
          </p>
          {emailConfigured === false && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              This server isn&apos;t configured to send real emails — check the
              API logs for the link.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={handleEmailSubmit}>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            {isLink ? "Add a recovery email" : "Email me a sign-in link"}
          </label>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={(e) => setEmail(e.target.value.trim())}
            disabled={emailSubmitting || busy}
            maxLength={254}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white mb-3"
          />
          <button
            type="submit"
            disabled={emailSubmitting || !email.trim() || busy}
            className="w-full rounded-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-medium disabled:opacity-50"
          >
            {emailSubmitting
              ? "Sending…"
              : isLink
                ? "Send recovery link"
                : "Send sign-in link"}
          </button>
        </form>
      )}

      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs text-gray-500 dark:text-gray-400">or</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

      {showGoogle &&
        (isNativeIOS() ? (
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className="w-full mb-3 flex items-center justify-center gap-2 rounded-md h-11 font-medium border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <GoogleGlyph />
            {oauthSubmitting === "google"
              ? "Connecting…"
              : isLink
                ? "Connect Google"
                : "Sign in with Google"}
          </button>
        ) : (
          <div className="mb-3">
            <div
              ref={googleButtonRef}
              className="flex justify-center min-h-[44px]"
              aria-label="Sign in with Google"
            />
          </div>
        ))}
      {showApple && (
        <button
          type="button"
          onClick={handleAppleSignIn}
          disabled={busy}
          className="w-full mb-3 flex items-center justify-center gap-2 rounded-md h-11 font-medium bg-black text-white dark:bg-white dark:text-black disabled:opacity-50"
        >
          <AppleGlyph />
          {oauthSubmitting === "apple"
            ? "Connecting…"
            : isLink
              ? "Connect Apple"
              : "Sign in with Apple"}
        </button>
      )}
      {/* Passkey: link mode → "Add a passkey" only; signin mode → sign in +
          (when a platform authenticator exists) create. */}
      {showPasskey && !isLink && (
        <button
          type="button"
          onClick={handlePasskeySignIn}
          disabled={busy}
          className="w-full mb-3 flex items-center justify-center gap-2 rounded-md h-11 font-medium border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <PasskeyGlyph />
          {oauthSubmitting === "passkey"
            ? "Signing in…"
            : "Sign in with a passkey"}
        </button>
      )}
      {showPasskeyRegister && (
        <button
          type="button"
          onClick={handlePasskeyRegister}
          disabled={busy}
          className={
            isLink
              ? "w-full mb-3 flex items-center justify-center gap-2 rounded-md h-11 font-medium border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              : "w-full mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
          }
        >
          {isLink && <PasskeyGlyph />}
          {oauthSubmitting === "passkey-register"
            ? isLink
              ? "Adding…"
              : "Creating account…"
            : isLink
              ? "Add a passkey"
              : "New here? Create an account with a passkey"}
        </button>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 mt-3">{error}</p>
      )}
    </div>
  );
}

// "user cancelled the OS / popup prompt" detection, shared by Google + Apple.
function isOAuthCancel(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const rawError = (err as { error?: string })?.error;
  return (
    /popup_closed_by_user|user_cancelled|cancell?ed|error 1001/i.test(message) ||
    (typeof rawError === "string" && /cancell?ed/i.test(rawError))
  );
}

function oauthErrorMessage(err: unknown, label: string, isLink: boolean): string {
  if (err instanceof ApiError && (err.status === 400 || err.status === 409)) {
    return err.message || `${label} ${isLink ? "linking" : "sign-in"} failed.`;
  }
  return `Couldn't ${isLink ? "connect" : "sign you in with"} ${label}. Try again in a moment.`;
}

function GoogleGlyph() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function PasskeyGlyph() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a4 4 0 11-8 0 4 4 0 018 0zM12 12v5m0 0h-2m2 0h2m6-9l-3 3-1.5-1.5" />
    </svg>
  );
}
