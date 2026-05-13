"use client";

import { Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import { useGroup } from "@/lib/useGroup";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import GroupAvatar from "@/components/GroupAvatar";
import GroupHeader from "@/components/GroupHeader";
import { GroupLoading, GroupNotFound } from "@/components/GroupLoadState";
import { nameToColor } from "@/components/RespondentCircles";
import { getUserInitials, getUserName } from "@/lib/userProfile";

function GroupInfoInner() {
  const params = useParams();
  const groupId = params.groupShortId as string;
  const { group, loading, error } = useGroup(groupId);

  if (loading) return <GroupLoading />;
  if (error || !group) return <GroupNotFound />;
  return <Info group={group} groupId={groupId} />;
}

function Info({ group, groupId }: { group: import("@/lib/groupUtils").Group; groupId: string }) {
  const router = useRouter();
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  const goBack = () => {
    if (hasAppHistory()) navigateBackWithTransition();
    else navigateWithTransition(router, `/g/${groupId}`, 'back');
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
      <GroupHeader
        headerRef={headerRef}
        onBack={goBack}
        rightSlot={
          <button
            onClick={() => navigateWithTransition(router, `/g/${groupId}/edit-title`, 'forward')}
            className="self-stretch py-2 px-2 flex items-center justify-center shrink-0"
            aria-label="Edit group title"
          >
            <span className="w-10 h-10 flex items-center justify-center text-blue-600 dark:text-blue-400 text-sm font-medium">
              Edit
            </span>
          </button>
        }
      />

      <div className="max-w-4xl mx-auto px-4" style={{ paddingTop: `calc(${headerHeight}px + 0.5rem)` }}>
        <div className="flex flex-col items-center text-center mb-8">
          <GroupAvatar
            imageUrl={group.imageUrl}
            names={heroNames}
            anonymousCount={group.anonymousRespondentCount}
            sizeClassName="w-[10.5rem]"
          />
          <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-white break-words">
            {displayTitle}
          </h1>
        </div>

        <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
          {totalCount} {totalCount === 1 ? 'Member' : 'Members'}
        </h2>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {membersList.map((name) => (
              <li key={name} className="flex items-center gap-3 px-4 py-3 text-gray-900 dark:text-white">
                <span
                  className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                  style={{ backgroundColor: nameToColor(name) }}
                  aria-hidden="true"
                >
                  {getUserInitials(name)}
                </span>
                <span className="min-w-0 break-words">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

export default function GroupInfoPage() {
  return (
    <Suspense fallback={<GroupLoading />}>
      <GroupInfoInner />
    </Suspense>
  );
}
