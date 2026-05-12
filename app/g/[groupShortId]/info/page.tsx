"use client";

import { Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import { useGroup } from "@/lib/useGroup";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import RespondentCircles from "@/components/RespondentCircles";
import GroupHeader from "@/components/GroupHeader";
import { GroupLoading, GroupNotFound } from "@/components/GroupLoadState";

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

  const totalCount = group.participantNames.length;

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
            names={group.participantNames}
            anonymousCount={group.anonymousRespondentCount}
            sizeClassName="w-28"
          />
          <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-white break-words">
            {group.title}
          </h1>
        </div>

        <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
          {totalCount} {totalCount === 1 ? 'Member' : 'Members'}
        </h2>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          {group.participantNames.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No names submitted yet.
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {group.participantNames.map((name) => (
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
