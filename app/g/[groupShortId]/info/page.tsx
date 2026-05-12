"use client";

import { Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import { useGroup } from "@/lib/useGroup";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import RespondentCircles from "@/components/RespondentCircles";
import GroupHeader from "@/components/GroupHeader";
import { GroupLoading, GroupNotFound } from "@/components/GroupLoadState";
import { getUserName } from "@/lib/userProfile";

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

  // The members list ALSO shows the current user (alphabetically merged
  // with the others). The current-user filter applies to `participantNames`
  // for the title + hero graphic ("don't list yourself in the group name
  // or graphic"), but the list under "Members" is the canonical roster
  // and should include the viewer like anyone else. When the user hasn't
  // picked a name they're omitted (consistent with anonymous voters).
  const currentUserName = getUserName()?.trim() || null;
  const membersList = currentUserName
    ? [...group.participantNames, currentUserName].sort((a, b) => a.localeCompare(b))
    : group.participantNames;
  const totalCount = membersList.length;

  // Solo case: when the viewer is the only member, treat the hero avatar
  // and title the same way as the list — show the viewer as a normal
  // member instead of the gray placeholder circle + "New Group" fallback.
  // Other surfaces (home list, group page header) keep the
  // filter-out-viewer behavior so the viewer doesn't see themselves in
  // the group name elsewhere; /info is the canonical roster.
  const isSoloViewer =
    group.participantNames.length === 0 &&
    group.anonymousRespondentCount === 0 &&
    currentUserName !== null;
  const heroNames = isSoloViewer ? [currentUserName] : group.participantNames;
  const displayTitle = isSoloViewer && !group.groupTitleOverride
    ? currentUserName
    : group.title;

  return (
    <>
      <GroupHeader
        headerRef={headerRef}
        onBack={goBack}
        rightSlot={
          <button
            onClick={() => navigateWithTransition(router, `/g/${groupId}/edit-title`, 'forward')}
            className="w-10 h-10 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 text-sm font-medium"
            aria-label="Edit group title"
          >
            Edit
          </button>
        }
      />

      <div className="max-w-4xl mx-auto px-4" style={{ paddingTop: `calc(${headerHeight}px + 1.5rem)` }}>
        <div className="flex flex-col items-center text-center mb-8">
          <RespondentCircles
            names={heroNames}
            anonymousCount={group.anonymousRespondentCount}
            sizeClassName="w-28"
          />
          <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-white break-words">
            {displayTitle}
          </h1>
        </div>

        <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
          {totalCount} {totalCount === 1 ? 'Member' : 'Members'}
        </h2>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          {totalCount === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No members yet.
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {membersList.map((name) => (
                <li key={name} className="px-4 py-3 text-gray-900 dark:text-white">
                  {name}
                </li>
              ))}
            </ul>
          )}
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
