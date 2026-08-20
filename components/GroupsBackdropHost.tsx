"use client";

/**
 * Body-level backdrop that mirrors /groups (title bar + cached GroupList),
 * revealed under the group detail page during its swipe-back gesture.
 *
 * Sibling of HomeBackdropHost — same architecture, different destination:
 * a group page swipes back to the LIST at /groups, while settings / explore /
 * the groups page itself swipe back to home (the playlist).
 *
 * Lifecycle:
 *   - SHOW_GROUPS_BACKDROP_EVENT (GroupContent's swipe-lock path) → mount
 *   - HIDE_GROUPS_BACKDROP_EVENT (snap-back/cancel OR the groups page's
 *     mount effect, once it has rendered through this) → unmount
 *
 * The "+ Group" FAB is not painted here — CreateGroupButtonHost keeps one
 * persistent instance and drops it to z-1 during the gesture so it's revealed
 * with the rest of this backdrop.
 */

import { createPortal } from "react-dom";
import GroupList from "@/components/GroupList";
import GroupsTitleBar from "@/components/GroupsTitleBar";
import { getCachedAccessiblePolls } from "@/lib/questionCache";
import { getCachedEmptyGroups } from "@/lib/simpleQuestionQueries";
import { getRememberedScroll, GROUPS_SCROLL_KEY } from "@/lib/scrollMemory";
import { useGroupsBackdropActive } from "@/lib/useHomeBackdropActive";
import { getCachedSessionUser } from "@/lib/session";

export default function GroupsBackdropHost(): React.ReactElement | null {
  const visible = useGroupsBackdropActive();

  if (!visible || typeof document === "undefined") return null;

  const cachedPolls = getCachedAccessiblePolls() ?? [];
  const cachedEmptyGroups = getCachedEmptyGroups() ?? [];
  const isEmpty = cachedPolls.length === 0 && cachedEmptyGroups.length === 0;
  const signedIn = !!getCachedSessionUser();

  return createPortal(
    // The portal target is document.body, which only declares the Geist font
    // as a CSS variable — without this class the text renders in the browser
    // default and snaps to Geist on commit. Same as HomeBackdropHost.
    <div className="font-[family-name:var(--font-geist-sans)]">
      <div
        ref={(el) => {
          if (!el) return;
          const remembered = getRememberedScroll(GROUPS_SCROLL_KEY);
          if (remembered !== undefined) el.scrollTop = remembered;
        }}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          background: "var(--background)",
          // Explicit overflow-x: hidden — a bare overflow-y: auto coerces the
          // other axis to `auto` too and surfaces a horizontal scrollbar.
          overflowX: "hidden",
          overflowY: "auto",
          paddingLeft: "max(0.35rem, env(safe-area-inset-left))",
          paddingRight: "max(0.35rem, env(safe-area-inset-right))",
        }}
      >
        {/* In flow (not fixed) so it scrolls with this contained snapshot,
            matching what the real page shows at its restored scroll. */}
        <GroupsTitleBar />
        <div
          className="max-w-4xl mx-auto -mx-4 sm:mx-auto sm:px-4"
          style={{ paddingBottom: "6rem" }}
        >
          {isEmpty && (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                You don&apos;t have access to any groups
              </p>
              {!signedIn && (
                <span className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg">
                  Sign In
                </span>
              )}
            </div>
          )}
          <GroupList polls={cachedPolls} emptyGroups={cachedEmptyGroups} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
