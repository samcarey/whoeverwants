"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { hasAppHistory } from "@/lib/viewTransitions";
import { slideToGroupRoot, slideToGroupEditTitle } from "@/lib/slideOverlay";
import { useGroup } from "@/lib/useGroup";
import GroupAvatar from "@/components/GroupAvatar";
import GroupShareButton from "@/components/GroupShareButton";
import InitialBubble from "@/components/InitialBubble";
import NotificationSettingsCard from "@/components/NotificationSettingsCard";
import { GroupLoading, GroupNotFound } from "@/components/GroupLoadState";
import { getUserName, isCurrentUserName } from "@/lib/userProfile";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";

/** Prop-driven inner view. Exposed so the slide overlay can render this
 *  view directly without going through useParams() (the overlay mounts
 *  the component while the URL is still the source page). */
export function GroupInfoView({ groupId }: { groupId: string }) {
  const { group, loading, error } = useGroup(groupId);

  if (loading) return <GroupLoading />;
  if (error || !group) return <GroupNotFound />;
  return <Info group={group} groupId={groupId} />;
}

function Info({ group, groupId }: { group: import("@/lib/groupUtils").Group; groupId: string }) {
  const myUserImageUrl = useMyUserImageUrl();

  const goBack = () => {
    // Slide overlay: mount the group root above the current page and slide
    // it in from the left. router.back() (or .push if no in-app history)
    // fires in parallel from the overlay host. Eliminates the
    // view-transitions snapshot+commit wait before the first frame.
    slideToGroupRoot({ groupId, direction: 'back', useHistoryBack: hasAppHistory() });
  };

  // /info is the canonical roster — the viewer is always a member
  // (visiting the URL auto-joins them via the by-route-id read endpoint),
  // so they always appear in the list. Other surfaces filter them out of
  // `participantNames` so they don't see themselves in the group name;
  // here we add them back in. `viewerLabel` falls back to "You" when no
  // localStorage name is set so a freshly-joined nameless viewer doesn't
  // see "0 Members".
  const currentUserName = getUserName()?.trim() || null;
  const viewerLabel = currentUserName ?? "You";
  const membersList = [...group.participantNames, viewerLabel].sort((a, b) =>
    a.localeCompare(b),
  );
  const totalCount = membersList.length;

  // Hero + title also surface the viewer in the solo case so the page
  // doesn't render a gray placeholder + "New Group" fallback for a
  // single-member group. Gated on a real name — we'd rather not invent a
  // group name from "You".
  const showViewerInHero =
    group.participantNames.length === 0 &&
    group.anonymousRespondentCount === 0 &&
    currentUserName !== null;
  const heroNames = showViewerInHero ? [currentUserName] : group.participantNames;
  const displayTitle =
    showViewerInHero && !group.groupTitleOverride ? currentUserName : group.title;

  return (
    <>
      {/* Floating opaque-bubble back + Edit buttons over a transparent top bar. */}
      <button
        onClick={goBack}
        className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
        aria-label="Go back"
      >
        <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        onClick={() => slideToGroupEditTitle({ groupId, direction: 'forward' })}
        className="fixed right-3 z-30 h-10 px-4 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70 text-blue-600 dark:text-blue-400 text-sm font-medium"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
        aria-label="Edit group title"
      >
        Edit
      </button>

      <div className="max-w-4xl mx-auto px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.05rem)' }}>
        <div className="flex flex-col items-center text-center mb-[3.2px]">
          <div className="relative inline-block">
            <GroupAvatar
              imageUrl={group.imageUrl}
              names={heroNames}
              anonymousCount={group.anonymousRespondentCount}
              sizeClassName="w-[8.4rem]"
            />
            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-[0.15rem]">
              <GroupShareButton routeId={groupId} title={group.title} />
            </div>
          </div>
          <h1 className="mt-[0.2rem] text-3xl font-bold text-gray-900 dark:text-white break-words">
            {displayTitle}
          </h1>
        </div>

        <div className="-mt-[0.3rem]">
          <NotificationSettingsCard groupRouteId={groupId} />
        </div>

        <h2 className="mt-6 px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
          {totalCount} {totalCount === 1 ? 'Member' : 'Members'}
        </h2>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {membersList.map((name) => {
              // Viewer row resolves either as the literal "You" label
              // (no saved name) or as a real-name row matching the
              // current saved name. `name === "You"` passes `null` to
              // the bubble so it falls through to the gray anonymous
              // fallback instead of rendering a "Y" initial.
              const isViewer = name === viewerLabel || isCurrentUserName(name);
              const imageUrl = isViewer ? myUserImageUrl : null;
              const bubbleName = name === "You" ? null : name;
              return (
                <li key={name} className="flex items-center gap-3 px-4 py-3 text-gray-900 dark:text-white">
                  <InitialBubble
                    name={bubbleName}
                    imageUrl={imageUrl}
                    sizeClassName="w-8 h-8"
                    className="shrink-0"
                  />
                  <span className="min-w-0 break-words">{name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}

function GroupInfoInner() {
  const params = useParams();
  const groupId = params.groupShortId as string;
  return <GroupInfoView groupId={groupId} />;
}

export default function GroupInfoPage() {
  return (
    <Suspense fallback={<GroupLoading />}>
      <GroupInfoInner />
    </Suspense>
  );
}
