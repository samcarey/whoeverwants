"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { hasAppHistory } from "@/lib/viewTransitions";
import { slideToGroupInfo } from "@/lib/slideOverlay";
import { useGroup } from "@/lib/useGroup";
import HeaderPortal from "@/components/HeaderPortal";
import InitialBubble from "@/components/InitialBubble";
import ConfirmationModal from "@/components/ConfirmationModal";
import { GroupLoading, GroupNotFound } from "@/components/GroupLoadState";
import { haptic } from "@/lib/haptics";
import {
  ApiError,
  apiAddGroupMembers,
  apiGetGroupInvitableAccounts,
  type InvitableAccount,
} from "@/lib/api";

/** Prop-driven inner view. Exposed so the slide overlay can render this
 *  directly without going through useParams() (the overlay mounts the
 *  component while the URL is still the source page). */
export function GroupInviteMembersView({ groupId }: { groupId: string }) {
  const { group, loading, error } = useGroup(groupId);
  if (loading) return <GroupLoading />;
  if (error || !group) return <GroupNotFound routeId={groupId} />;
  return <InviteMembers groupId={groupId} />;
}

function InviteMembers({ groupId }: { groupId: string }) {
  const [accounts, setAccounts] = useState<InvitableAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGetGroupInvitableAccounts(groupId)
      .then((data) => {
        if (!cancelled) setAccounts(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setAccounts([]);
        setLoadError(
          e instanceof ApiError ? e.message : "Failed to load people",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const goBack = () =>
    slideToGroupInfo({
      groupId,
      direction: "back",
      useHistoryBack: hasAppHistory(),
    });

  // Client-side name filter over the server-sorted list (order preserved).
  const filtered = useMemo(() => {
    if (!accounts) return [];
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => (a.name ?? "").toLowerCase().includes(q));
  }, [accounts, query]);

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const selectedCount = selected.size;

  const doUpdate = () => {
    if (selectedCount === 0 || submitting) return;
    setShowConfirm(false);
    setSubmitting(true);
    setSubmitError(null);
    haptic.medium();
    apiAddGroupMembers(groupId, [...selected])
      .then(() => {
        // The /info members list refetches on next mount, so just slide back.
        goBack();
      })
      .catch((e) => {
        setSubmitError(
          e instanceof ApiError ? e.message : "Failed to add members",
        );
        setSubmitting(false);
      });
  };

  return (
    <>
      {/* Portaled outside .responsive-scaling-container so position:fixed is
       *  viewport-relative on desktop — same pattern as the /info header. */}
      <HeaderPortal>
        <button
          onClick={goBack}
          className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
          aria-label="Go back"
        >
          <svg
            className="w-6 h-6 text-gray-700 dark:text-gray-200"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={selectedCount === 0 || submitting}
          className="fixed right-3 z-30 h-10 px-4 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70 text-blue-600 dark:text-blue-400 text-sm font-medium disabled:opacity-40 disabled:active:opacity-40"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
          aria-label="Add selected people to the group"
        >
          {submitting
            ? "Adding…"
            : selectedCount > 0
              ? `Update (${selectedCount})`
              : "Update"}
        </button>
      </HeaderPortal>

      <div
        className="max-w-4xl mx-auto px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)" }}
      >
        <h1 className="px-1 mb-3 text-2xl font-bold text-gray-900 dark:text-white">
          Add people
        </h1>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          className="w-full h-11 px-4 mb-3 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Search people by name"
        />

        {(submitError || loadError) && (
          <p
            className="px-1 mb-2 text-xs text-red-600 dark:text-red-400"
            role="status"
          >
            {submitError || loadError}
          </p>
        )}

        {accounts === null ? (
          <p className="px-1 py-6 text-sm text-gray-500 dark:text-gray-400">
            Loading…
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-1 py-6 text-sm text-gray-500 dark:text-gray-400">
            {accounts.length === 0
              ? "No one to add yet. People you share groups with will show up here."
              : "No people match your search."}
          </p>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {filtered.map((a) => {
                const isSelected = selected.has(a.user_id);
                const label = a.name ?? "Unnamed";
                return (
                  <li key={a.user_id}>
                    <button
                      type="button"
                      onClick={() => toggle(a.user_id)}
                      aria-pressed={isSelected}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-900 dark:text-white active:bg-gray-50 dark:active:bg-gray-800/60"
                    >
                      <div
                        role="checkbox"
                        aria-checked={isSelected}
                        className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                          isSelected
                            ? "bg-blue-600 border-blue-600 dark:bg-blue-500 dark:border-blue-500"
                            : "border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-900"
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="w-4 h-4 text-white"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={3}
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <InitialBubble
                        name={a.name}
                        imageUrl={null}
                        sizeClassName="w-8 h-8"
                        className="shrink-0"
                      />
                      <span className="min-w-0 break-words">{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={showConfirm}
        onConfirm={doUpdate}
        onCancel={() => setShowConfirm(false)}
        message={`Add ${selectedCount} ${selectedCount === 1 ? "person" : "people"} to this group?`}
        confirmText="Add"
      />
    </>
  );
}

function GroupInviteMembersInner() {
  const params = useParams();
  const groupId = params.groupShortId as string;
  return <GroupInviteMembersView groupId={groupId} />;
}

export default function GroupInviteMembersPage() {
  return (
    <Suspense fallback={<GroupLoading />}>
      <GroupInviteMembersInner />
    </Suspense>
  );
}
