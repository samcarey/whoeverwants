"use client";

import { useState, useEffect, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { getUserName, getUserLocation, type UserLocation } from "@/lib/userProfile";
import {
  apiGetMyUserProfile,
  cacheMyUserProfile,
  apiGetMe,
  apiGetAuthProviders,
  apiSignOut,
  apiListPasskeys,
  apiDeletePasskey,
  getCurrentUser,
  type PasskeySummary,
} from "@/lib/api";
import {
  PasskeyCancelledError,
  passkeySupported,
  platformPasskeySupported,
  registerPasskey,
} from "@/lib/passkeys";
import { SESSION_CHANGED_EVENT, type SessionUser } from "@/lib/session";
import SignInModal from "@/components/SignInModal";
import AddSignInOptionsModal from "@/components/AddSignInOptionsModal";
import MergeAccountModal from "@/components/MergeAccountModal";
import { usePageReady } from "@/lib/usePageReady";
import { navigateWithTransition } from "@/lib/viewTransitions";
import { useLongPress } from "@/lib/useLongPress";
import { isAppHydrated } from "@/lib/hydration";
import {
  useSwipeBackGesture,
  useHeaderPortalRef,
  resetSwipeBackChrome,
} from "@/lib/useSwipeBackGesture";
import {
  SHOW_HOME_BACKDROP_EVENT,
  HIDE_HOME_BACKDROP_EVENT,
  HIDE_SETTINGS_BACKDROP_EVENT,
} from "@/lib/eventChannels";
import HeaderPortal from "@/components/HeaderPortal";
import InitialBubble from "@/components/InitialBubble";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import ConfirmationModal from "@/components/ConfirmationModal";
import { getStoredTheme, saveTheme, type ThemePreference } from "@/lib/theme";
import {
  getEffectiveBadgeSettings,
  saveBadgeSettings,
  DEFAULT_BADGE_SETTINGS,
  type BadgeSettings,
} from "@/lib/badgeSettings";
import SliderSwitch from "@/components/SliderSwitch";
import {
  getEffectiveVoteReminder,
  saveVoteReminder,
  VOTE_REMINDER_OPTIONS,
  DEFAULT_VOTE_REMINDER,
  type VoteReminder,
} from "@/lib/voteReminder";

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: React.ReactNode }> = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path strokeLinecap="round" d="M8 20h8M12 16v4" />
      </svg>
    ),
  },
];

// Module-level mirrors of the async-fetched passkey surfaces, so a REMOUNT of
// this page (notably the real route mounting over the settled
// SettingsBackdropHost instance after an edit→settings swipe-back commit)
// paints the passkeys section on its first commit instead of flashing
// "Loading…" / hiding the section while the fetches re-resolve. Same
// no-first-commit-gap rationale as the RankableOptions sync seed — see the
// swipe-back handoff note in CLAUDE.md. Updated on every successful fetch;
// `cachedPasskeys` is cleared on sign-out so the next sign-in can't flash the
// previous account's list.
let cachedPasskeys: PasskeySummary[] | null = null;
let cachedPasskeyServerEnabled: boolean | null = null;
let cachedPlatformAuthAvailable: boolean | null = null;

interface SettingsViewProps {
  /** True when mounted inside SettingsBackdropHost (the edit→settings
   *  swipe-back backdrop) rather than as the real route. Gates the
   *  page-ready signal and swaps the HeaderPortal buttons for inline
   *  fixed buttons (the portal node belongs to — and is transformed
   *  with — the page being swiped on top). */
  inOverlay?: boolean;
}

/** Prop-driven view exposed so SettingsBackdropHost can render this page
 *  underneath /settings/edit during its swipe-back gesture. The default
 *  route export below wraps it with the backdrop-dismissal mount effect. */
export function SettingsView({ inOverlay = false }: SettingsViewProps) {
  const router = useRouter();
  usePageReady(!inOverlay);
  // Seed every localStorage-backed state synchronously on post-hydration
  // mounts so the first commit paints the settled UI (no effect-pass
  // flicker — visible on swipe-back handoffs where this page mounts over
  // an already-settled backdrop). During the app's initial hydration the
  // seeds stay at the SSR-parity defaults and the mount effects populate
  // them, exactly as before (eager reads there would diverge from the
  // server-rendered HTML).
  const seeded = typeof window !== "undefined" && isAppHydrated();
  const [name, setName] = useState(() => (seeded ? getUserName() ?? "" : ""));
  const [savedLocation, setSavedLocation] = useState<UserLocation | null>(
    () => (seeded ? getUserLocation() : null),
  );
  const [theme, setTheme] = useState<ThemePreference>(
    () => (seeded ? getStoredTheme() : "system"),
  );
  // App-icon badge model. Pulled from the effective settings (account when
  // signed in, else localStorage) and re-read whenever the signed-in
  // identity changes.
  const [badge, setBadge] = useState<BadgeSettings>(
    () => (seeded ? getEffectiveBadgeSettings() : DEFAULT_BADGE_SETTINGS),
  );
  // "Remind me to vote" preference. Same init/sync model as the badge settings.
  const [voteReminder, setVoteReminder] = useState<VoteReminder>(
    () => (seeded ? getEffectiveVoteReminder() : DEFAULT_VOTE_REMINDER),
  );
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Read-only display of the current profile image. Editing (upload /
  // remove) lives on /settings/edit; this just reflects the cached value
  // and refreshes on USER_PROFILE_CHANGED_EVENT (clears on sign-out,
  // updates on sign-in).
  const serverImageUrl = useMyUserImageUrl();

  // Null during the initial hydration render for SSR parity (an eager
  // `useState(() => getCurrentUser())` there produces a hydration mismatch
  // when signed in); seeded from the cached profile on post-hydration
  // mounts via the `seeded` gate, then apiGetMe() refreshes either way.
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(
    () => (seeded ? getCurrentUser() : null),
  );
  const [signInModalOpen, setSignInModalOpen] = useState(false);
  const [signOutInFlight, setSignOutInFlight] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  // Tap-to-copy feedback for the #id chip under the avatar.
  const [copiedId, setCopiedId] = useState(false);

  // "Add a sign-in method" — opens the shared AddSignInOptionsModal (the
  // same surface the home-page recovery banner opens), which links
  // email / Google / Apple / passkey to the current account. Shown when
  // signed in AND the account has no 'email' provider (passkey-only /
  // OAuth-only / name-only).
  const [addSignInOpen, setAddSignInOpen] = useState(false);
  // "Combine another account" — folds a second real account into this one
  // (for users who accidentally created two). Opens MergeAccountModal.
  const [mergeOpen, setMergeOpen] = useState(false);

  const hasEmailIdentity = !!currentUser?.providers?.includes("email");
  const signedIn = !!currentUser;
  // The user's id as a dashless hex string (null when signed out) — shown
  // as a tappable #id chip under the avatar and copied to the clipboard.
  const userHex = currentUser?.user_id ? userIdToHex(currentUser.user_id) : null;

  // Phase D — passkeys. Only fetched + shown when signed in. The server
  // tier capability + browser capability are both gates: the server
  // tier check comes from /api/auth/providers (memoized in
  // apiGetAuthProviders); the browser check is sync from
  // passkeySupported(). Platform-authenticator availability is async
  // and used to gate the "Add passkey" affordance — registration
  // requires a real authenticator.
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(
    () => (seeded ? cachedPasskeys : null),
  );
  const [passkeyServerEnabled, setPasskeyServerEnabled] = useState<boolean | null>(
    () => (seeded ? cachedPasskeyServerEnabled : null),
  );
  const [platformAuthAvailable, setPlatformAuthAvailable] = useState<boolean | null>(
    () => (seeded ? cachedPlatformAuthAvailable : null),
  );
  const [passkeyRegisterInFlight, setPasskeyRegisterInFlight] = useState(false);
  const [passkeyDeletePending, setPasskeyDeletePending] = useState<string | null>(null);
  // The passkey the user has tapped "Remove" on, awaiting confirmation.
  const [passkeyToDelete, setPasskeyToDelete] = useState<PasskeySummary | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  // Single write path for the passkeys list so the module-level mirror
  // (which seeds the next mount's first commit) can't drift from state.
  const updatePasskeys = (v: PasskeySummary[] | null) => {
    cachedPasskeys = v;
    setPasskeys(v);
  };

  // Name + reference location are read-only here (edited on /settings/edit).
  // Reflect localStorage on mount and on every session change: sign-in
  // mirrors the account name to local (via persistSignIn) before
  // SESSION_CHANGED fires, and sign-out clears it — so reading
  // getUserName() / getUserLocation() here is always current.
  useEffect(() => {
    const sync = () => {
      setCurrentUser(getCurrentUser());
      setName(getUserName() ?? "");
      setSavedLocation(getUserLocation());
    };
    sync();
    window.addEventListener(SESSION_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, sync);
  }, []);

  // Refresh from the server on mount — catches server-side revocation
  // (different device signed out, account deleted, session expired).
  // The backdrop instance skips every server fetch in this component
  // (`inOverlay` gates below): it lives for less than a second under a
  // swipe gesture and displays purely from the seeded caches; the real
  // route re-fetches moments later anyway.
  useEffect(() => {
    if (inOverlay) return;
    apiGetMe()
      .then((user) => setCurrentUser(user))
      .catch(() => {
        // Treat as "not signed in" for the network-blip case; the
        // cached value still drives the optimistic display.
      });
  }, [inOverlay]);

  // Close the add-sign-in modal whenever the signed-in identity changes
  // (sign-out, or sign-in as a different user) so it doesn't linger over
  // a now-different account.
  useEffect(() => {
    setAddSignInOpen(false);
  }, [currentUser?.user_id]);

  // Pull effective badge settings on mount AND whenever the signed-in
  // identity changes — signing into a named account makes its synced badge
  // preferences authoritative over the local copy.
  useEffect(() => {
    setBadge(getEffectiveBadgeSettings());
    setVoteReminder(getEffectiveVoteReminder());
  }, [currentUser?.user_id]);

  const updateBadge = (next: BadgeSettings) => {
    setBadge(next);
    saveBadgeSettings(next);
  };

  const handleVoteReminderChange = (next: VoteReminder) => {
    setVoteReminder(next);
    saveVoteReminder(next);
  };

  // Copy the user's id (hex, no dashes) to the clipboard for sharing.
  const handleCopyId = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
    } catch {
      // Clipboard unavailable (insecure context / denied) — still flash
      // feedback so the tap doesn't feel inert.
    }
    setCopiedId(true);
    window.setTimeout(() => setCopiedId(false), 1500);
  };

  const handleSignOut = async () => {
    if (signOutInFlight) return;
    setSignOutInFlight(true);
    try {
      await apiSignOut();
    } finally {
      setSignOutInFlight(false);
    }
  };

  // Resolve server tier capability + platform authenticator availability
  // once per page load. Both are gates on the passkey UI surfaces;
  // checking on mount means the "Add passkey" button is correctly
  // hidden / shown by the time it's relevant.
  useEffect(() => {
    if (inOverlay) return; // backdrop displays from the seeded caches
    apiGetAuthProviders()
      .then((p) => {
        cachedPasskeyServerEnabled = p.passkey;
        setPasskeyServerEnabled(p.passkey);
      })
      .catch(() => setPasskeyServerEnabled(false));
    platformPasskeySupported().then((v) => {
      cachedPlatformAuthAvailable = v;
      setPlatformAuthAvailable(v);
    });
  }, [inOverlay]);

  // Load the user's existing passkeys whenever sign-in flips to true.
  // Cleared on sign-out (currentUser=null) so a subsequent sign-in
  // doesn't briefly show the previous user's list.
  useEffect(() => {
    if (inOverlay) return; // backdrop displays from the seeded caches
    if (!currentUser) {
      updatePasskeys(null);
      return;
    }
    if (!passkeySupported() || passkeyServerEnabled === false) {
      updatePasskeys(null);
      return;
    }
    apiListPasskeys()
      .then((r) => updatePasskeys(r.passkeys))
      .catch(() => {
        // Network blip → empty list rather than infinite spinner.
        // User can retry via the page refresh.
        updatePasskeys([]);
      });
  }, [inOverlay, currentUser, passkeyServerEnabled]);

  const handleAddPasskey = async () => {
    if (passkeyRegisterInFlight) return;
    setPasskeyError(null);
    setPasskeyRegisterInFlight(true);
    try {
      const registered = await registerPasskey(null);
      // Refresh the list so the new entry shows up with its
      // server-side timestamps + transports.
      const r = await apiListPasskeys();
      updatePasskeys(r.passkeys);
      // Faint success acknowledgement — re-use the existing message
      // surface for consistency with other settings actions.
      setMessage({
        type: 'success',
        text: `Passkey registered (${registered.credential_id.slice(0, 8)}…).`,
      });
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        // User dismissed the prompt — silent.
        return;
      }
      setPasskeyError(
        err instanceof Error ? err.message : "Couldn't register passkey."
      );
    } finally {
      setPasskeyRegisterInFlight(false);
    }
  };

  const handleDeletePasskey = async (credentialId: string) => {
    if (passkeyDeletePending) return;
    setPasskeyError(null);
    setPasskeyDeletePending(credentialId);
    // Optimistic remove — server is the source of truth, but a 404
    // (already gone) is the only realistic failure mode and we'd want
    // to remove it from the list anyway.
    updatePasskeys(
      passkeys ? passkeys.filter((p) => p.credential_id !== credentialId) : passkeys
    );
    try {
      await apiDeletePasskey(credentialId);
    } catch (err) {
      // Roll back on network failure so the user can retry.
      try {
        const r = await apiListPasskeys();
        updatePasskeys(r.passkeys);
      } catch {
        // ignore
      }
      setPasskeyError(
        err instanceof Error ? err.message : "Couldn't remove passkey."
      );
    } finally {
      setPasskeyDeletePending(null);
    }
  };

  useEffect(() => {
    setTheme(getStoredTheme());

    if (inOverlay) return; // backdrop displays from the seeded caches
    // Sync the cached profile with the server. cacheMyUserProfile fires
    // USER_PROFILE_CHANGED_EVENT, so the useMyUserImageUrl hook (and every
    // other avatar surface) refreshes if the account's image changed.
    apiGetMyUserProfile()
      .then(cacheMyUserProfile)
      .catch(() => {
        // Network blip — the cached value is still authoritative.
      });
  }, [inOverlay]);

  const selectedTheme = THEME_OPTIONS.find((o) => o.value === theme);

  const handleThemeChange = (next: ThemePreference) => {
    setTheme(next);
    saveTheme(next);
  };

  // Long-press the title to open the commit-info modal (the affordance the
  // template's settings title carried before the title moved in here).
  const { props: longPressProps } = useLongPress(() =>
    window.dispatchEvent(new Event('openCommitInfo'))
  );

  // Swipe-back → home (mirrors the group info page's gesture). The home
  // backdrop (cached GroupList + home chrome) renders behind this page
  // during the drag; on commit we navigate directly with router.push (the
  // backdrop is already showing home). The header chrome is the
  // HeaderPortal-floated back/Edit buttons in the body-level
  // `#header-portal` node, so that node is the gesture's "header"
  // transform target — the buttons slide with the page (see app/layout.tsx
  // for why the portal's fixed/zero-height styling makes that safe).
  const headerPortalRef = useHeaderPortalRef();
  const { swipeWrapperRef, touchHandlers } = useSwipeBackGesture({
    headerRef: headerPortalRef,
    showBackdrop: () => window.dispatchEvent(new Event(SHOW_HOME_BACKDROP_EVENT)),
    hideBackdrop: () => window.dispatchEvent(new Event(HIDE_HOME_BACKDROP_EVENT)),
    onCommit: () => router.push("/"),
  });

  // Floating opaque-bubble buttons. On the real route they're portaled into
  // #header-portal (outside .responsive-scaling-container so position:fixed
  // is viewport-relative on desktop — mirrors the /info page). Inside the
  // settings BACKDROP they render inline instead: the portal node belongs
  // to the page being swiped on top (it's that gesture's transform target),
  // so portaled copies would overlap the editor's buttons AND slide with
  // them; inline, the backdrop's contain:strict box anchors them correctly.
  const headerButtons = (
    <>
      <button
        onClick={() => navigateWithTransition(router, '/', 'back')}
        className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
        aria-label="Go back"
      >
        <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        onClick={() => navigateWithTransition(router, '/settings/edit', 'forward')}
        className="fixed right-3 z-30 h-10 px-4 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70 text-blue-600 dark:text-blue-400 text-sm font-medium"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
        aria-label="Edit profile"
      >
        Edit
      </button>
    </>
  );

  return (
    <>
      {inOverlay ? headerButtons : <HeaderPortal>{headerButtons}</HeaderPortal>}

      {/* z-index:1 + opaque background keeps the home backdrop hidden behind
          the page until the swipe moves the wrapper sideways. The negative
          horizontal margins cancel the template wrapper's `px-4` (1rem) PLUS
          the outer safe-area padding so the background paints all the way to
          the screen edges (same as the info pages); the inner div re-applies
          the inset so the content doesn't move. */}
      <div
        ref={swipeWrapperRef}
        {...touchHandlers}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          // z-2 (not z-1) so the persistent "+ Group" button can sit at z-1
          // during the swipe-back — above the z-0 home backdrop, below this
          // sliding page — and be revealed as the page slides off (rather
          // than popping on top at swipe start). See CreateGroupButtonHost.
          zIndex: 2,
          background: "var(--background)",
          minHeight: "100dvh",
          marginLeft: "calc(-1rem - max(0.35rem, env(safe-area-inset-left, 0px)))",
          marginRight: "calc(-1rem - max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
      <div
        style={{
          paddingLeft: "calc(1rem + max(0.35rem, env(safe-area-inset-left, 0px)))",
          paddingRight: "calc(1rem + max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
      {/* Page title — the saved name when set, else "Settings". Lives inside
          the swipe wrapper (NOT the template) so it slides with the page. */}
      <div className="max-w-4xl mx-auto px-16 pb-1 page-title-safe-top">
        <h1 className="text-2xl font-bold text-center break-words select-none" {...longPressProps}>
          {name.trim() || 'Settings'}
        </h1>
      </div>

      <div className="question-content pt-0.5">

      {/* Profile — read-only avatar (the name is the header title). The card
          below holds reference location + theme. Editing the photo / name /
          location lives on /settings/edit (via the header Edit button). */}
      <div className="mb-6 flex flex-col items-center">
        <InitialBubble
          imageUrl={serverImageUrl}
          name={name}
          sizeClassName="w-28 h-28"
          textSizeClassName="text-2xl"
        />
        {userHex && (
          <button
            type="button"
            onClick={() => handleCopyId(userHex)}
            className="mt-2 max-w-full break-all font-mono text-xs text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 active:opacity-70"
            aria-label="Copy your ID to clipboard"
          >
            {copiedId ? "Copied!" : `#${userHex}`}
          </button>
        )}
      </div>

      {/* Account / sign-in cluster — sits directly below the account image:
          sign in (or signed-in email + linked methods), add a sign-in method,
          passkeys, the shared status message, and sign out. */}
      <div className="mb-6">
        <section className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
          <div className="flex items-center justify-between gap-3 h-12">
            <span className="text-base font-normal shrink-0">Account</span>
            {currentUser ? (
              <span className="text-base font-normal text-gray-500 dark:text-gray-500 truncate">
                {currentUser.email || "Signed in"}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setSignInModalOpen(true)}
                className="text-base font-normal text-blue-600 dark:text-blue-400 hover:underline"
              >
                Sign in
              </button>
            )}
          </div>
          {currentUser && (
            <div className="flex items-center justify-between gap-3 h-12 border-t border-gray-200 dark:border-gray-700">
              <span className="text-base font-normal shrink-0">
                Sign-in methods
              </span>
              <span className="text-base font-normal text-gray-500 dark:text-gray-500 truncate">
                {formatProviders(currentUser.providers)}
              </span>
            </div>
          )}
          {currentUser && (
            <div className="flex items-center justify-between gap-3 h-12 border-t border-gray-200 dark:border-gray-700">
              <span className="text-base font-normal shrink-0">
                Have two accounts?
              </span>
              <button
                type="button"
                onClick={() => setMergeOpen(true)}
                className="text-base font-normal text-blue-600 dark:text-blue-400 hover:underline"
              >
                Combine another account
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Add a sign-in method — for signed-in accounts that lack an email
          identity (name-only / passkey-only / OAuth-only). Opens the same
          shared AddSignInOptionsModal the home-page recovery banner uses, so
          adding email / Google / Apple / a passkey looks identical wherever
          it's offered. */}
      {currentUser && !hasEmailIdentity && (
        <div className="mb-6">
          <section className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
            <div className="flex items-center justify-between gap-3 h-12">
              <span className="text-base font-normal">Sign-in &amp; recovery</span>
              <button
                type="button"
                onClick={() => setAddSignInOpen(true)}
                className="text-base font-normal text-blue-600 dark:text-blue-400 hover:underline"
              >
                Add a sign-in method
              </button>
            </div>
          </section>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Connect email, Google, Apple, or a passkey so you can sign back in
            if you lose this device.
          </p>
        </div>
      )}

      {/* Passkeys section — Phase D. Visible only when signed in AND
          the server tier supports passkeys AND the browser exposes
          WebAuthn. The "Add a passkey" button additionally requires a
          platform authenticator (Touch ID, Windows Hello, etc.) since
          a roaming key without a platform authenticator is the rare
          case. */}
      {currentUser && passkeyServerEnabled && passkeySupported() && (
        <div className="mb-6">
          <section className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4 py-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-base font-normal">Passkeys</span>
              {platformAuthAvailable && (
                <button
                  type="button"
                  onClick={handleAddPasskey}
                  disabled={passkeyRegisterInFlight}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  {passkeyRegisterInFlight ? "Adding…" : "Add a passkey"}
                </button>
              )}
            </div>
            {passkeys === null ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 py-2">
                Loading…
              </p>
            ) : passkeys.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 py-2">
                {platformAuthAvailable === false
                  ? "This device doesn't have a passkey-compatible authenticator. Add one from a phone or laptop with Touch ID / Face ID / Windows Hello."
                  : "No passkeys yet. Add one to skip the email step on next sign-in."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {passkeys.map((p) => (
                  <li
                    key={p.credential_id}
                    className="flex items-center justify-between py-2 gap-3 min-w-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {p.name || "Passkey"}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Added {new Date(p.created_at).toLocaleDateString()}
                        {" · "}
                        Used {new Date(p.last_used_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPasskeyToDelete(p)}
                      disabled={passkeyDeletePending === p.credential_id}
                      className="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 shrink-0"
                    >
                      {passkeyDeletePending === p.credential_id
                        ? "Removing…"
                        : "Remove"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {passkeyError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                {passkeyError}
              </p>
            )}
          </section>
        </div>
      )}

      {message && (
        <div className={`mb-4 p-3 rounded-md text-sm ${
          message.type === 'success'
            ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-400 dark:border-green-600'
            : 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-400 dark:border-red-600'
        }`}>
          {message.text}
        </div>
      )}

      {/* Sign out — separate full-width button, confirmed via modal. Only
          shown when signed in. */}
      {currentUser && (
        <button
          type="button"
          onClick={() => setShowSignOutConfirm(true)}
          disabled={signOutInFlight}
          className="w-full rounded-full border border-gray-300 dark:border-gray-600 text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center font-medium text-base h-12 disabled:opacity-50 mb-6"
        >
          {signOutInFlight ? "Signing out…" : "Sign out"}
        </button>
      )}

      <div className="mb-6">
        <section className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4 divide-y divide-gray-200 dark:divide-gray-700">
          <div className="flex items-center justify-between gap-3 h-12">
            <span className="text-base font-normal shrink-0">Reference Location</span>
            <span className="text-base font-normal text-gray-500 dark:text-gray-500 truncate">
              {savedLocation ? savedLocation.label : "Not set"}
            </span>
          </div>
          <label className="flex items-center justify-between gap-3 h-12 cursor-pointer">
            <span className="text-base font-normal shrink-0">Theme</span>
            <span className="relative inline-flex items-center gap-1.5 text-base font-normal text-gray-500 dark:text-gray-500">
              {selectedTheme?.icon}
              {selectedTheme?.label}
              <svg
                aria-hidden="true"
                className="w-4 h-4 shrink-0"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 3a.75.75 0 01.55.24l3.25 3.5a.75.75 0 11-1.1 1.02L10 4.852 7.3 7.76a.75.75 0 01-1.1-1.02l3.25-3.5A.75.75 0 0110 3zm-3.76 9.2a.75.75 0 011.06.04L10 15.148l2.7-2.908a.75.75 0 111.1 1.02l-3.25 3.5a.75.75 0 01-1.1 0l-3.25-3.5a.75.75 0 01.04-1.06z"
                  clipRule="evenodd"
                />
              </svg>
              <select
                value={theme}
                onChange={(e) => handleThemeChange(e.target.value as ThemePreference)}
                className="absolute inset-0 opacity-0 cursor-pointer"
                aria-label="Theme"
              >
                {THEME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </section>
      </div>

      {/* Unread polls: the app-icon badge counts unread polls, and the gold
          bar on group cards marks them. Three account-synced switches.
          "Stay unread until I respond" gates the two re-light toggles (inert
          in that mode, where unread = open + un-responded). */}
      <div className="mb-6">
        <h2 className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
          Unread polls
        </h2>
        <section className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4 divide-y divide-gray-200 dark:divide-gray-700">
          <div
            className={`flex items-center justify-between gap-3 h-12 ${
              signedIn ? "cursor-pointer" : "cursor-not-allowed"
            }`}
            onClick={() => {
              if (signedIn) updateBadge({ ...badge, todoMode: !badge.todoMode });
            }}
          >
            <span
              className={`text-base font-normal shrink-0 ${
                signedIn ? "" : "text-gray-400 dark:text-gray-500"
              }`}
            >
              Stay unread until I respond
            </span>
            <SliderSwitch
              checked={badge.todoMode}
              onChange={(v) => updateBadge({ ...badge, todoMode: v })}
              disabled={!signedIn}
              aria-label="Stay unread until I respond"
            />
          </div>
          <div
            className={`flex items-center justify-between gap-3 h-12 ${
              !signedIn || badge.todoMode ? "cursor-not-allowed" : "cursor-pointer"
            }`}
            onClick={() => {
              if (signedIn && !badge.todoMode) updateBadge({ ...badge, onVotingOpen: !badge.onVotingOpen });
            }}
          >
            <span
              className={`text-base font-normal shrink-0 ${
                !signedIn || badge.todoMode ? "text-gray-400 dark:text-gray-500" : ""
              }`}
            >
              Mark unread when voting opens
            </span>
            <SliderSwitch
              checked={badge.onVotingOpen}
              onChange={(v) => updateBadge({ ...badge, onVotingOpen: v })}
              disabled={!signedIn || badge.todoMode}
              aria-label="Mark unread when voting opens"
            />
          </div>
          <div
            className={`flex items-center justify-between gap-3 h-12 ${
              !signedIn || badge.todoMode ? "cursor-not-allowed" : "cursor-pointer"
            }`}
            onClick={() => {
              if (signedIn && !badge.todoMode) updateBadge({ ...badge, onResults: !badge.onResults });
            }}
          >
            <span
              className={`text-base font-normal shrink-0 ${
                !signedIn || badge.todoMode ? "text-gray-400 dark:text-gray-500" : ""
              }`}
            >
              Mark unread when results arrive
            </span>
            <SliderSwitch
              checked={badge.onResults}
              onChange={(v) => updateBadge({ ...badge, onResults: v })}
              disabled={!signedIn || badge.todoMode}
              aria-label="Mark unread when results arrive"
            />
          </div>
        </section>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {!signedIn
            ? "Sign in to adjust these settings"
            : badge.todoMode
            ? "An open poll stays unread until you vote or abstain — opening it isn't enough. The app-icon badge counts these."
            : "Opening a poll marks it read. It becomes unread again when voting opens or results arrive (toggles above)."}
        </p>
      </div>

      {/* Vote reminders: a one-shot push before a poll's deadline if you can
          still vote but haven't. Account-synced; fractional choices fire when
          that fraction of the poll's open window remains. */}
      <div className="mb-6">
        <h2 className="block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1">
          Reminders
        </h2>
        <section className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4 divide-y divide-gray-200 dark:divide-gray-700">
          <label className="flex items-center justify-between gap-3 h-12 cursor-pointer">
            <span className="text-base font-normal shrink-0">Remind me to vote</span>
            <span className="relative inline-flex items-center gap-1.5 text-base font-normal text-gray-500 dark:text-gray-500">
              {VOTE_REMINDER_OPTIONS.find((o) => o.value === voteReminder)?.label}
              <svg
                aria-hidden="true"
                className="w-4 h-4 shrink-0"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 3a.75.75 0 01.55.24l3.25 3.5a.75.75 0 11-1.1 1.02L10 4.852 7.3 7.76a.75.75 0 01-1.1-1.02l3.25-3.5A.75.75 0 0110 3zm-3.76 9.2a.75.75 0 011.06.04L10 15.148l2.7-2.908a.75.75 0 111.1 1.02l-3.25 3.5a.75.75 0 01-1.1 0l-3.25-3.5a.75.75 0 01.04-1.06z"
                  clipRule="evenodd"
                />
              </svg>
              <select
                value={voteReminder}
                onChange={(e) => handleVoteReminderChange(e.target.value as VoteReminder)}
                className="absolute inset-0 opacity-0 cursor-pointer"
                aria-label="Remind me to vote"
              >
                {VOTE_REMINDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </section>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Get a push before a poll closes if you still haven&apos;t voted. Time-based
          choices fire that long before the deadline; percentages fire when that
          much of the poll&apos;s voting window remains.
        </p>
      </div>

      {/* About Section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 text-center">
          About
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 text-center mb-4">
          WhoeverWants is free and open-source
        </p>
        <a
          href="https://github.com/samcarey/whoeverwants"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center font-medium text-base h-12 gap-3"
        >
          <svg
            className="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              clipRule="evenodd"
            />
          </svg>
          View on GitHub
        </a>
      </div>

      <ConfirmationModal
        isOpen={showSignOutConfirm}
        title="Sign out?"
        message="Sign out of your account on this device?"
        confirmText={signOutInFlight ? "Signing out…" : "Sign out"}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={async () => {
          setShowSignOutConfirm(false);
          await handleSignOut();
        }}
        onCancel={() => setShowSignOutConfirm(false)}
      />

      <ConfirmationModal
        isOpen={passkeyToDelete !== null}
        title="Remove passkey?"
        message={`Remove "${passkeyToDelete?.name || "Passkey"}"? You won't be able to sign in with it anymore.`}
        confirmText="Remove"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => {
          const target = passkeyToDelete;
          setPasskeyToDelete(null);
          if (target) void handleDeletePasskey(target.credential_id);
        }}
        onCancel={() => setPasskeyToDelete(null)}
      />

      <SignInModal
        isOpen={signInModalOpen}
        onClose={() => setSignInModalOpen(false)}
      />

      <MergeAccountModal
        isOpen={mergeOpen}
        onClose={() => setMergeOpen(false)}
      />
      <AddSignInOptionsModal
        isOpen={addSignInOpen}
        onClose={() => setAddSignInOpen(false)}
      />
      </div>
      </div>
      </div>
    </>
  );
}

/** Default route export. Dismisses the edit→settings swipe-back backdrop on
 *  mount (mirrors GroupPageInner / PollDetailPageInner): the backdrop
 *  persists across the router.push that commits the swipe so there's no
 *  blank frame between the editor's unmount and this page's first paint;
 *  once we render, tell the host to unmount. The editor has already
 *  unmounted by this point, so this is the last place that can reset the
 *  commit-badge / #header-portal transforms and the scrollbar lock. */
export default function SettingsPage() {
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    resetSwipeBackChrome();
    window.dispatchEvent(new Event(HIDE_SETTINGS_BACKDROP_EVENT));
  }, []);

  return <SettingsView />;
}

// The user's id is a UUID, which is already hexadecimal — the "hex
// version" is just the canonical form with the dashes stripped (32 hex
// chars). This is what gets displayed (prefixed with #) and copied.
function userIdToHex(id: string): string {
  return id.replace(/-/g, "");
}

// Human-readable labels for the provider strings the server returns
// (`user_identities.provider`). Anything unrecognized falls through to a
// title-cased form so a future provider doesn't render as a raw token.
const PROVIDER_LABELS: Record<string, string> = {
  email: "Email",
  google: "Google",
  apple: "Apple",
  passkey: "Passkey",
  browser: "This browser",
};

function formatProviders(providers: string[]): string {
  if (!providers || providers.length === 0) return "—";
  return providers
    .map((p) => PROVIDER_LABELS[p] || p.charAt(0).toUpperCase() + p.slice(1))
    .join(", ");
}
