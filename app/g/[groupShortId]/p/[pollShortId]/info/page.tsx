"use client";

/**
 * Per-poll info page at `/g/<groupShortId>/p/<pollShortId>/info`. Hosts the
 * poll-level actions (Copy / Forget / Reopen / Close / Cutoff) that used to
 * live in `FollowUpModal` on the poll detail page, plus the full named
 * respondent list. Tapping the poll title on the detail page slides here.
 *
 * After a mutating action, the action API helpers (`apiClosePoll`, etc.)
 * invalidate the poll cache and write the fresh poll back, then this page
 * slides back to the detail page — which sync-inits from the fresh cache.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { Poll, Question } from "@/lib/types";
import { hasAppHistory } from "@/lib/viewTransitions";
import { slideToPollDetail } from "@/lib/slideOverlay";
import { useMeasuredHeight } from "@/lib/useMeasuredHeight";
import {
  isInSuggestionPhase,
  isInTimeAvailabilityPhase,
} from "@/lib/questionListUtils";
import { isUuidLike } from "@/lib/questionId";
import GroupHeader from "@/components/GroupHeader";
import InitialBubble from "@/components/InitialBubble";
import ConfirmationModal from "@/components/ConfirmationModal";
import PollActionButton, { CutoffIcon } from "@/components/PollActionButton";
import { getCreatorSecret } from "@/lib/browserQuestionAccess";
import {
  getCachedSessionUser,
  SESSION_CHANGED_EVENT,
  type SessionUser,
} from "@/lib/session";
import { getUserName, isCurrentUserName } from "@/lib/userProfile";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import {
  cachePoll,
  getCachedPollForShortId,
} from "@/lib/questionCache";
import { buildQuestionSnapshot } from "@/lib/questionCreator";
import { haptic } from "@/lib/haptics";
import { PENDING_ACTION_COPY, type PendingActionKind } from "../../../groupActionCopy";

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
  const [error, setError] = useState(false);

  useEffect(() => {
    if (poll || typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        const fetched = isUuidLike(pollShortId)
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

  if (error) {
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

  if (!poll) {
    return (
      <SimpleFrame onBack={goBack}>
        <p className="text-gray-600 dark:text-gray-400">Loading poll...</p>
      </SimpleFrame>
    );
  }

  return (
    <Info
      poll={poll}
      setPoll={setPoll}
      groupId={groupId}
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

const POLL_ACTION_APIS: Record<
  Exclude<PendingActionKind, "forget">,
  (pollId: string, secret: string) => Promise<Poll>
> = {
  reopen: apiReopenPoll,
  close: apiClosePoll,
  "cutoff-suggestions": apiCutoffPollSuggestions,
  "cutoff-availability": apiCutoffPollAvailability,
};

interface InfoProps {
  poll: Poll;
  setPoll: React.Dispatch<React.SetStateAction<Poll | null>>;
  groupId: string;
  onBack: () => void;
}

function Info({ poll, setPoll, groupId, onBack }: InfoProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();
  const myUserImageUrl = useMyUserImageUrl();

  const anchor: Question | undefined = poll.questions[0];
  const isClosed = !!poll.is_closed;
  const prephaseDeadline = poll.prephase_deadline ?? null;
  const title = poll.title || anchor?.title || "Poll";

  // One localStorage parse per render instead of one per action / per render
  // hot path. getCreatorSecret walks the secrets array; isCurrentUserName
  // reads getUserName(). Memo-bound to anchor identity.
  const creatorSecret = useMemo(
    () => (anchor ? getCreatorSecret(anchor.id) : null),
    [anchor?.id],
  );
  // Account-owned authorship (migration 122): the signed-in creator can
  // manage their poll from any device — even one without the per-browser
  // creator_secret. Subscribe to SESSION_CHANGED so the controls appear/
  // disappear on sign-in/out without a remount.
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  useEffect(() => {
    setSessionUser(getCachedSessionUser());
    const update = () => setSessionUser(getCachedSessionUser());
    window.addEventListener(SESSION_CHANGED_EVENT, update);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, update);
  }, []);
  const viewerIsCreator =
    !!creatorSecret ||
    (!!sessionUser &&
      !!poll.creator_user_id &&
      sessionUser.user_id === poll.creator_user_id);
  const isCreatorOrDev =
    viewerIsCreator || process.env.NODE_ENV === "development";

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
  const currentUserName = useMemo(
    () => getUserName()?.trim().toLowerCase() ?? null,
    [],
  );

  const [pendingAction, setPendingAction] = useState<PendingActionKind | null>(
    null,
  );
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
    const kind = pendingAction;
    if (!kind || !anchor) return;
    haptic.medium();
    setPendingAction(null);

    if (kind === "forget") {
      try {
        setSubmitting(true);
        const { forgetQuestion } = await import("@/lib/forgetQuestion");
        // Drop every sub-question; anchor-only would strand siblings on
        // multi-question polls.
        for (const sp of poll.questions) forgetQuestion(sp.id);
      } finally {
        setSubmitting(false);
      }
      router.push(`/g/${groupId}`);
      return;
    }

    // The per-browser secret authorizes anonymous-created polls + the
    // creating browser. A signed-in creator on another device has no secret
    // here — they send an empty one and the server authorizes against their
    // session (the poll's creator_user_id matches their user_id).
    const secret = creatorSecret ?? "";

    try {
      setSubmitting(true);
      const updated = await POLL_ACTION_APIS[kind](poll.id, secret);
      setPoll((prev) => (prev ? { ...prev, ...updated } : updated));
      onBack();
    } catch (err) {
      console.error(`Failed to ${kind}:`, err);
    } finally {
      setSubmitting(false);
    }
  };

  const pendingCopy = pendingAction ? PENDING_ACTION_COPY[pendingAction] : null;

  return (
    <>
      <GroupHeader headerRef={headerRef} title={title} onBack={onBack} />

      <div style={{ paddingTop: `calc(${headerHeight}px + 1rem)` }}>
        <section className="mb-6">
          <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
            Actions
          </h2>
          <div className="flex gap-3">
            <PollActionButton
              variant="blue"
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              }
              label="Copy"
              onClick={onCopy}
              disabled={!anchor || submitting}
              className="flex-1"
            />
            <PollActionButton
              variant="yellow"
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                </svg>
              }
              label="Forget"
              onClick={() => setPendingAction("forget")}
              disabled={submitting}
              className="flex-1"
            />
          </div>

          {canReopen && (
            <PollActionButton
              variant="green"
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 20v-6h-6" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 9.5A7 7 0 0119 12" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 14.5A7 7 0 015 12" />
                </svg>
              }
              label="Reopen"
              onClick={() => setPendingAction("reopen")}
              disabled={submitting}
              className="w-full mt-3"
            />
          )}

          {canClose && (
            <PollActionButton
              variant="red"
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12" />
                </svg>
              }
              label="Close Poll"
              onClick={() => setPendingAction("close")}
              disabled={submitting}
              className="w-full mt-3"
            />
          )}

          {canCutoffAvailability && (
            <PollActionButton
              variant="amber"
              icon={<CutoffIcon />}
              label="End Availability Phase"
              onClick={() => setPendingAction("cutoff-availability")}
              disabled={submitting}
              className="w-full mt-3"
            />
          )}

          {canCutoffSuggestions && (
            <PollActionButton
              variant="amber"
              icon={<CutoffIcon />}
              label="Cutoff Suggestions"
              onClick={() => setPendingAction("cutoff-suggestions")}
              disabled={submitting}
              className="w-full mt-3"
            />
          )}
        </section>

        <section>
          <h2 className="px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
            {totalCount} {totalCount === 1 ? "Respondent" : "Respondents"}
          </h2>

          {totalCount === 0 ? (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No respondents yet
            </div>
          ) : (
            <ul className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden divide-y divide-gray-200 dark:divide-gray-800">
              {namedVoters.map((name, idx) => {
                const isViewer =
                  currentUserName !== null &&
                  name.trim().toLowerCase() === currentUserName;
                return (
                  <li
                    key={`${name}-${idx}`}
                    className="flex items-center gap-3 px-4 py-3 text-gray-900 dark:text-white"
                  >
                    <InitialBubble
                      name={name}
                      imageUrl={isViewer ? myUserImageUrl : null}
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
          )}
        </section>
      </div>

      {pendingCopy && (
        <ConfirmationModal
          isOpen={true}
          title={pendingCopy.title}
          message={pendingCopy.message}
          confirmText={pendingCopy.confirmText}
          cancelText="Cancel"
          confirmButtonClass={pendingCopy.confirmButtonClass}
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
