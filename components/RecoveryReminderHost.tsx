"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { getCurrentUser, apiGetMe } from "@/lib/api";
import { SESSION_CHANGED_EVENT, type SessionUser } from "@/lib/session";
import AddSignInOptionsModal from "@/components/AddSignInOptionsModal";

const IS_CAPACITOR_NATIVE =
  typeof window !== "undefined" && Capacitor.isNativePlatform();

/** An account has a recoverable identity if it can be signed back into from
 *  another device — email or an OAuth provider. A passkey is device-bound, so
 *  a passkey-only (or name-only) account still wants the nudge. */
function hasRecoveryMethod(user: SessionUser | null): boolean {
  if (!user?.providers) return false;
  return user.providers.some((p) => p === "email" || p === "google" || p === "apple");
}

/**
 * Home-page banner nudging recovery-less accounts (created by "just provide a
 * name", or passkey-only) to add a sign-in method. Sits at the bottom, left
 * of the "+ Group" FAB. Tapping opens the `AddSignInOptionsModal`, which also
 * carries the "don't remind me again" toggle. Hidden once the account gains a
 * recovery identity OR the user dismisses the reminder.
 *
 * Mounted at layout level (outside ResponsiveScaling) so `position: fixed` is
 * viewport-relative — mirrors CreateGroupButtonHost.
 */
export default function RecoveryReminderHost(): React.ReactElement | null {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const sync = () => setUser(getCurrentUser());
    sync();
    window.addEventListener(SESSION_CHANGED_EVENT, sync);
    // Refresh from the server so a dismissal / new identity made on another
    // device is reflected (and so a pre-feature cached profile without the
    // recovery_reminder_dismissed field gets it). Skip for anonymous loads
    // (no cached user → no banner anyway → no need to hit /me).
    if (getCurrentUser()) {
      apiGetMe()
        .then((u) => setUser(u))
        .catch(() => {});
    }
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, sync);
  }, []);

  const shouldShow =
    pathname === "/" &&
    !!user &&
    !hasRecoveryMethod(user) &&
    !user.recovery_reminder_dismissed;

  if (!shouldShow) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="fixed z-40 h-12 px-4 rounded-full flex items-center gap-2 bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-600 shadow-md shadow-black/10 active:scale-95 transition-transform max-w-[60vw]"
        style={{
          left: "max(1rem, env(safe-area-inset-left, 0px))",
          bottom: IS_CAPACITOR_NATIVE ? "1.75rem" : "1rem",
        }}
        aria-label="Add a way to sign in to your account"
      >
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a4 4 0 11-8 0 4 4 0 018 0zM12 12v5m0 0h-2m2 0h2m6-9l-3 3-1.5-1.5" />
        </svg>
        <span className="text-sm font-medium truncate">Secure your account</span>
      </button>
      <AddSignInOptionsModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
