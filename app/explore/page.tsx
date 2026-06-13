"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePageReady } from "@/lib/usePageReady";
import { navigateWithTransition } from "@/lib/viewTransitions";
import {
  useSwipeBackGesture,
  useHeaderPortalRef,
} from "@/lib/useSwipeBackGesture";
import {
  SHOW_HOME_BACKDROP_EVENT,
  HIDE_HOME_BACKDROP_EVENT,
  EXPLORE_POLL_CHANGED_EVENT,
} from "@/lib/eventChannels";
import HeaderPortal from "@/components/HeaderPortal";
import { apiGetExplore } from "@/lib/api/groups";
import { getCachedExplorePolls } from "@/lib/questionCache";
import { DRAFT_POLL_PORTAL_ID, EXPLORE_ATTR, GROUP_ID_ATTR, PANEL_HEIGHT_VAR } from "@/lib/groupDomMarkers";
import type { Poll, Question } from "@/lib/types";
import { getCategoryIcon, relativeTime } from "@/lib/questionListUtils";
import { slideToPollDetail } from "@/lib/slideOverlay";

// Mirrors ROW_DIVIDER_CLASS in GroupCardItem (inlined to keep that heavy
// "use client" component module out of the /explore bundle).
const ROW_DIVIDER_CLASS = "border-gray-300 dark:border-gray-600";

/** One poll row in the Explore feed. Edge-to-edge rectangle with a bottom
 *  divider, mirroring the group card layout but trimmed: category icon +
 *  title + a muted metadata line. Tapping slides to the poll's detail page
 *  (which renders the full ballot + results). */
function ExplorePollCard({ poll }: { poll: Poll }) {
  const anchor: Question | undefined = poll.questions[0];
  // The poll's OWN title (the wrapper-level question title), NOT poll.title —
  // the latter resolves to the explore group's "Explore" name override.
  const title = anchor?.title || poll.title || "Poll";
  const icon = anchor ? getCategoryIcon(anchor) : "🗳️";
  const groupRoute = poll.group_short_id ?? poll.group_id ?? null;
  const pollShort = poll.short_id ?? poll.id;
  const views = poll.viewed_total ?? 0;

  const onTap = useCallback(() => {
    if (!groupRoute) return;
    slideToPollDetail({ groupId: groupRoute, pollShortId: pollShort });
  }, [groupRoute, pollShort]);

  return (
    <button
      type="button"
      onClick={onTap}
      className={`block w-full text-left pl-[0.9rem] pr-[0.65rem] pt-3 pb-2 border-b ${ROW_DIVIDER_CLASS} active:bg-gray-100 dark:active:bg-gray-800/60`}
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 text-lg leading-tight" aria-hidden>{icon}</span>
        <h3 className="min-w-0 flex-1 text-lg font-medium leading-tight break-words">
          {title}
        </h3>
        <svg className="shrink-0 w-4 h-4 mt-1 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <div className="mt-1 flex items-baseline gap-1 text-xs text-gray-400 dark:text-gray-500">
        {poll.creator_name && <span className="truncate shrink min-w-0">{poll.creator_name}</span>}
        {poll.creator_name && <span aria-hidden>·</span>}
        <span className="shrink-0">{relativeTime(poll.created_at)}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">{views} {views === 1 ? "View" : "Views"}</span>
      </div>
    </button>
  );
}

export default function ExplorePage() {
  const router = useRouter();
  usePageReady(true);

  // Seed from cache for a flicker-free first paint, then refresh.
  const [polls, setPolls] = useState<Poll[]>(() => getCachedExplorePolls() ?? []);
  const [loaded, setLoaded] = useState<boolean>(() => getCachedExplorePolls() !== null);
  const [exploreGroupId, setExploreGroupId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const feed = await apiGetExplore();
    setPolls(feed.polls);
    setExploreGroupId(feed.group?.id ?? null);
    setLoaded(true);
  }, []);

  // Mark the page as the explore composing surface so CreateQuestionContent
  // (the persistent bottom create bar) flags new polls as explore polls and
  // scopes its "recent polls" suggestions to the explore feed. Set the group
  // id once known so category-recency is scoped to the explore group.
  useEffect(() => {
    document.body.setAttribute(EXPLORE_ATTR, "1");
    return () => {
      document.body.removeAttribute(EXPLORE_ATTR);
      document.body.removeAttribute(GROUP_ID_ATTR);
    };
  }, []);
  useEffect(() => {
    if (exploreGroupId) document.body.setAttribute(GROUP_ID_ATTR, exploreGroupId);
    else document.body.removeAttribute(GROUP_ID_ATTR);
  }, [exploreGroupId]);

  // Initial fetch + refresh on create / tab re-show.
  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener(EXPLORE_POLL_CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(EXPLORE_POLL_CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const sortedPolls = useMemo(
    () => [...polls].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
    [polls],
  );

  // Swipe-back → home (mirrors the settings page's gesture).
  const headerPortalRef = useHeaderPortalRef();
  const { swipeWrapperRef, touchHandlers } = useSwipeBackGesture({
    headerRef: headerPortalRef,
    showBackdrop: () => window.dispatchEvent(new Event(SHOW_HOME_BACKDROP_EVENT)),
    hideBackdrop: () => window.dispatchEvent(new Event(HIDE_HOME_BACKDROP_EVENT)),
    onCommit: () => router.push("/"),
  });

  const backButton = (
    <button
      onClick={() => navigateWithTransition(router, "/", "back")}
      className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
      aria-label="Go back"
    >
      <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );

  return (
    <>
      <HeaderPortal>{backButton}</HeaderPortal>

      {/* z-index:2 + opaque background keeps the home backdrop hidden behind
          the page until the swipe moves the wrapper sideways. The negative
          horizontal margins cancel the template wrapper's `px-4` (1rem) PLUS
          the outer safe-area padding so the background paints all the way to
          the screen edges; the inner div re-applies the inset so the content
          doesn't move. Mirrors the settings page. */}
      <div
        ref={swipeWrapperRef}
        {...touchHandlers}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          zIndex: 2,
          background: "var(--background)",
          minHeight: "100dvh",
          marginLeft: "calc(-1rem - max(0.35rem, env(safe-area-inset-left, 0px)))",
          marginRight: "calc(-1rem - max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
        <div
          style={{
            paddingLeft: "max(0.35rem, env(safe-area-inset-left, 0px))",
            paddingRight: "max(0.35rem, env(safe-area-inset-right, 0px))",
            // Reserve room for the floating create bar so the last card clears it.
            paddingBottom: `var(${PANEL_HEIGHT_VAR}, 80px)`,
          }}
        >
          {/* Page title — "Explore". Lives inside the swipe wrapper (NOT the
              template) so it slides with the page during the back gesture. */}
          <div className="max-w-4xl mx-auto px-16 pb-2 page-title-safe-top">
            <h1 className="text-2xl font-bold text-center break-words select-none">
              Explore
            </h1>
          </div>

          {/* Top sentinel divider above the first card (matches the group page). */}
          {sortedPolls.length > 0 && (
            <div className={`border-t ${ROW_DIVIDER_CLASS}`} />
          )}

          {sortedPolls.map((poll) => (
            <ExplorePollCard key={poll.id} poll={poll} />
          ))}

          {loaded && sortedPolls.length === 0 && (
            <p className="text-center text-gray-500 dark:text-gray-400 px-6 py-16 leading-relaxed">
              Post anything here — a question, a poll, a plan.
              <br />
              For now, only you can see what you create.
            </p>
          )}

          {/* Portal target for the always-on create bar (the bottom plus
              button + text box). Rendered INSIDE the page content so the
              fixed bar inherits the page's transform during the swipe-back.
              See DRAFT_POLL_PORTAL_ID. */}
          <div id={DRAFT_POLL_PORTAL_ID} className="relative z-40" />
        </div>
      </div>
    </>
  );
}
