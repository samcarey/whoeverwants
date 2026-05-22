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

import { useEffect, useState } from "react";

import SliderSwitch from "@/components/SliderSwitch";
import SignInModal from "@/components/SignInModal";
import { haptic } from "@/lib/haptics";
import {
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
}

export default function GroupPrivacySection({
  group,
  groupId,
  className = "mt-[0.96rem]",
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

  const isCreator =
    !!session && !!group.creatorUserId && session.user_id === group.creatorUserId;
  const isPrivate = privacy === "private";

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

  const stateLabel = isPrivate ? "Private" : "Public";
  // Per-row help text. The creator gets a description of what flipping
  // does; non-creators get a description of the current state. Anonymous
  // viewers on a public group also get a sign-in nudge below the card.
  const helpText = (() => {
    if (isCreator) {
      return isPrivate
        ? "Only members can see this group. Share an invite link to add others."
        : "Anyone with the URL can see this group.";
    }
    if (privacy === "private") {
      return "Only members can see this group.";
    }
    return "Anyone with the URL can see this group.";
  })();

  // Sign-in nudge: anonymous viewer on a public group gets a quiet CTA
  // explaining how to create private groups in the future. Doesn't fire
  // for anonymous viewers on private groups (they wouldn't be here —
  // the /info read 404s for non-members of private groups).
  const showSignInNudge = !session && privacy !== "private";

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
              <span className="text-base font-normal">{stateLabel}</span>
              {isCreator ? (
                <SliderSwitch
                  checked={isPrivate}
                  onChange={onToggle}
                  disabled={saving}
                  aria-label={
                    isPrivate
                      ? "Make this group public"
                      : "Make this group private"
                  }
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
            {" to create private groups."}
          </p>
        )}
      </section>
      <SignInModal isOpen={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
