"use client";

import { useEffect, useRef, useState } from "react";
import ModalPortal from "./ModalPortal";
import {
  apiGetAuthProviders,
  apiRequestMagicLink,
  apiSignInWithOAuth,
  type AuthProvidersResponse,
} from "@/lib/api";
import { ApiError } from "@/lib/api";
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

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Phase B + C: magic-link + OAuth sign-in modal.
 *
 * Magic-link is always available (the Resend fallback logs to stdout
 * when API key isn't set, so dev still works); Google + Apple buttons
 * render only when BOTH client-side env vars (NEXT_PUBLIC_*_CLIENT_ID)
 * and server-side env vars (GOOGLE_OAUTH_CLIENT_IDS etc.) are
 * configured. The capability discovery happens via
 * `apiGetAuthProviders()` on mount.
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
  const [serverProviders, setServerProviders] =
    useState<AuthProvidersResponse | null>(null);
  const [oauthSubmitting, setOAuthSubmitting] = useState<
    "google" | "apple" | "passkey" | "passkey-register" | null
  >(null);
  // Platform-authenticator availability gates the "Create account
  // with a passkey" button — we don't want to surface it on devices
  // without Touch ID / Face ID / Windows Hello / etc. since the
  // ceremony would fall back to whatever roaming key the browser can
  // muster and most users without a platform authenticator also don't
  // have a YubiKey.
  const [platformPasskey, setPlatformPasskey] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef<number>(0);
  // `onClose` may be a fresh closure on every parent render — read it
  // through a ref so the Google-button effect doesn't tear down + re-
  // initialize the GIS SDK every time the parent re-renders for an
  // unrelated reason.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Resolve server-side provider capability once per modal open. The
  // fetch is module-memoized in `apiGetAuthProviders` so repeat opens
  // only hit the network on the very first open per page lifetime.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    apiGetAuthProviders()
      .then((p) => {
        if (!cancelled) setServerProviders(p);
      })
      .catch(() => {
        // Network failure → assume neither OAuth provider is available
        // on this tier, but keep the magic-link path visible. Same
        // graceful degradation for passkey: server is the source of
        // truth, and a missing field reads as false.
        if (!cancelled) {
          setServerProviders({
            email: true,
            google: false,
            apple: false,
            passkey: false,
          });
        }
      });
    // Resolve platform-authenticator availability in parallel —
    // independent of server capability, governed by the OS / browser.
    platformPasskeySupported().then((ok) => {
      if (!cancelled) setPlatformPasskey(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Google's SDK renders its own branded button into a container we
  // supply. Initialize it whenever the container mounts AND the server
  // confirms Google is configured. The Promise resolves with the
  // id_token on first successful sign-in. Skipped on native iOS — the
  // Google web SDK is blocked in WebViews (403 disallowed_useragent); a
  // custom-styled button below handles native via `handleGoogleSignIn`.
  useEffect(() => {
    if (!isOpen || sent) return;
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
          onCloseRef.current();
        } catch (err) {
          setError(
            err instanceof ApiError && err.status === 400
              ? err.message || "Google sign-in failed."
              : "Couldn't sign you in with Google. Try again in a moment."
          );
        } finally {
          setOAuthSubmitting(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // "Sign-in superseded" is raised when a re-render replaces the
        // pending resolver — not user-visible; ignore silently.
        if (err instanceof Error && err.message === "Sign-in superseded") return;
        setError(
          err instanceof Error ? err.message : "Google sign-in failed to load."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sent, serverProviders?.google]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setOAuthSubmitting("google");
    try {
      const idToken = await googleSignIn();
      await apiSignInWithOAuth("google", idToken);
      onClose();
    } catch (err) {
      // capgo plugin surfaces user-cancel as a thrown error — match
      // defensively across plugin / iOS versions. Silent on cancel.
      const message = err instanceof Error ? err.message : String(err);
      const isCancel =
        /cancell?ed|popup_closed_by_user|user_cancelled/i.test(message);
      if (!isCancel) {
        console.warn(`[google-signin] caught error: ${message}`);
      }
      if (isCancel) {
        setError(null);
      } else {
        setError(
          err instanceof ApiError && err.status === 400
            ? err.message || "Google sign-in failed."
            : "Couldn't sign you in with Google. Try again in a moment."
        );
      }
    } finally {
      setOAuthSubmitting(null);
    }
  };

  const handleAppleSignIn = async () => {
    setError(null);
    setOAuthSubmitting("apple");
    try {
      console.warn("[apple-signin] starting appleSignIn()");
      const idToken = await appleSignIn();
      console.warn(
        `[apple-signin] got id_token (len=${idToken?.length ?? 0}); POSTing to /oauth/apple`,
      );
      const res = await apiSignInWithOAuth("apple", idToken);
      console.warn(
        `[apple-signin] POST succeeded; session_token len=${res.session_token?.length ?? 0} user.user_id=${res.user?.user_id ?? "(none)"} email=${res.user?.email ?? "(none)"} providers=${(res.user?.providers ?? []).join(",")}`,
      );
      onClose();
    } catch (err) {
      // Apple rejects on user-cancel with various error shapes across
      // SDK + plugin versions — match defensively. Silent on cancel.
      //   - Web SDK throws { error: "popup_closed_by_user" }
      //   - Native plugin throws Error with message including either
      //     "canceled" / "cancelled" OR "AuthorizationError error 1001"
      //     (Apple's ASAuthorizationError.canceled raw code).
      const message = err instanceof Error ? err.message : String(err);
      const rawError = (err as { error?: string })?.error;
      const isCancel =
        /popup_closed_by_user|user_cancelled|cancell?ed|error 1001/i.test(message) ||
        (typeof rawError === "string" && /cancell?ed/i.test(rawError));
      // SignInModal swallows the error into a UI state setter, so
      // without this the client log buffer was empty when sign-in
      // silently failed. Forward every non-cancel error so the next
      // failure leaves a trail.
      if (!isCancel) {
        const status = err instanceof ApiError ? err.status : undefined;
        const name = err instanceof Error ? err.name : typeof err;
        console.warn(
          `[apple-signin] caught error: name=${name} status=${status} message=${message} rawError=${rawError ?? "(none)"}`,
        );
      }
      if (isCancel) {
        setError(null);
      } else {
        setError(
          err instanceof ApiError && err.status === 400
            ? err.message || "Apple sign-in failed."
            : "Couldn't sign you in with Apple. Try again in a moment."
        );
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
      onClose();
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        setError(null);
      } else {
        setError(
          err instanceof ApiError && err.status === 400
            ? err.message || "Passkey sign-in failed."
            : "Couldn't sign you in with a passkey. Try again in a moment."
        );
      }
    } finally {
      setOAuthSubmitting(null);
    }
  };

  const handlePasskeyRegister = async () => {
    setError(null);
    setOAuthSubmitting("passkey-register");
    try {
      // The server's anonymous-registration path issues a session
      // alongside the credential; `registerPasskey` → `apiPasskey
      // RegistrationVerify` persists it via `saveSession`. By the
      // time we return here the FE is signed in.
      await registerPasskey(null);
      onClose();
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        setError(null);
      } else {
        setError(
          err instanceof ApiError && err.status === 400
            ? err.message || "Couldn't create your account."
            : "Couldn't create an account with a passkey. Try again in a moment."
        );
      }
    } finally {
      setOAuthSubmitting(null);
    }
  };

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

  // Per-provider gating: each provider's `configured()` already short-
  // circuits surfaces it can't reach (e.g. googleConfigured() returns
  // false on native iOS until the per-bundle Google plugin lands), and
  // the server's `providers` endpoint reports tier-level config. Both
  // sides must agree before the button surfaces — otherwise users tap
  // an inert button and either nothing happens (no client SDK) or they
  // get a 503 (no server config).
  const showGoogle = !!serverProviders?.google && googleConfigured();
  const showApple = !!serverProviders?.apple && appleConfigured();
  // Passkey gating: server says it's enabled AND the browser supports
  // the WebAuthn API. `passkeySupported()` is sync (just checks for
  // PublicKeyCredential + navigator.credentials) so no async dance
  // needed here — the stronger platformPasskeySupported check is
  // reserved for the Settings registration flow where we need a
  // platform authenticator specifically.
  const showPasskey =
    !!serverProviders?.passkey && passkeySupported();
  // "Create account with a passkey" only when the device has a
  // platform authenticator. Roaming keys (USB / Bluetooth) work but
  // most users without a platform authenticator also don't have one,
  // and showing the button to them just leads to "your device can't"
  // dialogs. The sign-in button stays available either way — they
  // might have a passkey on a paired phone.
  const showPasskeyRegister =
    showPasskey && platformPasskey === true;
  const showAnyAlt = showGoogle || showApple || showPasskey;

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
            <>
              <h2 className="text-lg font-semibold mb-1">Sign in</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Pick a sign-in method. Your existing polls and groups stay
                tied to this browser regardless.
              </p>

              {showGoogle && (
                isNativeIOS() ? (
                  // Native iOS: Google's web SDK is blocked in WebViews
                  // (403 disallowed_useragent). Render a custom button
                  // styled like the others; the native plugin opens the
                  // Google app or a SFSafariViewController fallback.
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={oauthSubmitting !== null}
                    className="w-full mb-3 flex items-center justify-center gap-2 rounded-md h-11 font-medium border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 18 18"
                      aria-hidden
                    >
                      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
                      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
                      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
                      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
                    </svg>
                    {oauthSubmitting === "google"
                      ? "Signing in…"
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
                )
              )}
              {showApple && (
                <button
                  type="button"
                  onClick={handleAppleSignIn}
                  disabled={oauthSubmitting !== null}
                  className="w-full mb-3 flex items-center justify-center gap-2 rounded-md h-11 font-medium bg-black text-white dark:bg-white dark:text-black disabled:opacity-50"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  {oauthSubmitting === "apple"
                    ? "Signing in…"
                    : "Sign in with Apple"}
                </button>
              )}
              {showPasskey && (
                <button
                  type="button"
                  onClick={handlePasskeySignIn}
                  disabled={oauthSubmitting !== null}
                  className="w-full mb-3 flex items-center justify-center gap-2 rounded-md h-11 font-medium border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 7a4 4 0 11-8 0 4 4 0 018 0zM12 12v5m0 0h-2m2 0h2m6-9l-3 3-1.5-1.5"
                    />
                  </svg>
                  {oauthSubmitting === "passkey"
                    ? "Signing in…"
                    : "Sign in with a passkey"}
                </button>
              )}
              {showPasskeyRegister && (
                <button
                  type="button"
                  onClick={handlePasskeyRegister}
                  disabled={oauthSubmitting !== null}
                  className="w-full mb-3 text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  {oauthSubmitting === "passkey-register"
                    ? "Creating account…"
                    : "New here? Create an account with a passkey"}
                </button>
              )}
              {showAnyAlt && (
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    or
                  </span>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email me a sign-in link
                </label>
                <input
                  ref={inputRef}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={(e) => setEmail(e.target.value.trim())}
                  disabled={submitting || oauthSubmitting !== null}
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
                  disabled={
                    submitting || !email.trim() || oauthSubmitting !== null
                  }
                  className="w-full rounded-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-medium disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Send sign-in link"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
