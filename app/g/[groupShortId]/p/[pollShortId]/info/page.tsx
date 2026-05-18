"use client";

/**
 * Per-poll info page at `/g/<groupShortId>/p/<pollShortId>/info`. Hosts the
 * poll-level actions (Copy / Forget / Reopen / Close / Cutoff) that used to
 * live in `FollowUpModal` on the poll detail page, plus a full list of named
 * respondents. Tapping the poll title on the detail page slides here.
 *
 * Mirrors the cache-first init + async-fallback pattern of `PollDetailView`
 * so the page renders instantly when the poll is already in the in-memory
 * cache (the common case after a slide from the detail page).
 *
 * After a mutating action, the action API helpers (`apiClosePoll`, etc.)
 * invalidate the poll cache and write the fresh poll back, then this page
 * slides back to the detail page — which sync-inits from the fresh cache.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, usePathname } from "next/navigation";
import {
  ApiError,
  apiClosePoll,
  apiCutoffPollAvailability,
  apiCutoffPollSuggestions,
  apiGetPollById,
  apiGetPollByShortId,
  apiReopenPoll,
} from "@/lib/api";
import { hasAppHistory } from "@/lib/viewTransitions";
import { slideToPollDetail } from "@/lib/slideOverlay";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import {
  isInSuggestionPhase,
  isInTimeAvailabilityPhase,
} from "@/lib/questionListUtils";
import GroupHeader from "@/components/GroupHeader";
import InitialBubble from "@/components/InitialBubble";
import ConfirmationModal from "@/components/ConfirmationModal";
import { getCreatorSecret } from "@/lib/browserQuestionAccess";
import { isCurrentUserName } from "@/lib/userProfile";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import {
  cachePoll,
  getCachedPollForShortId,
} from "@/lib/questionCache";
import { buildQuestionSnapshot } from "@/lib/questionCreator";
import { haptic } from "@/lib/haptics";
import { PENDING_ACTION_COPY, type PendingActionKind } from "../../../groupActionCopy";
import type { Poll, Question } from "@/lib/types";

interface PollInfoViewProps {
  groupId: string;
  pollShortId: string;
}

/** Prop-driven view exposed so SlideOverlayHost can render this page during
 *  the slide-in animation. The default route export below wraps with
 *  `useParams` for direct URL navigation. */
export function PollInfoView({ groupId, pollShortId }: PollInfoViewProps) {
  const router = useRouter();

  const [poll, setPoll] = useState<Poll | null>(() => {
    if (typeof window === "undefined") return null;
    return getCachedPollForShortId(pollShortId);
  });
  const [loading, setLoading] = useState(!poll);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (poll) return;
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const fetched = pollShortId.length > 10 && pollShortId.includes("-")
          ? await apiGetPollById(pollShortId)
          : await apiGetPollByShortId(pollShortId);
        if (cancelled) return;
        setPoll(fetched);
      } catch (err) {
        if (cancelled) return;
        if (!(err instanceof ApiError && err.status === 404)) {
          console.error("PollInfo: fetch failed", err);
        }
        setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poll, pollShortId]);

  const goBack = useCallback(() => {
    slideToPollDetail({
      groupId,
      pollShortId,
      direction: "back",
      useHistoryBack: hasAppHistory(),
    });
  }, [groupId, pollShortId]);

  if (loading && !poll) {
    return (
      <SimpleFrame onBack={goBack}>
        <p className="text-gray-600 dark:text-gray-400">Loading poll...</p>
      </SimpleFrame>
    );
  }

  if (error || !poll) {
    return (
      <SimpleFrame onBack={goBack}>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Poll Not Found
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          This poll may have been removed.
        </p>
        <button
          onClick={() => router.push(`/g/${groupId}`)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Back to Group
        </button>
      </SimpleFrame>
    );
  }

  return (
    <Info
      poll={poll}
      setPoll={setPoll}
      groupId={groupId}
      pollShortId={pollShortId}
      onBack={goBack}
    />
  );
}

function SimpleFrame({
  onBack,
  children,
}: {
  onBack: () => void;
  children: React.ReactNode;
}) {
  const headerRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <GroupHeader headerRef={headerRef} onBack={onBack} />
      <div className="min-h-[40vh] flex flex-col items-center justify-center text-center px-4">
        {children}
      </div>
    </>
  );
}

interface InfoProps {
  poll: Poll;
  setPoll: React.Dispatch<React.SetStateAction<Poll | null>>;
  groupId: string;
  pollShortId: string;
  onBack: () => void;
}

function Info({ poll, setPoll, groupId, pollShortId, onBack }: InfoProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();
  const myUserImageUrl = useMyUserImageUrl();

  const anchor: Question | undefined = poll.questions[0];
  const isClosed = !!poll.is_closed;
  const isCreatorOrDev =
    (anchor ? !!getCreatorSecret(anchor.id) : false) ||
    process.env.NODE_ENV === "development";
  const prephaseDeadline = poll.prephase_deadline ?? null;

  const canReopen = isClosed && isCreatorOrDev;
  const canClose = !isClosed && isCreatorOrDev;
  const canCutoffAvailability =
    !isClosed && !!anchor && isInTimeAvailabilityPhase(anchor) && isCreatorOrDev;
  const canCutoffSuggestions =
    !isClosed &&
    !!anchor &&
    isInSuggestionPhase(anchor, prephaseDeadline) &&
    isCreatorOrDev;

  const namedVoters = poll.voter_names ?? [];
  const anonymousCount = poll.anonymous_count ?? 0;
  const totalCount = namedVoters.length + anonymousCount;

  const title = poll.title || anchor?.title || "Poll";

  const [pendingAction, setPendingAction] = useState<
    { kind: PendingActionKind } | null
  >(null);
  const [submitting, setSubmitting] = useState(false);

  const onCopy = () => {
    if (!anchor) return;
    haptic.light();
    const snapshot = buildQuestionSnapshot(anchor, poll);
    localStorage.setItem(
      `duplicate-data-${anchor.id}`,
      JSON.stringify(snapshot),
    );
    router.push(`${pathname}?duplicate=${anchor.id}`);
  };

  const onConfirmAction = async () => {
    const action = pendingAction;
    if (!action || !anchor) return;
    haptic.medium();
    setPendingAction(null);

    if (action.kind === "forget") {
      try {
        setSubmitting(true);
        const { forgetQuestion } = await import("@/lib/forgetQuestion");
        // Poll-level forget: drop every sub-question. Anchor-only would leave
        // siblings in localStorage on multi-question polls.
        for (const sp of poll.questions) forgetQuestion(sp.id);
      } finally {
        setSubmitting(false);
      }
      router.push(`/g/${groupId}`);
      return;
    }

    const secret = getCreatorSecret(anchor.id) || (process.env.NODE_ENV === "development" ? "dev-override" : "");
    if (!secret) {
      console.error(`Missing creator secret for ${action.kind}`);
      return;
    }

    try {
      setSubmitting(true);
      if (action.kind === "reopen") {
        const updated = await apiReopenPoll(poll.id, secret);
        setPoll((prev) => prev ? { ...prev, ...updated } : updated);
      } else if (action.kind === "close") {
        const updated = await apiClosePoll(poll.id, secret);
        setPoll((prev) => prev ? { ...prev, ...updated } : updated);
      } else if (action.kind === "cutoff-suggestions") {
        const updated = await apiCutoffPollSuggestions(poll.id, secret);
        setPoll((prev) => prev ? { ...prev, ...updated } : updated);
      } else if (action.kind === "cutoff-availability") {
        const updated = await apiCutoffPollAvailability(poll.id, secret);
        setPoll((prev) => prev ? { ...prev, ...updated } : updated);
      }
      // Cache was already updated by the apiXxx helper. Slide back to detail
      // so the user sees the result; PollDetailView sync-inits from cache.
      onBack();
    } catch (err) {
      console.error(`Failed to ${action.kind}:`, err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <GroupHeader headerRef={headerRef} title={title} onBack={onBack} />

      <div style={{ paddingTop: `calc(${headerHeight}px + 1rem)` }}>
        {/* Actions section — every poll-level operation that used to live in
            FollowUpModal. Order: Copy + Forget on one row (parity with the
            old modal), then per-state action buttons below. */}
        <section className="mb-6">
          <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
            Actions
          </h2>
          <div className="flex gap-3">
            <button
              onClick={onCopy}
              disabled={!anchor || submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200 disabled:opacity-50 disabled:active:scale-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </button>
            <button
              onClick={() => setPendingAction({ kind: "forget" })}
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 bg-yellow-500 hover:bg-yellow-600 active:bg-yellow-700 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200 disabled:opacity-50 disabled:active:scale-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
              Forget
            </button>
          </div>

          {canReopen && (
            <button
              onClick={() => setPendingAction({ kind: "reopen" })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 mt-3 bg-green-600 hover:bg-green-700 active:bg-green-800 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200 disabled:opacity-50 disabled:active:scale-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 20v-6h-6" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 9.5A7 7 0 0119 12" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 14.5A7 7 0 015 12" />
              </svg>
              Reopen
            </button>
          )}

          {canClose && (
            <button
              onClick={() => setPendingAction({ kind: "close" })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 mt-3 bg-red-600 hover:bg-red-700 active:bg-red-800 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200 disabled:opacity-50 disabled:active:scale-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12" />
              </svg>
              Close Poll
            </button>
          )}

          {canCutoffAvailability && (
            <button
              onClick={() => setPendingAction({ kind: "cutoff-availability" })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 mt-3 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200 disabled:opacity-50 disabled:active:scale-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
              </svg>
              End Availability Phase
            </button>
          )}

          {canCutoffSuggestions && (
            <button
              onClick={() => setPendingAction({ kind: "cutoff-suggestions" })}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 mt-3 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 active:scale-95 text-white font-medium text-sm rounded-lg transition-all duration-200 disabled:opacity-50 disabled:active:scale-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
              </svg>
              Cutoff Suggestions
            </button>
          )}
        </section>

        {/* Respondents section — full list of named voters + a final row for
            anonymous voters. `voter_names` and `anonymous_count` are poll-
            level aggregates from the server (Phase 3.2). */}
        <section>
          <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
            {totalCount} {totalCount === 1 ? "Respondent" : "Respondents"}
          </h2>

          {totalCount === 0 ? (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No respondents yet
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {namedVoters.map((name, idx) => {
                  const isViewer = isCurrentUserName(name);
                  const imageUrl = isViewer ? myUserImageUrl : null;
                  return (
                    <li
                      key={`${name}-${idx}`}
                      className="flex items-center gap-3 px-4 py-3 text-gray-900 dark:text-white"
                    >
                      <InitialBubble
                        name={name}
                        imageUrl={imageUrl}
                        sizeClassName="w-8 h-8"
                        className="shrink-0"
                      />
                      <span className="min-w-0 break-words">{name}</span>
                    </li>
                  );
                })}
                {anonymousCount > 0 && (
                  <li className="flex items-center gap-3 px-4 py-3 text-gray-500 dark:text-gray-400 italic">
                    <InitialBubble
                      name={null}
                      sizeClassName="w-8 h-8"
                      className="shrink-0"
                    />
                    <span className="min-w-0">
                      {anonymousCount === 1
                        ? "1 anonymous respondent"
                        : `${anonymousCount} anonymous respondents`}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </section>
      </div>

      {pendingAction && (
        <ConfirmationModal
          isOpen={true}
          title={PENDING_ACTION_COPY[pendingAction.kind].title}
          message={PENDING_ACTION_COPY[pendingAction.kind].message}
          confirmText={PENDING_ACTION_COPY[pendingAction.kind].confirmText}
          cancelText="Cancel"
          confirmButtonClass={PENDING_ACTION_COPY[pendingAction.kind].confirmButtonClass}
          onConfirm={onConfirmAction}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </>
  );
}

function PollInfoInner() {
  const params = useParams();
  const groupId = params.groupShortId as string;
  const pollShortId = params.pollShortId as string;
  return <PollInfoView groupId={groupId} pollShortId={pollShortId} />;
}

export default function PollInfoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-gray-600 dark:text-gray-400">Loading poll info…</p>
        </div>
      }
    >
      <PollInfoInner />
    </Suspense>
  );
}
