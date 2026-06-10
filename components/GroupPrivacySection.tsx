/**
 * Group privacy controls (info page).
 *
 * Surfaces:
 *   * The group's current privacy state ("Public" / "Private").
 *   * For ADMINS (migration 142), a toggle to flip between public and
 *     private. Backed by `POST /api/groups/{id}/privacy`, which checks
 *     `group_admins` server-side.
 *   * For non-admin / anonymous viewers: a read-only state line, plus a
 *     "Sign in to create private groups" nudge for anonymous viewers on a
 *     public group.
 *
 * (The Phase I "claim" affordance was retired by migration 142 — every group
 * now has a creator/admin from the moment it's created, so there's nothing to
 * claim.)
 */

"use client";

import { useEffect, useState } from "react";

import SliderSwitch from "@/components/SliderSwitch";
import SignInModal from "@/components/SignInModal";
import { haptic } from "@/lib/haptics";
import { apiUpdateGroupPrivacy, ApiError } from "@/lib/api";
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
  /** Migration 142: is the viewer an admin of this group? Gates the toggle.
   *  Resolved by the parent from the members roster (`viewer_is_admin`). */
  viewerIsAdmin: boolean;
}

export default function GroupPrivacySection({
  group,
  groupId,
  className = "mt-[0.96rem]",
  viewerIsAdmin,
}: Props) {
  // Initialize as null to match SSR (no localStorage on the server); the
  // mount effect seeds from the cached profile and tracks live changes. Used
  // only for the anonymous-viewer sign-in nudge now.
  const [session, setSession] = useState<SessionUser | null>(null);
  const [privacy, setPrivacy] = useState<string | null>(group.privacy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  useEffect(() => {
    setSession(getCachedSessionUser());
    const update = () => setSession(getCachedSessionUser());
    window.addEventListener(SESSION_CHANGED_EVENT, update);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, update);
  }, []);

  // Re-sync local state when the parent's group flips (e.g. background refresh
  // after a different surface / device flipped the group).
  useEffect(() => {
    setPrivacy(group.privacy);
  }, [group.privacy]);

  const isPrivate = privacy === "private";

  const onToggle = (next: boolean) => {
    if (saving || !viewerIsAdmin) return;
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
        setPrivacy(previous);
        setError(e instanceof ApiError ? e.message : "Failed to update privacy");
      })
      .finally(() => setSaving(false));
  };

  // Admin (switch shown): a FIXED label "Private group" that describes what
  // the ON position means. Non-admin (no switch): the read-only current state.
  const rowLabel = viewerIsAdmin
    ? "Private group"
    : isPrivate
      ? "Private"
      : "Public";
  const helpText =
    (isPrivate
      ? "Only members can see this group."
      : "Anyone with the URL can see this group.") +
    (viewerIsAdmin && isPrivate ? " Share an invite link to add others." : "");

  // Sign-in nudge: anonymous viewer on a public group gets a quiet CTA.
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
                viewerIsAdmin && !saving ? "cursor-pointer" : ""
              }`}
              onClick={() => {
                if (viewerIsAdmin && !saving) onToggle(!isPrivate);
              }}
            >
              <span className="text-base font-normal">{rowLabel}</span>
              {viewerIsAdmin ? (
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
            {" to create private groups."}
          </p>
        )}
      </section>
      <SignInModal isOpen={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
