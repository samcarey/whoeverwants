"use client";

import { useState, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import { apiUpdateGroupTitle } from "@/lib/api";
import { navigateWithTransition, navigateBackWithTransition, hasAppHistory } from "@/lib/viewTransitions";
import { useGroup } from "@/lib/useGroup";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import type { Group } from "@/lib/groupUtils";
import GroupHeader from "@/components/GroupHeader";
import { GroupLoading, GroupNotFound } from "@/components/GroupLoadState";

function Editor({ group, groupId }: { group: Group; groupId: string }) {
  const router = useRouter();
  // Migration 105: group_title lives on groups.title — surfaced on
  // every poll in the group as the same value. Empty groups carry the
  // override directly on `Group.groupTitleOverride` (no latestPoll to
  // read from).
  const [value, setValue] = useState<string>(group.groupTitleOverride ?? '');
  const [saving, setSaving] = useState(false);

  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  const goBack = () => {
    if (hasAppHistory()) navigateBackWithTransition();
    else navigateWithTransition(router, `/g/${groupId}/info`, 'back');
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // `groupId` is the route param — the server resolves any of
      // `groups.short_id`, `groups.id`, `polls.short_id`, or
      // `polls.id` to the same group. apiUpdateGroupTitle handles
      // cache invalidation for every poll in the group.
      await apiUpdateGroupTitle(groupId, value.trim() || null);
      goBack();
    } catch (err) {
      console.error('Failed to update group title:', err);
      setSaving(false);
    }
  };

  return (
    <>
      <GroupHeader
        headerRef={headerRef}
        title="Edit Title"
        onBack={goBack}
        rightSlot={
          <button
            onClick={save}
            disabled={saving}
            className="self-stretch py-2 px-2 flex items-center justify-center shrink-0 disabled:opacity-50"
            aria-label="Save group title"
          >
            <span className="min-w-10 h-10 flex items-center justify-center text-blue-600 dark:text-blue-400 text-sm font-semibold">
              {saving ? '...' : 'Save'}
            </span>
          </button>
        }
      />

      <div className="max-w-4xl mx-auto px-4" style={{ paddingTop: `calc(${headerHeight}px + 1rem)` }}>
        <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Group title</label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => setValue(e.target.value.trim())}
          placeholder={group.defaultTitle}
          autoFocus
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Leave blank to use the default: <span className="italic">{group.defaultTitle}</span>
        </p>
      </div>
    </>
  );
}

function EditGroupTitleInner() {
  const params = useParams();
  const groupId = params.groupShortId as string;
  const { group, loading, error } = useGroup(groupId);

  if (loading) return <GroupLoading />;
  if (error || !group) return <GroupNotFound />;
  return <Editor group={group} groupId={groupId} />;
}

export default function EditGroupTitlePage() {
  return (
    <Suspense fallback={<GroupLoading />}>
      <EditGroupTitleInner />
    </Suspense>
  );
}
