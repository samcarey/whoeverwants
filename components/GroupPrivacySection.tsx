/**
 * Phase E (group privacy) — info-page privacy controls.
 *
 * Surfaces:
 *   * The group's current privacy state ("Public" / "Private") as the
 *     primary readout.
 *   * For the recorded creator (and only when signed in), a toggle to
 *     flip between public and private. Backed by
 *     `POST /api/groups/{id}/privacy`, which checks the session's
 *     user_id against the group's `creator_user_id` server-side.
 *   * For non-creator viewers: a help line describing what the state
 *     means. Anonymous viewers on a public group get a sign-in nudge
 *     ("Sign in to create private groups in the future") wired to the
 *     existing `<SignInModal>`.
 *
 * Why a toggle in Phase E: signed-in users create private groups by
 * default, but Phase F/G (join requests + invite links) haven't shipped
 * yet. Without a toggle, a signed-in user's group is unsharable. The
 * toggle gives them an escape hatch — flip public until the invite UI
 * arrives.
 *
 * Pre-Phase-E (grandfathered) groups have `privacy='public'` and no
 * `creator_user_id`, so no one can flip them. They stay public; the
 * read-only display is the only thing rendered for those.
 *
 * Anonymous-created groups (post-Phase-E) also have NULL
 * `creator_user_id` and are equally immutable; Phase I will add an
 * "anonymous → claim" upgrade. Until then, the toggle simply doesn't
 * appear for non-creators.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import SliderSwitch from "@/components/SliderSwitch";
import SignInModal from "@/components/SignInModal";
import { haptic } from "@/lib/haptics";
import {
  apiClaimGroup,
  apiUpdateGroupPrivacy,
  ApiError,
} from "@/lib/api";
import {
  getCachedSessionUser,
  SESSION_CHANGED_EVENT,
  type SessionUser,
} from "@/lib/session";
import type { Group } from "@/lib/groupUtils";

interface Props {
  group: Group;
  groupId: string;
  className?: string;
  /** Optional override for the group's creator_user_id. When the parent
   *  has lifted an optimistic post-claim state, pass it here so the
   *  isCreator computation matches what the rest of /info sees (Join-
   *  Requests / Invite-Links sections gate on the same value). A null or
   *  undefined value falls back to `group.creatorUserId` — there's no
   *  way to "explicitly override to no-creator" because the cached value
   *  already conveys that. */
  effectiveCreatorUserId?: string | null;
  /** Fires after a successful Phase I "claim" — the parent should
   *  store the new creator_user_id so its own `viewerIsCreator`
   *  computation flips true on the next render and the other
   *  creator-only sections appear without a page refresh. */
  onCreatorClaimed?: (newCreatorUserId: string) => void;
}

export default function GroupPrivacySection({
  group,
  groupId,
  className = "mt-[0.96rem]",
  effectiveCreatorUserId,
  onCreatorClaimed,
}: Props) {
  // Initialize as null to match SSR (no localStorage on the server);
  // the mount effect below seeds from the localStorage-cached profile
  // AND subscribes to live session changes. Eagerly reading via
  // `useState(() => getCachedSessionUser())` would produce a hydration
  // mismatch when signed in — server renders the no-toggle branch,
  // client's first render reads localStorage and renders the toggle.
  const [session, setSession] = useState<SessionUser | null>(null);
  const [privacy, setPrivacy] = useState<string | null>(group.privacy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  // 409-on-claim means a concurrent device beat us to it. Surface the
  // error and hide the button — keeping it tappable just produces an
  // infinite retry loop with stale local state until the user navigates
  // away. The next group fetch (cache TTL bounded) will resync
  // `group.creatorUserId` from the server.
  const [claimRaced, setClaimRaced] = useState(false);
  // In-flight guard for the claim POST: state-based `claiming` is read
  // from the closure and a double-tap within the same render batch
  // sees the old `false`. A ref flips synchronously, so the second tap
  // bails before firing a second request that would 409.
  const claimInFlightRef = useRef(false);

  // Mount + subscribe: seed `session` from the localStorage cache and
  // listen for live changes (sign-in via SignInModal, sign-out
  // elsewhere) so toggle visibility tracks without a remount.
  useEffect(() => {
    setSession(getCachedSessionUser());
    const update = () => setSession(getCachedSessionUser());
    window.addEventListener(SESSION_CHANGED_EVENT, update);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, update);
  }, []);

  // Re-sync local state when the parent's group flips (e.g. background
  // refresh after a different surface flipped the group). Without this,
  // a creator who flipped on Device A would still see the old state on
  // Device B's already-mounted /info page until they navigated away.
  useEffect(() => {
    setPrivacy(group.privacy);
  }, [group.privacy]);

  // Prefer the parent's lifted override (post-claim optimistic state)
  // over the stale `group.creatorUserId` from the cache — keeps every
  // creator-only surface on /info in lockstep. `??` falls back on
  // null/undefined identically; a string override always wins.
  const creatorUserId = effectiveCreatorUserId ?? group.creatorUserId;
  const isCreator =
    !!session && !!creatorUserId && session.user_id === creatorUserId;
  const isPrivate = privacy === "private";
  // Phase I claim affordance: signed-in user, group has NO recorded
  // creator, AND we haven't already lost a claim race. Anonymous
  // viewers fall through to the sign-in nudge (which surfaces a
  // claim-specific message when the group is also claimable). The
  // membership gate is enforced server-side — visiting /info implies
  // membership for private groups already, and public-group visitors
  // auto-join via the /by-route-id read endpoint before this section
  // renders.
  const canClaim = !!session && !creatorUserId && !claimRaced;

  const onToggle = (next: boolean) => {
    if (saving || !isCreator) return;
    const target: "public" | "private" = next ? "private" : "public";
    if (target === privacy) return;
    haptic.medium();
    const previous = privacy;
    setPrivacy(target);
    setError(null);
    setSaving(true);
    apiUpdateGroupPrivacy(groupId, target)
      .then((result) => setPrivacy(result.privacy))
      .catch((e) => {
        // Roll back optimistic update on failure.
        setPrivacy(previous);
        const msg =
          e instanceof ApiError ? e.message : "Failed to update privacy";
        setError(msg);
      })
      .finally(() => setSaving(false));
  };

  const onClaim = () => {
    if (claimInFlightRef.current || !canClaim) return;
    claimInFlightRef.current = true;
    haptic.medium();
    setError(null);
    setClaiming(true);
    apiClaimGroup(groupId)
      .then((result) => {
        onCreatorClaimed?.(result.creator_user_id);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 409) {
          // Someone else claimed first. Hide the button + show a clear
          // explanation; the next group fetch will resync the creator
          // server-side.
          setClaimRaced(true);
          setError("Another member just claimed this group.");
        } else {
          const msg =
            e instanceof ApiError ? e.message : "Failed to claim group";
          setError(msg);
        }
      })
      .finally(() => {
        claimInFlightRef.current = false;
        setClaiming(false);
      });
  };

  // Label rules:
  //   * Creator (switch shown): a FIXED label "Private group" that
  //     describes what the ON position means. The switch position alone
  //     conveys the state — a label that changed with the toggle (the old
  //     "Private"/"Public" readout) made it impossible to tell what the
  //     switch *does* versus what it currently *is*.
  //   * Non-creator (no switch): the read-only current state, since there
  //     is no switch to convey it.
  const rowLabel = isCreator ? "Private group" : isPrivate ? "Private" : "Public";
  // Base description by state; creator gets the invite-link nudge as a
  // suffix when private (Phase F/G will deliver the actual invite UI).
  const helpText =
    (isPrivate ? "Only members can see this group." : "Anyone with the URL can see this group.")
    + (isCreator && isPrivate ? " Share an invite link to add others." : "");

  // Sign-in nudge: anonymous viewer on a public group gets a quiet CTA.
  // Copy is context-aware — on a CLAIMABLE group (no recorded creator)
  // the actionable hint is "Sign in to claim THIS group"; otherwise it's
  // the general "Sign in to create private groups" pitch for future
  // group creation. Doesn't fire for anonymous viewers on private groups
  // (they wouldn't be here — the /info read 404s non-members).
  const showSignInNudge = !session && privacy !== "private";
  const signInNudgeText = !creatorUserId
    ? " to claim this group."
    : " to create private groups.";

  return (
    <>
      <section className={className}>
        <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
          Privacy
        </h2>
        <div className="rounded-3xl bg-gray-50 dark:bg-gray-800 px-4">
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            <div
              className={`flex items-center justify-between gap-3 h-12 ${
                isCreator && !saving ? "cursor-pointer" : ""
              }`}
              onClick={() => {
                if (isCreator && !saving) onToggle(!isPrivate);
              }}
            >
              <span className="text-base font-normal">{rowLabel}</span>
              {isCreator ? (
                <SliderSwitch
                  checked={isPrivate}
                  onChange={onToggle}
                  disabled={saving}
                  aria-label="Private group"
                />
              ) : null}
            </div>
          </div>
        </div>
        {(error || helpText) && (
          <p
            className={`px-1 mt-2 text-xs ${
              error
                ? "text-red-600 dark:text-red-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {error ?? helpText}
          </p>
        )}
        {showSignInNudge && (
          <p className="px-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
            <button
              type="button"
              onClick={() => setSignInOpen(true)}
              className="text-blue-600 dark:text-blue-400 hover:underline active:opacity-70"
            >
              Sign in
            </button>
            {signInNudgeText}
          </p>
        )}
        {canClaim && (
          <div className="mt-3">
            <button
              type="button"
              onClick={onClaim}
              disabled={claiming}
              className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center transition-transform"
              aria-label="Claim this group as creator"
            >
              {claiming ? "Claiming…" : "Claim this group"}
            </button>
            <p className="px-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
              This group has no recorded creator. Claim it to unlock
              privacy, invite links, and join-request approvals.
            </p>
          </div>
        )}
      </section>
      <SignInModal isOpen={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
