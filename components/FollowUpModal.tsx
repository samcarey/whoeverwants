"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import ModalPortal from "@/components/ModalPortal";
import PollActionButton, { CutoffIcon } from "@/components/PollActionButton";
import { Question, Poll } from "@/lib/types";
import { buildQuestionSnapshot } from "@/lib/questionCreator";
import { formatShortDateTime } from "@/lib/timeUtils";

interface FollowUpModalProps {
  isOpen: boolean;
  question: Question;
  // Phase 5b: wrapper-level fields (response_deadline, is_closed,
  // close_reason) come from the parent poll. Caller passes it so this
  // modal can render the closed-state copy + build follow-up/duplicate
  // snapshots correctly.
  poll: Poll;
  onClose: () => void;
  totalVotes?: number;
  // When provided, renders a Forget button alongside the others. The parent is
  // responsible for confirmation + actually removing the question.
  onDelete?: () => void;
  // When provided, renders a Reopen button on a new row. Only shown when the
  // question is closed AND the caller deems reopening possible (e.g., creator in
  // dev mode).
  onReopen?: () => void;
  // When provided, renders a Close Poll button on a new row. Only shown when
  // the question is open AND the caller deems closing possible (creator or dev).
  onCloseQuestion?: () => void;
  // When provided, renders an End Availability Phase button on a new row. Only
  // shown when the question is a time question in the availability phase AND the caller
  // deems ending possible (creator or dev).
  onCutoffAvailability?: () => void;
  // When provided, renders a Cutoff Suggestions button on a new row. Only
  // shown when the question is a ranked_choice in the suggestion phase AND the
  // caller deems ending possible (creator or dev).
  onCutoffSuggestions?: () => void;
  // Shown when the poll is part of a recurring series — opens the cancel sheet.
  onCancelRecurring?: () => void;
}

export default function FollowUpModal({ isOpen, question, poll, onClose, totalVotes, onDelete, onReopen, onCloseQuestion, onCutoffAvailability, onCutoffSuggestions, onCancelRecurring }: FollowUpModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  // Ignore the synthetic click that fires immediately after the long-press
  // touch release — otherwise it lands on the full-viewport backdrop and
  // closes the modal on the same gesture that opened it.
  const openedAtRef = useRef(0);
  useEffect(() => {
    if (isOpen) openedAtRef.current = Date.now();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = () => {
    if (Date.now() - openedAtRef.current < 400) return;
    onClose();
  };

  const questionSnapshot = {
    ...buildQuestionSnapshot(question, poll),
    total_votes: totalVotes,
  };

  const deadline = poll.response_deadline ? new Date(poll.response_deadline) : null;
  const now = new Date();
  const isExpired = !!(deadline && deadline <= now);
  const isClosed = !!poll.is_closed;

  // Priority: max-capacity and manual-close messages take precedence over
  // the plain "Expired on …" label. These used to render inline in the card
  // status block; they live here now so the card stays focused on results.
  let closedText: string | null = null;
  if (isClosed && poll.close_reason === 'max_capacity') {
    closedText = 'Question auto-closed. Capacity reached.';
  } else if (isClosed && poll.close_reason === 'manual') {
    const closedAt = poll.updated_at ? new Date(poll.updated_at) : null;
    closedText = closedAt
      ? `Closed manually on ${formatShortDateTime(closedAt)}`
      : 'Closed manually';
  } else if (isExpired) {
    closedText = `Expired on ${formatShortDateTime(deadline!)}`;
  }

  const totalVotesText = typeof totalVotes === 'number' && totalVotes > 0
    ? `${totalVotes} total vote${totalVotes !== 1 ? 's' : ''}`
    : null;

  return (
    <ModalPortal>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[100] animate-fade-in"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed bottom-0 left-0 right-0 z-[110] animate-slide-up">
        <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl p-6 pb-8">
          {(closedText || totalVotesText) && (
            <div className="mb-4 text-center space-y-0.5">
              {closedText && (
                <div>
                  <span className="text-sm font-bold text-red-700 dark:text-red-300">
                    {closedText}
                  </span>
                </div>
              )}
              {totalVotesText && (
                <div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {totalVotesText}
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3">
            <PollActionButton
              variant="blue"
              className="flex-1"
              onClick={() => {
                localStorage.setItem(`duplicate-data-${question.id}`, JSON.stringify(questionSnapshot));
                router.push(`${pathname}?duplicate=${question.id}`);
                onClose();
              }}
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              }
              label="Copy"
            />

            {onDelete && (
              <PollActionButton
                variant="yellow"
                className="flex-1"
                onClick={() => {
                  onDelete();
                  onClose();
                }}
                icon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  </svg>
                }
                label="Forget"
              />
            )}
          </div>

          {onReopen && (
            <PollActionButton
              variant="green"
              className="w-full mt-3"
              onClick={() => {
                onReopen();
                onClose();
              }}
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 20v-6h-6" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 9.5A7 7 0 0119 12" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 14.5A7 7 0 015 12" />
                </svg>
              }
              label="Reopen"
            />
          )}

          {onCloseQuestion && (
            <PollActionButton
              variant="red"
              className="w-full mt-3"
              onClick={() => {
                onCloseQuestion();
                onClose();
              }}
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12" />
                </svg>
              }
              label="Close Poll"
            />
          )}

          {onCutoffAvailability && (
            <PollActionButton
              variant="amber"
              className="w-full mt-3"
              onClick={() => { onCutoffAvailability(); onClose(); }}
              icon={<CutoffIcon />}
              label="End Availability Phase"
            />
          )}

          {onCutoffSuggestions && (
            <PollActionButton
              variant="amber"
              className="w-full mt-3"
              onClick={() => { onCutoffSuggestions(); onClose(); }}
              icon={<CutoffIcon />}
              label="Cutoff Suggestions"
            />
          )}

          {onCancelRecurring && (
            <PollActionButton
              variant="red"
              className="w-full mt-3"
              onClick={() => { onCancelRecurring(); onClose(); }}
              icon={<span className="text-base leading-none" aria-hidden>🔁</span>}
              label="Cancel recurring…"
            />
          )}

        </div>
      </div>
    </ModalPortal>
  );
}
